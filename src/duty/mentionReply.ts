/**
 * src/duty/mentionReply.ts —— 貼文留言 @ 提問監聽與上下文推理應答 (Mention Reply Duty)
 * ============================================================================
 * 職責：
 * 1. 監聽貼文評論區，尋找含有 @機器人帳號 且尚未處理的提問留言。
 * 2. 進行黑白名單、Round Cap（單篇上限輪數）與當日配額驗證。
 * 3. 取得該貼文的完整上下文（發布者、內文、相鄰留言）。
 * 4. 由 LLM 針對貼文內容進行推理思考，生成精簡專業之解答。
 * 5. 以巢狀子留言（Reply）回覆提問用戶，並登記留言 PK 至帳本。
 * ============================================================================
 */

import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'

export interface MentionReplyDutyResult {
  ok: boolean
  scannedComments: number
  repliedCount: number
  notes: string[]
}

async function callLlmForReply(
  ctx: any,
  systemPrompt: string,
  postContext: string,
  questionUser: string,
  questionText: string
): Promise<string> {
  const userPrompt = `【貼文上下文】：
${postContext}

【提問用戶】：@${questionUser}
【用戶問題】：${questionText}

請作為專業助理，依據上方貼文內容與前後脈絡思考後給予簡短、精準、友善的解答（回覆長度請保持在 120 字以內，不要廢話）：`

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
      console.warn(`[MentionReply LLM] ctx.llm 調用異常: ${e.message}`)
    }
  }

  // 外部 API 備援
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
          temperature: 0.6,
        }),
      })
      if (resp.ok) {
        const data = await resp.json() as any
        return data.choices?.[0]?.message?.content || ''
      }
    } catch (err: any) {
      console.warn(`[MentionReply LLM] 外部 API 調用異常: ${err.message}`)
    }
  }

  return '你好！已收到你的提問，貼文重點在於技術架構與實踐方案，如有具體疑問歡迎進一步討論。'
}

/** 執行單輪被 @ 留言監聽與應答 */
export async function executeMentionReplyDuty(
  ctx: any,
  config: InstagramPluginConfig,
  mcp: InstagramMcpClient,
  ledger: LedgerManager,
  log: (msg: string) => void = console.log
): Promise<MentionReplyDutyResult> {
  const notes: string[] = []
  let scanned = 0
  let replied = 0

  if (!config.mentionReplyEnabled) {
    notes.push('被 @ 應答任務已在設定中關閉 (mentionReplyEnabled=false)')
    return { ok: true, scannedComments: 0, repliedCount: 0, notes }
  }

  const botName = (config.botUsername || '').replace(/^@/, '').trim().toLowerCase()
  if (!botName) {
    notes.push('未設定機器人帳號名稱 (botUsername 為空)，無法比對被 @ 留言')
    return { ok: true, scannedComments: 0, repliedCount: 0, notes }
  }

  if (!ledger.canDoDaily('mentionReplies', config.maxDailyMentionReplies)) {
    notes.push(`已達每日被 @ 回覆上限 (${config.maxDailyMentionReplies} 則)`)
    return { ok: true, scannedComments: 0, repliedCount: 0, notes }
  }

  // 取得巡查帳本中最近記錄的貼文清單來掃描評論區
  const ledgerState = (ledger as any).state || {}
  const candidatePostPks = Object.keys(ledgerState.seenPosts || {}).slice(-15).reverse()

  log(`[MentionReply] 開始檢查近期 ${candidatePostPks.length} 則貼文評論區中 @${botName} 的提問...`)

  for (const postPk of candidatePostPks) {
    if (!ledger.canDoDaily('mentionReplies', config.maxDailyMentionReplies)) {
      break
    }

    // 檢查該貼文是否已達對話輪數上限 Round Cap
    if (!ledger.canReplyToPost(postPk, config.roundCapPerPost)) {
      continue
    }

    try {
      const contextRes = await mcp.igGetPostContext(postPk, config.maxContextComments || 10)
      if (!contextRes?.ok) continue

      const media: any = contextRes.media || {}
      const comments: any[] = contextRes.comments || []

      for (const c of comments) {
        if (!ledger.canDoDaily('mentionReplies', config.maxDailyMentionReplies)) {
          break
        }

        const commentPk = String(c.pk || '')
        const commentUser = String(c.user?.username || '').toLowerCase()
        const commentText = String(c.text || '')

        if (!commentPk || commentUser === botName) {
          continue
        }

        scanned++

        // 1. 檢查是否已被處理過
        if (ledger.hasSeenComment(commentPk)) {
          continue
        }

        // 2. 檢查內文是否提及 @機器人帳號
        const isMentioned = commentText.toLowerCase().includes(`@${botName}`)
        if (!isMentioned) {
          continue
        }

        log(`[MentionReply] 偵測到來自 @${commentUser} 的提問: "${commentText}" (PK: ${commentPk})`)

        // 3. 黑名單與白名單過濾
        if (config.blacklistUsers && config.blacklistUsers.includes(commentUser)) {
          log(`[MentionReply] 用戶 @${commentUser} 在黑名單中，跳過回覆`)
          ledger.markSeenComment(commentPk, { postPk, user: commentUser })
          continue
        }

        if (config.whitelistUsers && config.whitelistUsers.length > 0 && !config.whitelistUsers.includes(commentUser)) {
          log(`[MentionReply] 用戶 @${commentUser} 不在白名單中，跳過回覆`)
          ledger.markSeenComment(commentPk, { postPk, user: commentUser })
          continue
        }

        // 4. 檢查 Round Cap
        if (!ledger.canReplyToPost(postPk, config.roundCapPerPost)) {
          log(`[MentionReply] 貼文 ${postPk} 已達單篇回覆輪數上限 (${config.roundCapPerPost} 輪)，跳過`)
          ledger.markSeenComment(commentPk, { postPk, user: commentUser })
          break
        }

        // 5. 組裝完整上下文 Prompt
        const neighborComments = comments
          .filter((item) => String(item.pk) !== commentPk)
          .slice(-5)
          .map((item) => `@${item.user?.username}: ${item.text}`)
          .join('\n')

        const postContextText = `貼文作者：@${media.user?.username || '未知'}
貼文短碼：${media.code}
貼文內文：
${media.caption || '(無內文)'}

近期鄰近留言：
${neighborComments || '(無相鄰留言)'}`

        const systemPrompt = config.mentionPersonaPrompt || '你是一個溫和聰慧的 AI 助理。'
        const generatedAnswer = await callLlmForReply(ctx, systemPrompt, postContextText, commentUser, commentText)

        // 6. 發布巢狀子留言回覆 (Reply)
        const replyText = `@${commentUser} ${generatedAnswer}`.trim()
        log(`[MentionReply] 正在以巢狀留言回覆 @${commentUser}: ${replyText.slice(0, 50)}...`)

        const postResult = await mcp.igPostComment({
          media_pk: postPk,
          text: replyText,
          reply_to_comment_pk: commentPk,
          jitter_min: config.jitterMinSeconds,
          jitter_max: config.jitterMaxSeconds,
        })

        if (postResult?.ok) {
          replied++
          ledger.markSeenComment(commentPk, { postPk, user: commentUser })
          ledger.incrementPostReplyRound(postPk)
          ledger.incrementDaily('mentionReplies')
          log(`[MentionReply] 成功回覆留言 (Post PK: ${postPk}, Comment PK: ${commentPk})`)
        } else {
          log(`[MentionReply] 回覆留言失敗: ${postResult?.error || JSON.stringify(postResult)}`)
        }
      }
    } catch (postErr: any) {
      log(`[MentionReply] 處理貼文 ${postPk} 留言異常: ${postErr.message}`)
    }
  }

  notes.push(`本輪提問監聽結束：掃描留言 ${scanned} 則，完成回覆 ${replied} 則`)
  return { ok: true, scannedComments: scanned, repliedCount: replied, notes }
}
