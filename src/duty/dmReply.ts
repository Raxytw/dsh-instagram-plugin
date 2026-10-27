/**
 * src/duty/dmReply.ts —— 私訊 (DM) 雙向自動回覆任務 (DM Reply Duty)
 * ============================================================================
 * 職責：
 * 1. 定時呼叫未讀私訊獲取 Tool。
 * 2. 針對未處理的最新訊息進行白名單、用戶日上限與全域日上限檢驗。
 * 3. 組裝上下文 Prompt 讓 LLM 扮演社群助手生成簡短自然且友善的解答。
 * 4. 調用發送私訊 Tool 回覆用戶，並將訊息 ID 登記至帳本。
 * ============================================================================
 */

import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'

export interface DmReplyDutyResult {
  ok: boolean
  processedThreads: number
  repliedCount: number
  notes: string[]
}

async function callLlmForDm(
  ctx: any,
  systemPrompt: string,
  senderUser: string,
  messageText: string
): Promise<string> {
  const userPrompt = `用戶 @${senderUser} 在 Instagram 私訊你說：
"${messageText}"

請以友善自然、溫暖簡潔的社群口吻回覆該用戶（回覆請限制在 80 字以內，不要使用長篇大論或刻板公文）：`

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
      console.warn(`[DmReply LLM] ctx.llm 調用異常: ${e.message}`)
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
          temperature: 0.7,
        }),
      })
      if (resp.ok) {
        const data = await resp.json() as any
        return data.choices?.[0]?.message?.content || ''
      }
    } catch (err: any) {
      console.warn(`[DmReply LLM] 外部 API 調用異常: ${err.message}`)
    }
  }

  return '你好！很高興收到你的私訊，我已經記錄下來了，有任何最新消息再隨時通知你！'
}

/** 執行單輪未讀私訊收取與應答 */
export async function executeDmReplyDuty(
  ctx: any,
  config: InstagramPluginConfig,
  mcp: InstagramMcpClient,
  ledger: LedgerManager,
  log: (msg: string) => void = console.log
): Promise<DmReplyDutyResult> {
  const notes: string[] = []
  let processed = 0
  let replied = 0

  if (!config.dmReplyEnabled) {
    notes.push('私訊回覆任務已在設定中關閉 (dmReplyEnabled=false)')
    return { ok: true, processedThreads: 0, repliedCount: 0, notes }
  }

  if (!ledger.canDoDaily('dmReplies', config.dmDailyCap)) {
    notes.push(`已達全域每日私訊回覆上限 (${config.dmDailyCap} 則)`)
    return { ok: true, processedThreads: 0, repliedCount: 0, notes }
  }

  log('[DmReply] 開始檢查未讀私訊會話...')

  try {
    const res = await mcp.igGetUnreadDms(10)
    const threads: any[] = res?.threads || []
    log(`[DmReply] 獲取到 ${threads.length} 條私訊對話線程`)

    for (const thread of threads) {
      if (!ledger.canDoDaily('dmReplies', config.dmDailyCap)) {
        break
      }

      if (!thread.unread) {
        continue
      }

      const lastMsg = thread.last_message
      if (!lastMsg || !lastMsg.id || !lastMsg.text || lastMsg.is_outgoing) {
        continue
      }

      const msgId = String(lastMsg.id)
      const threadId = String(thread.thread_id)

      // 1. 去重檢查
      if (ledger.hasSeenMessage(msgId)) {
        continue
      }

      processed++

      // 取得發訊用戶資訊
      const senderObj = (thread.users || []).find((u: any) => String(u.pk) === String(lastMsg.user_id))
      const senderUsername = senderObj?.username || 'user'
      const senderPk = String(lastMsg.user_id || senderObj?.pk || threadId)

      // 2. 白名單模式過濾
      if (config.dmWhitelistOnly) {
        const allowed = config.dmWhitelist && config.dmWhitelist.map((u) => u.replace(/^@/, '').toLowerCase()).includes(senderUsername.toLowerCase())
        if (!allowed) {
          log(`[DmReply] 用戶 @${senderUsername} 不在私訊白名單中，跳過回覆`)
          ledger.markSeenMessage(msgId, { threadId, userId: senderPk })
          continue
        }
      }

      // 3. 單一用戶每日上限檢查
      if (!ledger.canSendUserDm(senderPk, config.dmMaxPerUserPerDay)) {
        log(`[DmReply] 用戶 @${senderUsername} 已達單日上限 (${config.dmMaxPerUserPerDay} 則)，跳過`)
        ledger.markSeenMessage(msgId, { threadId, userId: senderPk })
        continue
      }

      log(`[DmReply] 收到來自 @${senderUsername} 的未讀私訊: "${lastMsg.text}"`)

      // 4. 調用 LLM 生成自然應答
      const systemPrompt = config.dmPersonaPrompt || '你是一個禮貌溫暖的社群助手。'
      const replyContent = await callLlmForDm(ctx, systemPrompt, senderUsername, lastMsg.text)

      log(`[DmReply] 準備發送私訊回覆給 @${senderUsername}: "${replyContent}"`)

      // 5. 調用 MCP 發送私訊
      const sendRes = await mcp.igSendDm({
        thread_id: threadId,
        text: replyContent.trim(),
        jitter_min: config.jitterMinSeconds,
        jitter_max: config.jitterMaxSeconds,
      })

      if (sendRes?.ok) {
        replied++
        ledger.markSeenMessage(msgId, { threadId, userId: senderPk })
        ledger.incrementUserDm(senderPk)
        ledger.incrementDaily('dmReplies')
        log(`[DmReply] 私訊回覆成功發送至線程 ${threadId}`)
      } else {
        log(`[DmReply] 私訊發送失敗: ${sendRes?.error || JSON.stringify(sendRes)}`)
      }
    }
  } catch (err: any) {
    log(`[DmReply] 處理未讀私訊異常: ${err.message}`)
    notes.push(`私訊處理異常: ${err.message}`)
  }

  notes.push(`本輪私訊檢查結束：處理未讀 ${processed} 則，成功回覆 ${replied} 則`)
  return { ok: true, processedThreads: processed, repliedCount: replied, notes }
}
