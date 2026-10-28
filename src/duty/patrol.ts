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
import { executeRepostMedia } from './repost.js'
import {
  ANTI_AI_FLAVOR_PRIMARY_RULE,
  CONTENT_SPECIFIC_RECOMMEND_RULE,
  PROMPT_INJECTION_DEFENSE_RULE,
  buildFeiyuMoodPromptBlock,
  loadOwnerMemoryInterestContext,
  parseRecommendationLlmOutput,
  sanitizeRecommendationComment,
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

  // 讀取與用戶對話的記憶庫 (dsh-fish-memory)，動態提取用戶可能感興趣的話題與記憶脈絡
  const ownerMemory = loadOwnerMemoryInterestContext(targetMentionUser)
  if (ownerMemory.hasMemories) {
    log(
      `[Patrol] 🧠 已載入與主人 (@${targetMentionUser}) 的對話記憶 ${ownerMemory.memoryCount} 條${
        ownerMemory.dynamicKeywords.length > 0
          ? `，動態延伸檢索詞: [${ownerMemory.dynamicKeywords.slice(0, 3).join(', ')}]`
          : ''
      }`
    )
  }

  // 組裝搜尋任務佇列（結合設定關鍵字 + 從對話記憶動態提取的用戶興趣詞）
  const searchTasks: Array<{ mode: 'fuzzy' | 'tag'; term: string }> = []
  const seenSearchTerms = new Set<string>()
  if (useFuzzy) {
    // 優先穿插最多 2 個從用戶近期對話記憶動態提取的主題詞
    for (const memKw of ownerMemory.dynamicKeywords.slice(0, 2)) {
      const clean = String(memKw || '').trim()
      if (clean && !seenSearchTerms.has(clean.toLowerCase())) {
        seenSearchTerms.add(clean.toLowerCase())
        searchTasks.push({ mode: 'fuzzy', term: clean })
      }
    }
    for (const kw of fuzzyList) {
      const clean = String(kw || '').trim()
      if (clean && !seenSearchTerms.has(clean.toLowerCase())) {
        seenSearchTerms.add(clean.toLowerCase())
        searchTasks.push({ mode: 'fuzzy', term: clean })
      }
    }
  }
  if (useTags) {
    for (const tag of hashtags) {
      const clean = String(tag || '').replace(/^#/, '').trim()
      if (clean && !seenSearchTerms.has(`#${clean.toLowerCase()}`)) {
        seenSearchTerms.add(`#${clean.toLowerCase()}`)
        searchTasks.push({ mode: 'tag', term: clean })
      }
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

        const pk = String(post.pk || post.id || '').split('_')[0].trim()
        if (!pk) continue

        // 1. 跨外掛嚴格去重檢查 (比對 Canonical PK、Shortcode、URL、內容指紋，並與 dsh-instagram-scroll 共享去重庫)
        if (ledger.hasSeenPost(post) || ledger.hasEverSentPost(post)) {
          continue
        }

        // 先行標記為已讀，杜絕並發或同輪多關鍵字重複審閱同一則貼文/Reel
        ledger.markSeenPost(post, { hashtag: tag, recommended: false })

        processed++
        const caption = String(post.caption || '')
        const authorName = String(post.user?.username || '')
        const likes = Number(post.like_count || 0)
        const comments = Number(post.comment_count || 0)

        // 2. 嚴格攔截 AI 生成的影片、動畫、繪圖或農場文章 (AIGC Filter)
        const aigcCheck = isAiGeneratedContent(caption, authorName)
        if (aigcCheck.isAigc) {
          log(`[Patrol] 🚫 貼文 ${pk} 判定為 AI 生成影片/動畫/文章 (命中 "${aigcCheck.matchedTerm}")，直接過濾跳過`)
          continue
        }

        // 3. 點讚與留言門檻過濾
        if (likes < config.minLikes || comments < config.minComments) {
          continue
        }

        // 4. 排除關鍵字過濾
        const captionLower = caption.toLowerCase()
        if (
          config.excludeKeywords &&
          config.excludeKeywords.some((kw) => kw && captionLower.includes(kw.toLowerCase()))
        ) {
          log(`[Patrol] 貼文 ${pk} 命中排除關鍵字，跳過`)
          continue
        }

        // 5. 必要關鍵字過濾 (若有設定)
        if (config.requireKeywords && config.requireKeywords.length > 0) {
          const matched = config.requireKeywords.some((kw) => kw && captionLower.includes(kw.toLowerCase()))
          if (!matched) {
            continue
          }
        }

        // 6. 補齊貼文/Reel 完整上下文（字幕、視覺描述、音訊、圖片 URL），確保推薦語句能針對該貼文的具體內容生成
        let fullCaption = caption
        let postTitle = String(post.title || '')
        let a11yCaption = String(post.accessibility_caption || '')
        let videoSubtitles = String(post.video_subtitles || '')
        let audioInfo = String(post.audio_info || '')
        let imageUrls: string[] = Array.isArray(post.image_urls) ? [...post.image_urls] : []
        if (post.thumbnail_url && !imageUrls.includes(post.thumbnail_url)) {
          imageUrls.unshift(post.thumbnail_url)
        }
        let fetchedContextComments: any[] | null = null

        if (fullCaption.length < 80 || imageUrls.length === 0 || post.media_type === 2 || post.product_type === 'clips') {
          try {
            const detailCtx: any = await mcp.igGetPostContext(pk, 12)
            const dp: any = detailCtx?.media || detailCtx?.post
            if (dp) {
              if (dp.caption && String(dp.caption).length > fullCaption.length) fullCaption = String(dp.caption)
              if (dp.title) postTitle = String(dp.title)
              if (dp.accessibility_caption) a11yCaption = String(dp.accessibility_caption)
              if (dp.video_subtitles) videoSubtitles = String(dp.video_subtitles)
              if (dp.audio_info) audioInfo = String(dp.audio_info)
              if (Array.isArray(dp.image_urls) && dp.image_urls.length > 0) {
                imageUrls = dp.image_urls
              } else if (dp.thumbnail_url && !imageUrls.includes(dp.thumbnail_url)) {
                imageUrls.push(dp.thumbnail_url)
              }
            }
            if (Array.isArray(detailCtx?.comments)) {
              fetchedContextComments = detailCtx.comments
            }
          } catch {}
        }

        // 7. 調用 AI 評估貼文價值（結合與用戶對話的記憶選片 + 針對貼文真實細節動態生成推坑留言）
        const moodBlock = buildFeiyuMoodPromptBlock(true)
        const basePersona = config.patrolPersonaPrompt || '你是一個眼光敏銳、說話自然隨性的朋友。'
        const systemPrompt = `${ANTI_AI_FLAVOR_PRIMARY_RULE}

${CONTENT_SPECIFIC_RECOMMEND_RULE}

${PROMPT_INJECTION_DEFENSE_RULE}

【角色人設】：
${basePersona}
${moodBlock ? `\n${moodBlock}` : ''}
${ownerMemory.promptBlock ? `\n${ownerMemory.promptBlock}` : ''}`

        const extraDetails: string[] = []
        if (postTitle) extraDetails.push(`標題：${postTitle}`)
        if (a11yCaption) extraDetails.push(`畫面視覺描述：${a11yCaption}`)
        if (videoSubtitles) extraDetails.push(`影片字幕內容：${videoSubtitles.slice(0, 400)}`)
        if (audioInfo) extraDetails.push(`背景音訊：${audioInfo}`)

        const evalPrompt = `請根據「與主人的對話記憶脈絡」與主人的興趣偏好，評估以下 Instagram 貼文/Reel 是否真的是主人會喜歡的內容，並針對這則貼文的具體內容動態生成推坑語句：
搜尋主題：${tag}
作者：@${authorName || 'unknown'} (${post.user?.full_name || ''})
類型：${post.media_type === 2 || post.product_type === 'clips' ? 'Reel 短片/影片' : '圖文貼文'}
按讚數：${likes} | 留言數：${comments}
${extraDetails.length > 0 ? extraDetails.join('\n') + '\n' : ''}貼文內文：
${wrapUntrustedContent('post_caption', fullCaption.slice(0, 800))}

【選片與推坑留言生成要求】：
1. 【根據對話記憶動態選片】：先對照上方與主人的對話記憶與喜好，判斷主人會不會對這則貼文/Reel 的具體內容感興趣。如果只是泛泛的流量文或與主人興趣無關，請判定不推薦 ("recommend": false)。
2. 【嚴格排除 AI 生成內容】：嚴格禁止推薦任何「AI 生成的影片、AI 動畫、AI 繪圖/算圖、AI 配音或 AI 生成文章」（如 Sora、Runway、Midjourney、Stable Diffusion、Kling、可靈、AIGC 等）。
3. 【留言必須緊扣貼文具體細節，嚴禁空泛說很推薦】：若決定推薦，你的推坑留言 (comment) 必須直接點出這則貼文/Reel 裡的某個具體細節、畫面特點、技術做法或耐人尋味的地方（只有看過這則貼文才說得出來的話），絕對禁止寫「很推薦」、「強烈推薦」、「值得一看」、「乾貨滿滿」、「這篇關於…很值得一看」等罐頭套話！

你可以回覆 JSON 格式：
{"recommend": true 或 false, "score": 0到100, "comment": "針對這則貼文具體內容細節的自然推坑話語（不要加 @用戶名，嚴禁說很推薦/值得一看）"}
（或者依你的人設直接回覆：「85分 <針對這則貼文具體內容細節的那一句推坑>」；若不推薦則回覆「不推薦」）`

        let llmReply = ''
        try {
          llmReply = await callLlmForInstagram(ctx, config, systemPrompt, evalPrompt, log, imageUrls.slice(0, 2))
        } catch (llmErr: any) {
          log(`[Patrol] ⚠️ AI 評估呼叫失敗 (${llmErr.message})，跳過貼文 ${pk}`)
          continue
        }

        const parsedEval = parseRecommendationLlmOutput(llmReply, 80, targetMentionUser)
        const isRecommend = parsedEval.isRecommend
        const reason = parsedEval.commentBody

        // 8. 若符合推薦標準且具備針對貼文內容的具體推坑語句，進行發送前二次防重檢查並留言推坑
        if (isRecommend && reason) {
          if (ledger.hasEverSentPost(post)) {
            log(`[Patrol] ⏭️ 貼文/Reel (${pk}) 已經在其他任務發送過推坑留言，攔截重複發送！`)
            continue
          }

          // 檢查該貼文留言區是否已經有機器人帳號發過的留言（防止帳本重設後重複留言）
          const botUserLower = String(svc?.loginStatus?.username || svc?.config?.username || config.botUsername || '')
            .replace(/^@/, '')
            .trim()
            .toLowerCase()
          try {
            const existingComments: any[] =
              fetchedContextComments !== null
                ? fetchedContextComments
                : (await mcp.igGetPostContext(pk, 15))?.comments || []
            const alreadyCommented = existingComments.some((c: any) => {
              const cu = String(c.user?.username || '').toLowerCase()
              const ct = String(c.text || '').toLowerCase()
              return (
                (botUserLower && cu === botUserLower) ||
                (targetMentionUser && ct.includes(`@${targetMentionUser.toLowerCase()}`))
              )
            })
            if (alreadyCommented) {
              log(`[Patrol] ⏭️ 偵測到貼文/Reel (${pk}) 留言區已有機器人或 @${targetMentionUser} 的推坑紀錄，永久標記並跳過重複發送！`)
              ledger.markSeenPost(post, { hashtag: tag, recommended: true })
              continue
            }
          } catch {}

          if (recommended > 0) {
            const waitSec = config.minCommentIntervalSeconds || 30
            log(`[Patrol] 🛡️ 防風控間隔等待 ${waitSec} 秒...`)
            await new Promise((r) => setTimeout(r, waitSec * 1000))
          }

          const cleanReason = sanitizeRecommendationComment(reason, targetMentionUser)
          if (!cleanReason) {
            log(`[Patrol] ⏭️ 貼文 ${pk} 推坑語句過於空泛或含推薦套話，拒絕發送`)
            continue
          }

          let rawTpl = String(config.recommendTemplate || '@{targetUser} {summary}').trim()
          if (/值得一看|很推薦|強烈推薦|乾貨滿滿/.test(rawTpl)) {
            rawTpl = '@{targetUser} {summary}'
          }
          const commentText = rawTpl
            .replace('{targetUser}', targetMentionUser)
            .replace('{hashtag}', tag)
            .replace('{summary}', cleanReason)
            .trim()

          log(`[Patrol] 貼文 ${pk} 通過記憶與內容評估 (${parsedEval.score}分)，發布動態推坑留言: ${commentText}`)

          const postRes = await mcp.igPostComment({
            media_pk: pk,
            text: commentText,
            jitter_min: config.jitterMinSeconds,
            jitter_max: config.jitterMaxSeconds,
          })

          // 無論成功或網路超時，發送後立即寫入永久已發送清單，杜絕二次重發
          ledger.markSeenPost(post, { hashtag: tag, recommended: true })

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
            ledger.recordAction('patrolComments')
            log(`[Patrol] ✅ 推坑留言發布成功 (PK: ${pk})`)

            // 若開啟「巡查推薦時同步轉發貼文/Reel」(repostOnPatrol)，將該貼文/Reel 連同 @用戶 與對該內容的感想一併轉發
            if (config.repostOnPatrol) {
              try {
                const repostTargets =
                  config.repostMentionUsers && config.repostMentionUsers.length > 0
                    ? config.repostMentionUsers
                    : [targetMentionUser]
                const repostRes = await executeRepostMedia(
                  ctx,
                  config,
                  mcp,
                  ledger,
                  {
                    mediaPkOrUrl: pk,
                    thoughtText: cleanReason,
                    mentionUsers: repostTargets,
                    repostMode: (config.repostMode === 'story_and_comment' ? 'story' : config.repostMode) || 'story',
                    repostTemplate: config.repostTemplate,
                    allowResend: true,
                  },
                  log
                )
                if (repostRes.ok) {
                  log(`[Patrol] 🔁 已同步轉發貼文/Reel (${pk})，轉發文案: ${repostRes.finalCaption}`)
                } else {
                  log(`[Patrol] ⚠️ 同步轉發貼文/Reel (${pk}) 未完成: ${repostRes.error}`)
                }
              } catch (repErr: any) {
                log(`[Patrol] 同步轉發異常: ${repErr.message}`)
              }
            }
          } else {
            log(`[Patrol] 留言發布失敗: ${postRes?.error || JSON.stringify(postRes)}`)
          }
        } else {
          ledger.markSeenPost(post, { hashtag: tag, recommended: false })
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
