/**
 * src/duty/patrol.ts —— 背景巡查與主動推薦任務 (Patrol Duty)
 * ============================================================================
 * 職責：
 * 1. 定時依據設定之間隔呼叫貼文搜尋 Tool (優先模糊搜尋)。
 * 2. 嚴格過濾 AI 生成的影片、AI 動畫、AI 繪圖或 AI 生成文章 (AIGC Filter)。
 * 3. 依照按讚數、留言數、排除關鍵字、必要關鍵字進行前置篩選。
 * 4. 透過統一 LLM 模組 (支援讀取外部插件 dsh-plugin-subscriptions 額度與自訂 API)
 *    請求 AI 評估貼文是否值得推薦並生成自然推坑語句。
 * 5. 當判定推薦時，調用回覆留言 Tool 留下 @目標用戶 <推薦內容>。
 * ============================================================================
 */

import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import { callLlmForInstagram, isAiGeneratedContent } from '../lib/llm.js'
import {
  ANTI_AI_FLAVOR_PRIMARY_RULE,
  PROMPT_INJECTION_DEFENSE_RULE,
  buildFeiyuMoodPromptBlock,
  stripAiFlavorArtifacts,
  wrapUntrustedContent,
} from '../lib/companion.js'
import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'

export interface PatrolDutyResult {
  ok: boolean
  processedPosts: number
  recommendedCount: number
  notes: string[]
}

/** 執行單輪巡查與推坑 */
export async function executePatrolDuty(
  ctx: any,
  config: InstagramPluginConfig,
  mcp: InstagramMcpClient,
  ledger: LedgerManager,
  log: (msg: string) => void = console.log
): Promise<PatrolDutyResult> {
  const notes: string[] = []
  let processed = 0
  let recommended = 0

  if (!config.patrolEnabled) {
    notes.push('巡查任務已在設定中關閉 (patrolEnabled=false)')
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  // 防風控冷卻保護檢查
  if (ledger.isInCooldown()) {
    const rem = ledger.getCooldownRemainingSeconds()
    const reason = ledger.getCooldownReason()
    notes.push(`防風控冷卻保護中（剩餘 ${rem} 秒，原因: ${reason}），暫停巡查`)
    log(`[Patrol] 🚨 帳號目前處於防風控冷卻期（剩餘 ${rem} 秒），本輪跳過巡查以避免帳號停權`)
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  const svc = (globalThis as any).__DSH_INSTAGRAM_MCP__
  const targetMentionUser = String(svc?.config?.masterUsername || config.targetMentionUser || '')
    .replace(/^@/, '')
    .trim()

  if (!targetMentionUser) {
    notes.push('未設定推坑目標主人帳號 (請至 Instagram FastMCP 設定面板填寫主人帳號)，跳過巡查')
    log('[Patrol] 提示：請在 Instagram FastMCP 設定面板指定「主人 Instagram 帳號 (Master Username)」')
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  // 小時頻次防護
  if (!ledger.canDoHourly('patrolComments', config.maxHourlyPatrolComments || 3)) {
    notes.push(`已達每小時巡查推薦留言上限 (${config.maxHourlyPatrolComments || 3} 則)`)
    log(`[Patrol] 已達近一小時推坑上限 (${config.maxHourlyPatrolComments || 3} 則)，本輪不再發布新留言`)
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  if (!ledger.canDoDaily('patrolComments', config.maxDailyPatrolComments)) {
    notes.push(`已達每日巡查推薦留言上限 (${config.maxDailyPatrolComments} 則)`)
    log(`[Patrol] 已達當日推坑上限，本輪不再發布新留言`)
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  const useFuzzy = config.fuzzySearchEnabled !== false
  const useTags = config.tagSearchEnabled === true

  const fuzzyList =
    config.fuzzyKeywords && config.fuzzyKeywords.length > 0 ? config.fuzzyKeywords : config.hashtags || []
  const hashtags = config.hashtags || []

  if (!useFuzzy && !useTags) {
    notes.push('模糊搜尋與標籤搜尋皆已關閉，跳過巡查')
    log('[Patrol] 提示：模糊搜尋 (fuzzySearchEnabled) 與標籤搜尋 (tagSearchEnabled) 均已關閉，請至少開啟一項')
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  // 組裝搜尋任務佇列
  const searchTasks: Array<{ mode: 'fuzzy' | 'tag'; term: string }> = []
  if (useFuzzy) {
    for (const kw of fuzzyList) {
      const clean = String(kw || '').trim()
      if (clean) searchTasks.push({ mode: 'fuzzy', term: clean })
    }
  }
  if (useTags) {
    for (const tag of hashtags) {
      const clean = String(tag || '').replace(/^#/, '').trim()
      if (clean) searchTasks.push({ mode: 'tag', term: clean })
    }
  }

  if (searchTasks.length === 0) {
    notes.push('未設定任何模糊搜尋關鍵字或標籤')
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  const maxPerRun = config.maxPatrolCommentsPerRun || 1
  const modeSummary = [
    useFuzzy ? `模糊搜尋(${fuzzyList.length}組)` : '',
    useTags ? `標籤搜尋(${hashtags.length}組)` : '',
  ]
    .filter(Boolean)
    .join(' + ')
  log(`[Patrol] 開始執行巡查 [${modeSummary}]，共 ${searchTasks.length} 項檢索 (本輪推坑上限: ${maxPerRun} 則)...`)

  for (const task of searchTasks) {
    const tag = task.term
    if (
      recommended >= maxPerRun ||
      !ledger.canDoDaily('patrolComments', config.maxDailyPatrolComments) ||
      !ledger.canDoHourly('patrolComments', config.maxHourlyPatrolComments || 3)
    ) {
      break
    }

    try {
      let posts: any[] = []
      const limit = config.patrolSearchLimit || 10
      if (task.mode === 'fuzzy') {
        const res =
          typeof (mcp as any).igFuzzySearchPosts === 'function'
            ? await (mcp as any).igFuzzySearchPosts(tag, limit)
            : await (mcp as any).callTool('ig_fuzzy_search_posts', { query: tag, limit }, 75000)
        posts = res?.posts || []
        log(`[Patrol] 🔎 模糊搜尋 "${tag}" 抓取到 ${posts.length} 則貼文`)
      } else {
        const res = await mcp.igSearchHashtag(tag, limit)
        posts = res?.posts || []
        log(`[Patrol] 🏷️ 標籤 #${tag} 抓取到 ${posts.length} 則貼文`)
      }

      for (const post of posts) {
        if (
          recommended >= maxPerRun ||
          !ledger.canDoDaily('patrolComments', config.maxDailyPatrolComments) ||
          !ledger.canDoHourly('patrolComments', config.maxHourlyPatrolComments || 3)
        ) {
          break
        }

        const pk = String(post.pk || '')
        if (!pk) continue

        // 1. 檢查去重帳本
        if (ledger.hasSeenPost(pk)) {
          continue
        }

        processed++
        const caption = String(post.caption || '')
        const authorName = String(post.user?.username || '')
        const likes = Number(post.like_count || 0)
        const comments = Number(post.comment_count || 0)

        // 2. 嚴格攔截 AI 生成的影片、動畫、繪圖或農場文章 (AIGC Filter)
        const aigcCheck = isAiGeneratedContent(caption, authorName)
        if (aigcCheck.isAigc) {
          log(`[Patrol] 🚫 貼文 ${pk} 判定為 AI 生成影片/動畫/文章 (命中 "${aigcCheck.matchedTerm}")，直接過濾跳過`)
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
          continue
        }

        // 3. 點讚與留言門檻過濾
        if (likes < config.minLikes || comments < config.minComments) {
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
          continue
        }

        // 4. 排除關鍵字過濾
        const captionLower = caption.toLowerCase()
        if (
          config.excludeKeywords &&
          config.excludeKeywords.some((kw) => kw && captionLower.includes(kw.toLowerCase()))
        ) {
          log(`[Patrol] 貼文 ${pk} 命中排除關鍵字，跳過`)
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
          continue
        }

        // 5. 必要關鍵字過濾 (若有設定)
        if (config.requireKeywords && config.requireKeywords.length > 0) {
          const matched = config.requireKeywords.some((kw) => kw && captionLower.includes(kw.toLowerCase()))
          if (!matched) {
            ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
            continue
          }
        }

        // 6. 調用 AI 評估貼文價值（第一條件：去 AI 味 + 同步 dsh-feiyu-mood 心情指標 + 防注入邊界）
        const moodBlock = buildFeiyuMoodPromptBlock(true)
        const basePersona = config.patrolPersonaPrompt || '你是一個眼光敏銳、說話自然隨性的朋友。'
        const systemPrompt = `${ANTI_AI_FLAVOR_PRIMARY_RULE}

${PROMPT_INJECTION_DEFENSE_RULE}

【角色人設】：
${basePersona}
${moodBlock ? `\n${moodBlock}` : ''}`
        const evalPrompt = `請評估以下 Instagram 貼文是否具備分享與推薦價值：
搜尋主題：${tag}
作者：@${authorName || 'unknown'}
按讚數：${likes} | 留言數：${comments}
內文摘要：
${wrapUntrustedContent('post_caption', caption.slice(0, 600))}

【重要排除原則】：
- 嚴格禁止推薦任何「AI 生成的影片、AI 動畫、AI 繪圖/算圖、AI 配音或 AI 生成的農場文章」（例如 Sora、Runway、Midjourney、Stable Diffusion、Kling、可靈、AIGC 等）。若懷疑或發現為 AI 生成的創作/影片/動畫/文章，請務必回答 "recommend": false！
- 只推薦真實人類創作的作品、真實軟體開發/技術實踐、優質工具或有深度的原創見解。
- 推薦語句 (reason) 必須遵守【第一條件：絕對不要 AI 味】，像真人朋友在 IG 隨手標記分享好東西一樣自然（例如「這篇講得蠻透的」、「這個實作思路很有意思」），嚴禁寫得像廣告文案或客服摘要！

請嚴格以 JSON 格式回答：
{"recommend": true 或 false, "reason": "35字內無 AI 味的自然口語推坑留言（不要加 @用戶名）"}`

        let llmReply = ''
        try {
          llmReply = await callLlmForInstagram(ctx, config, systemPrompt, evalPrompt, log)
        } catch (llmErr: any) {
          log(`[Patrol] ⚠️ AI 評估呼叫失敗 (${llmErr.message})，跳過貼文 ${pk}`)
          continue
        }

        let isRecommend = false
        let reason = ''

        try {
          const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            isRecommend = Boolean(parsed.recommend)
            if (parsed.reason) reason = stripAiFlavorArtifacts(String(parsed.reason).trim())
          } else {
            const scoreMatch = llmReply.match(/([89]\d|100)\s*分/)
            if (scoreMatch) {
              isRecommend = true
              reason = llmReply.replace(/^[0-9]+\s*分[：:、，,\s]*/, '').trim()
            }
          }
        } catch {
          isRecommend = llmReply.includes('"recommend": true') || llmReply.includes('recommend: true')
        }

        // 7. 若符合推薦標準，留言推坑
        if (isRecommend && reason) {
          if (recommended > 0) {
            const waitSec = config.minCommentIntervalSeconds || 30
            log(`[Patrol] 🛡️ 防風控間隔等待 ${waitSec} 秒...`)
            await new Promise((r) => setTimeout(r, waitSec * 1000))
          }

          let commentText =
            config.recommendTemplate || '@{targetUser} 這篇關於 #{hashtag} 的內容很值得一看：{summary}'
          commentText = commentText
            .replace('{targetUser}', targetMentionUser)
            .replace('{hashtag}', tag)
            .replace('{summary}', reason)

          log(`[Patrol] 貼文 ${pk} 通過評估，發布推坑留言: ${commentText}`)

          const postRes = await mcp.igPostComment({
            media_pk: pk,
            text: commentText,
            jitter_min: config.jitterMinSeconds,
            jitter_max: config.jitterMaxSeconds,
          })

          if (
            postRes?.in_cooldown ||
            (postRes?.error && /action block|feedback|checkpoint|please wait|rate limit/i.test(postRes.error))
          ) {
            ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, postRes.error || 'Instagram 頻率風控阻擋')
            log(`[Patrol] 🚨 偵測到風控或熔斷保護，停止後續巡查動作！`)
            notes.push(`觸發防風控熔斷: ${postRes.error}`)
            break
          }

          if (postRes?.ok) {
            recommended++
            ledger.markSeenPost(pk, { hashtag: tag, recommended: true })
            ledger.recordAction('patrolComments')
            log(`[Patrol] ✅ 推坑留言發布成功 (PK: ${pk})`)
          } else {
            log(`[Patrol] 留言發布失敗: ${postRes?.error || JSON.stringify(postRes)}`)
          }
        } else {
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
        }
      }
    } catch (tagErr: any) {
      log(`[Patrol] 巡查關鍵字 "${tag}" 發生錯誤: ${tagErr.message}`)
      notes.push(`關鍵字 ${tag} 異常: ${tagErr.message}`)
      if (/feedback|action block|checkpoint|rate limit/i.test(tagErr.message)) {
        ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, tagErr.message)
        break
      }
    }
  }

  notes.push(`本輪巡查結束：處理新貼文 ${processed} 則，推薦留言 ${recommended} 則`)
  return { ok: true, processedPosts: processed, recommendedCount: recommended, notes }
}
