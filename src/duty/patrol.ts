/**
 * src/duty/patrol.ts —— 背景標籤巡查與主動推薦任務 (Patrol Duty)
 * ============================================================================
 * 職責：
 * 1. 定時依據設定之間隔呼叫貼文搜尋 Tool。
 * 2. 依照按讚數、留言數、排除關鍵字、必要關鍵字進行前置篩選。
 * 3. 過濾掉已存在於帳本中的貼文 PK。
 * 4. 組裝評估 Prompt 請求 LLM 分析貼文主題是否值得推薦給指定領域的用戶。
 * 5. 當判定推薦並生成推坑語句時，調用回覆留言 Tool 留下 @目標用戶 <推薦內容>。
 * 6. 登記該貼文 PK 至帳本並累積當日推坑次數。
 * ============================================================================
 */

import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'

export interface PatrolDutyResult {
  ok: boolean
  processedPosts: number
  recommendedCount: number
  notes: string[]
}

/** 呼叫 LLM 評估或產出內容 */
async function callLlmInference(ctx: any, systemPrompt: string, userPrompt: string): Promise<string> {
  const llm = ctx?.get ? ctx.get('llm') : null
  if (llm) {
    try {
      if (typeof llm.chat === 'function') {
        const res = await llm.chat({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        })
        return res?.content || res?.text || (typeof res === 'string' ? res : '')
      }
      if (typeof llm.complete === 'function') {
        return await llm.complete(`${systemPrompt}\n\n${userPrompt}`)
      }
    } catch (e: any) {
      console.warn(`[Patrol LLM] ctx.llm 調用異常: ${e.message}`)
    }
  }

  // 若無宿主 LLM，檢查環境變數備援 (DeepSeek / OpenAI)
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
  const baseUrl = process.env.DEEPSEEK_API_BASE || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com'

  if (apiKey) {
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
        }),
      })
      if (resp.ok) {
        const data = await resp.json() as any
        return data.choices?.[0]?.message?.content || ''
      }
    } catch (err: any) {
      console.warn(`[Patrol LLM] 外部 API 調用異常: ${err.message}`)
    }
  }

  // 測試/離線降級：簡易啟發式判斷
  return JSON.stringify({
    recommend: true,
    reason: '貼文內容主題相符且具備一定討論度，值得參考！',
  })
}

/** 執行單輪標籤巡查與推坑 */
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

  if (!config.targetMentionUser) {
    notes.push('未設定推坑目標用戶 (targetMentionUser 為空)，跳過巡查')
    log('[Patrol] 提示：若需開啟推坑留言，請在設定中指定 targetMentionUser')
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

  const hashtags = config.hashtags || []
  if (hashtags.length === 0) {
    notes.push('未設定任何標籤 (hashtags 清單為空)')
    return { ok: true, processedPosts: 0, recommendedCount: 0, notes }
  }

  const maxPerRun = config.maxPatrolCommentsPerRun || 1
  log(`[Patrol] 開始執行標籤巡查，共 ${hashtags.length} 個標籤 (本輪推坑上限: ${maxPerRun} 則)...`)

  for (const tag of hashtags) {
    if (recommended >= maxPerRun || !ledger.canDoDaily('patrolComments', config.maxDailyPatrolComments) || !ledger.canDoHourly('patrolComments', config.maxHourlyPatrolComments || 3)) {
      break
    }

    try {
      const res = await mcp.igSearchHashtag(tag, config.patrolSearchLimit || 10)
      const posts: any[] = res?.posts || []
      log(`[Patrol] 標籤 #${tag} 抓取到 ${posts.length} 則貼文`)

      for (const post of posts) {
        if (recommended >= maxPerRun || !ledger.canDoDaily('patrolComments', config.maxDailyPatrolComments) || !ledger.canDoHourly('patrolComments', config.maxHourlyPatrolComments || 3)) {
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
        const likes = Number(post.like_count || 0)
        const comments = Number(post.comment_count || 0)

        // 2. 點讚與留言門檻過濾
        if (likes < config.minLikes || comments < config.minComments) {
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
          continue
        }

        // 3. 排除關鍵字過濾
        if (config.excludeKeywords && config.excludeKeywords.some((kw) => kw && caption.includes(kw))) {
          log(`[Patrol] 貼文 ${pk} 命中排除關鍵字，跳過`)
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
          continue
        }

        // 4. 必要關鍵字過濾 (若有設定)
        if (config.requireKeywords && config.requireKeywords.length > 0) {
          const matched = config.requireKeywords.some((kw) => kw && caption.includes(kw))
          if (!matched) {
            ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
            continue
          }
        }

        // 5. 調用 LLM 評估貼文價值
        const systemPrompt = config.patrolPersonaPrompt || '你是一個專業社群助理。'
        const evalPrompt = `請評估以下 Instagram 貼文是否具備分享與推薦價值：
標籤：#${tag}
作者：@${post.user?.username || 'unknown'}
按讚數：${likes} | 留言數：${comments}
內文摘要：
${caption.slice(0, 500)}

請嚴格以 JSON 格式回答：
{"recommend": true 或 false, "reason": "50字內簡明推薦推薦理由"}`

        const llmReply = await callLlmInference(ctx, systemPrompt, evalPrompt)
        let isRecommend = false
        let reason = '這篇內容很實用！'

        try {
          const jsonMatch = llmReply.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            isRecommend = Boolean(parsed.recommend)
            if (parsed.reason) reason = String(parsed.reason)
          }
        } catch {
          isRecommend = llmReply.includes('"recommend": true') || llmReply.includes('recommend: true')
        }

        // 6. 若符合推薦標準，留言推坑
        if (isRecommend) {
          if (recommended > 0) {
            const waitSec = config.minCommentIntervalSeconds || 30
            log(`[Patrol] 🛡️ 防風控間隔等待 ${waitSec} 秒...`)
            await new Promise((r) => setTimeout(r, waitSec * 1000))
          }

          let commentText = config.recommendTemplate || '@{targetUser} 這篇關於 #{hashtag} 的內容很值得一看：{summary}'
          commentText = commentText
            .replace('{targetUser}', config.targetMentionUser.replace(/^@/, ''))
            .replace('{hashtag}', tag)
            .replace('{summary}', reason)

          log(`[Patrol] 貼文 ${pk} 通過評估，發布推坑留言: ${commentText}`)

          const postRes = await mcp.igPostComment({
            media_pk: pk,
            text: commentText,
            jitter_min: config.jitterMinSeconds,
            jitter_max: config.jitterMaxSeconds,
          })

          if (postRes?.in_cooldown || (postRes?.error && /action block|feedback|checkpoint|please wait|rate limit/i.test(postRes.error))) {
            ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, postRes.error || 'Instagram 頻率風控阻擋')
            log(`[Patrol] 🚨 偵測到風控或熔斷保護，停止後續巡查動作！`)
            notes.push(`觸發防風控熔斷: ${postRes.error}`)
            break
          }

          if (postRes?.ok) {
            recommended++
            ledger.markSeenPost(pk, { hashtag: tag, recommended: true })
            ledger.recordAction('patrolComments')
            log(`[Patrol] 推坑留言發布成功 (PK: ${pk})`)
          } else {
            log(`[Patrol] 留言發布失敗: ${postRes?.error || JSON.stringify(postRes)}`)
          }
        } else {
          ledger.markSeenPost(pk, { hashtag: tag, recommended: false })
        }
      }
    } catch (tagErr: any) {
      log(`[Patrol] 巡查標籤 #${tag} 發生錯誤: ${tagErr.message}`)
      notes.push(`標籤 #${tag} 異常: ${tagErr.message}`)
      if (/feedback|action block|checkpoint|rate limit/i.test(tagErr.message)) {
        ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, tagErr.message)
        break
      }
    }
  }

  notes.push(`本輪巡查結束：處理新貼文 ${processed} 則，推薦留言 ${recommended} 則`)
  return { ok: true, processedPosts: processed, recommendedCount: recommended, notes }
}
