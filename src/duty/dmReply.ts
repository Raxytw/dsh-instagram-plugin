/**
 * src/duty/dmReply.ts —— 私訊 (DM) 雙向自動回覆任務 (DM Reply Duty)
 * ============================================================================
 * 職責：
 * 1. 定時呼叫未讀私訊獲取 Tool。
 * 2. 針對未處理的最新訊息進行白名單、用戶日上限與全域日上限檢驗。
 * 3. 透過統一 LLM 模組 (支援讀取外部插件 dsh-plugin-subscriptions 額度與自訂 API)
 *    由 AI 即時生成自然回覆（嚴禁使用固定罐頭回覆）。
 * 4. 調用發送私訊 Tool 回覆用戶，並將訊息 ID 登記至帳本。
 * ============================================================================
 */

import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import { callLlmForInstagram } from '../lib/llm.js'
import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'

export interface DmReplyDutyResult {
  ok: boolean
  processedThreads: number
  repliedCount: number
  notes: string[]
}

/** 執行單輪未讀私訊收取與 AI 應答 */
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

  // 防風控冷卻保護檢查
  if (ledger.isInCooldown()) {
    const rem = ledger.getCooldownRemainingSeconds()
    const reason = ledger.getCooldownReason()
    notes.push(`防風控冷卻保護中（剩餘 ${rem} 秒，原因: ${reason}），暫停私訊應答`)
    log(`[DmReply] 🚨 帳號目前處於防風控冷卻期（剩餘 ${rem} 秒），本輪跳過私訊應答`)
    return { ok: true, processedThreads: 0, repliedCount: 0, notes }
  }

  // 小時頻次防護
  if (!ledger.canDoHourly('dmReplies', config.maxHourlyDmReplies || 8)) {
    notes.push(`已達每小時私訊回覆上限 (${config.maxHourlyDmReplies || 8} 則)`)
    log(`[DmReply] 已達近一小時私訊回覆上限 (${config.maxHourlyDmReplies || 8} 則)，本輪不再回覆新私訊`)
    return { ok: true, processedThreads: 0, repliedCount: 0, notes }
  }

  if (!ledger.canDoDaily('dmReplies', config.dmDailyCap)) {
    notes.push(`已達全域每日私訊回覆上限 (${config.dmDailyCap} 則)`)
    return { ok: true, processedThreads: 0, repliedCount: 0, notes }
  }

  const maxPerRun = config.maxDmRepliesPerRun || 3
  log(`[DmReply] 開始檢查未讀私訊會話 (本輪上限: ${maxPerRun} 則)...`)

  try {
    const res = await mcp.igGetUnreadDms(10)
    const threads: any[] = res?.threads || []
    log(`[DmReply] 獲取到 ${threads.length} 條私訊對話線程`)

    for (const thread of threads) {
      if (
        replied >= maxPerRun ||
        !ledger.canDoDaily('dmReplies', config.dmDailyCap) ||
        !ledger.canDoHourly('dmReplies', config.maxHourlyDmReplies || 8)
      ) {
        break
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

      // 若線程未讀，或最後一則為對方剛發送且尚未被帳本處理的訊息
      const isPendingIncoming = thread.unread || (!lastMsg.is_outgoing && !ledger.hasSeenMessage(msgId))
      if (!isPendingIncoming) {
        continue
      }

      processed++

      // 取得發訊用戶資訊 (若 1 對 1 私訊未比對到 pk 則安全退回唯一的對話夥伴)
      let senderObj = (thread.users || []).find((u: any) => String(u.pk) === String(lastMsg.user_id))
      if (!senderObj && Array.isArray(thread.users) && thread.users.length === 1) {
        senderObj = thread.users[0]
      }
      const senderUsername = senderObj?.username || 'user'
      const senderPk = String(lastMsg.user_id || senderObj?.pk || threadId)

      // 2. 白名單模式過濾
      if (config.dmWhitelistOnly) {
        const allowed =
          config.dmWhitelist &&
          config.dmWhitelist.map((u) => u.replace(/^@/, '').toLowerCase()).includes(senderUsername.toLowerCase())
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

      // 4. 調用 AI 模型生成自然應答 (支援讀取 dsh-plugin-subscriptions 外部額度與自訂 API)
      const systemPrompt = config.dmPersonaPrompt || '你是一個禮貌溫暖的社群助理。'
      const recentHistory = Array.isArray(thread.messages)
        ? thread.messages
            .slice(0, 6)
            .reverse()
            .map((m: any) => `${m.is_outgoing ? '[我]' : `[@${senderUsername}]`}: ${m.text || ''}`)
            .join('\n')
        : ''

      const userPrompt = `【對話環境】：Instagram 私訊 (Direct Message)
${recentHistory ? `【近期對話脈絡】：\n${recentHistory}\n\n` : ''}【私訊對象】：@${senderUsername}
【對方最新訊息】："${lastMsg.text}"

請依據人設以自然口吻直接生成回覆內容（字數控制在 80 字以內，不要加引號或解釋；若依人設判斷不需回覆，請只輸出 [NO_REPLY]）：`

      let replyContent = ''
      try {
        replyContent = await callLlmForInstagram(ctx, config, systemPrompt, userPrompt, log)
      } catch (llmErr: any) {
        log(`[DmReply] ❌ AI 模型生成私訊回覆失敗，跳過發送 (不使用罐頭訊息): ${llmErr.message}`)
        notes.push(`AI 生成失敗 (@${senderUsername}): ${llmErr.message}`)
        continue
      }

      const cleanedReply = (replyContent || '').trim()
      if (!cleanedReply || cleanedReply === '[NO_REPLY]' || cleanedReply.startsWith('[系統提示]')) {
        log(`[DmReply] AI 判定不回覆或回傳系統提示 (${cleanedReply.slice(0, 30)})，標記已讀並跳過`)
        ledger.markSeenMessage(msgId, { threadId, userId: senderPk })
        continue
      }

      // 防風控間隔等待
      if (replied > 0) {
        log(`[DmReply] 🛡️ 防風控間隔等待 15 秒...`)
        await new Promise((r) => setTimeout(r, 15000))
      }

      log(`[DmReply] 準備發送 AI 私訊回覆給 @${senderUsername}: "${cleanedReply}"`)

      // 5. 調用 MCP 發送私訊
      const sendRes = await mcp.igSendDm({
        thread_id: threadId,
        text: cleanedReply,
        jitter_min: config.jitterMinSeconds,
        jitter_max: config.jitterMaxSeconds,
      })

      if (
        sendRes?.in_cooldown ||
        (sendRes?.error && /action block|feedback|checkpoint|please wait|rate limit/i.test(sendRes.error))
      ) {
        ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, sendRes.error || 'Instagram 頻率風控阻擋')
        log(`[DmReply] 🚨 偵測到風控或熔斷保護，停止後續私訊回覆！`)
        notes.push(`觸發防風控熔斷: ${sendRes.error}`)
        break
      }

      if (sendRes?.ok) {
        replied++
        ledger.markSeenMessage(msgId, { threadId, userId: senderPk })
        ledger.incrementUserDm(senderPk)
        ledger.recordAction('dmReplies')
        log(`[DmReply] ✅ AI 私訊回覆成功發送至線程 ${threadId}`)
      } else {
        log(`[DmReply] 私訊發送失敗: ${sendRes?.error || JSON.stringify(sendRes)}`)
      }
    }
  } catch (err: any) {
    log(`[DmReply] 處理未讀私訊異常: ${err.message}`)
    notes.push(`私訊處理異常: ${err.message}`)
    if (/feedback|action block|checkpoint|rate limit/i.test(err.message)) {
      ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, err.message)
    }
  }

  notes.push(`本輪私訊檢查結束：處理未讀 ${processed} 則，成功 AI 回覆 ${replied} 則`)
  return { ok: true, processedThreads: processed, repliedCount: replied, notes }
}
