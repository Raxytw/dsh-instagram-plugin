/**
 * src/tools/igTools.ts —— 註冊給 DSH 主模型的 Instagram Tools
 * ============================================================================
 * 職責：
 * 將 MCP 暴露出的底層能力與自動化任務封裝為 DSH 標準 Tool 格式，
 * 支援使用者在 DSH 對話介面中直接命令主模型查詢 Instagram 狀態、
 * 搜尋標籤貼文、讀取貼文內文與留言、發布留言或私訊、以及手動觸發巡查任務。
 * 避免主模型因為找不到工具而誤去調用 BrowserSkill 或瀏覽器。
 * ============================================================================
 */

import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import type { InstagramMcpClient } from 'dsh-instagram-mcp'
import { executePatrolDuty } from '../duty/patrol.js'
import { executeMentionReplyDuty } from '../duty/mentionReply.js'
import { executeDmReplyDuty } from '../duty/dmReply.js'

export function registerIgTools(
  ctx: any,
  config: InstagramPluginConfig,
  getMcp: () => InstagramMcpClient | null,
  ledger: LedgerManager,
  log: (msg: string) => void = console.log
) {
  const tools = ctx?.tools || (ctx?.get ? ctx.get('tools') : null)

  const toStr = (v: any, fallback = ''): string => {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object' && typeof v.get === 'function') {
      const u = v.get()
      return typeof u === 'string' ? u : fallback
    }
    return fallback
  }

  const toolDefs = [
    {
      name: 'ig_check_status',
      description: '檢查 Instagram 插件連線狀態、帳號 Session 登入狀態與當日配額使用情形',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return {
            ok: false,
            mcpConnected: false,
            message: 'Instagram MCP 服務正在背景啟動或連線中，請稍候重試。',
            dailyStats: ledger.getDailyStats(),
          }
        }

        let sessionValid = false
        let sessionMsg = '未測試'
        try {
          const loginRes = await mcp.igLogin({
            session_path: toStr(config.sessionPath, 'data/ig_session.json') || 'data/ig_session.json',
            proxy_url: toStr(config.proxyUrl, ''),
          })
          sessionValid = Boolean(loginRes?.ok)
          sessionMsg = loginRes?.message || (sessionValid ? 'Session 有效' : '需重新登入')
        } catch (e: any) {
          sessionMsg = `連線檢查異常: ${e.message}`
        }

        const stats = ledger.getDailyStats()
        return {
          ok: true,
          mcpConnected: true,
          sessionValid,
          sessionStatus: sessionMsg,
          dailyStats: stats,
          configSnapshot: {
            username: toStr(config.username, ''),
            botUsername: toStr(config.botUsername, ''),
            targetMentionUser: toStr(config.targetMentionUser, ''),
            patrolEnabled: Boolean(config.patrolEnabled),
            mentionReplyEnabled: Boolean(config.mentionReplyEnabled),
            dmReplyEnabled: Boolean(config.dmReplyEnabled),
            hashtags: Array.isArray(config.hashtags) ? config.hashtags : [],
          },
        }
      },
    },

    {
      name: 'ig_search_hashtag',
      description: '在 Instagram 搜尋指定標籤（Hashtag）的最新熱門貼文列表（如 ai, deepseek, tech 等），挑選優質內容無需使用瀏覽器',
      parameters: {
        type: 'object',
        properties: {
          hashtag: {
            type: 'string',
            description: '標籤名稱（例如 tech, deepseek, ai，開頭可不帶#）',
          },
          limit: {
            type: 'number',
            description: '抓取貼文數量上限（預設 10 筆）',
          },
        },
        required: ['hashtag'],
        additionalProperties: false,
      },
      execute: async (args: { hashtag: string; limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        const tag = (args.hashtag || '').replace(/^#/, '').trim()
        log(`[Tools] 搜尋標籤貼文: #${tag}`)
        const res = await mcp.igSearchHashtag(tag, args.limit || 10)
        return res
      },
    },

    {
      name: 'ig_get_post_context',
      description: '取得指定 Instagram 貼文的完整內文、發文者帳號與留言上下文列表',
      parameters: {
        type: 'object',
        properties: {
          media_pk: {
            type: 'string',
            description: '貼文唯一的識別碼 (Media PK)',
          },
          comment_limit: {
            type: 'number',
            description: '獲取相鄰留言的最大數量（預設 10 筆）',
          },
        },
        required: ['media_pk'],
        additionalProperties: false,
      },
      execute: async (args: { media_pk: string; comment_limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 取得貼文 ${args.media_pk} 詳情與留言`)
        const res = await mcp.igGetPostContext(args.media_pk, args.comment_limit || 10)
        return res
      },
    },

    {
      name: 'ig_login',
      description: '手動登入 Instagram 帳號或載入 Session 憑證',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Instagram 使用者帳號（若已有 Session 可留空）' },
          password: { type: 'string', description: 'Instagram 登入密碼（若已有 Session 可留空）' },
          two_factor_code: { type: 'string', description: '2FA 雙重驗證代碼（遇驗證碼挑戰時提供）' },
          proxy_url: { type: 'string', description: '可選：代理伺服器 URL' },
        },
        additionalProperties: false,
      },
      execute: async (args: { username?: string; password?: string; two_factor_code?: string; proxy_url?: string }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        const u = toStr(args.username, toStr(config.username, ''))
        const p = toStr(args.password, toStr(config.password, ''))
        const s = toStr(config.sessionPath, 'data/ig_session.json') || 'data/ig_session.json'
        const t2fa = toStr(args.two_factor_code, toStr(config.twoFactorCode, ''))
        const proxy = toStr(args.proxy_url, toStr(config.proxyUrl, ''))
        log(`[Tools] 嘗試登入帳號: ${u || '使用預設 Session'}`)
        const res = await mcp.igLogin({
          username: u,
          password: p,
          session_path: s,
          two_factor_code: t2fa,
          proxy_url: proxy,
        })
        return res
      },
    },

    {
      name: 'ig_manual_patrol',
      description: '手動立即執行一輪 Instagram 標籤巡查與推薦推坑任務',
      parameters: {
        type: 'object',
        properties: {
          hashtag: {
            type: 'string',
            description: '可選：指定巡查之標籤（不填則使用設定中預設的標籤列表）',
          },
        },
        additionalProperties: false,
      },
      execute: async (args: { hashtag?: string }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 主模型手動觸發標籤巡查: ${args.hashtag || '預設標籤'}`)
        const runConfig = { ...config }
        if (args.hashtag) {
          runConfig.hashtags = [args.hashtag.replace(/^#/, '')]
        }
        const res = await executePatrolDuty(ctx, runConfig, mcp, ledger, log)
        return res
      },
    },

    {
      name: 'ig_manual_reply_post',
      description: '手動在特定 Instagram 貼文下發布留言或針對特定留言進行子留言回覆',
      parameters: {
        type: 'object',
        properties: {
          media_pk: {
            type: 'string',
            description: '貼文唯一識別碼 (Media PK)',
          },
          text: {
            type: 'string',
            description: '留言文字內容',
          },
          reply_to_comment_pk: {
            type: 'string',
            description: '可選：欲回覆之留言 PK（若為新留言則留空）',
          },
        },
        required: ['media_pk', 'text'],
        additionalProperties: false,
      },
      execute: async (args: { media_pk: string; text: string; reply_to_comment_pk?: string }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 主模型手動在貼文 ${args.media_pk} 發布留言`)
        const res = await mcp.igPostComment({
          media_pk: args.media_pk,
          text: args.text,
          reply_to_comment_pk: args.reply_to_comment_pk || '',
          jitter_min: 1.0,
          jitter_max: 2.0,
        })
        if (res?.ok) {
          ledger.markSeenPost(args.media_pk, { recommended: true })
        }
        return res
      },
    },

    {
      name: 'ig_get_unread_dms',
      description: '讀取 Instagram 最新或未讀的私訊對話線程列表',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: '抓取對話線程上限（預設 10 筆）',
          },
        },
        additionalProperties: false,
      },
      execute: async (args: { limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 讀取未讀私訊線程列表`)
        const res = await mcp.igGetUnreadDms(args.limit || 10)
        return res
      },
    },

    {
      name: 'ig_manual_send_dm',
      description: '手動發送私訊至指定 Instagram 對話線程',
      parameters: {
        type: 'object',
        properties: {
          thread_id: {
            type: 'string',
            description: '對話線程 ID',
          },
          text: {
            type: 'string',
            description: '私訊文字內容',
          },
        },
        required: ['thread_id', 'text'],
        additionalProperties: false,
      },
      execute: async (args: { thread_id: string; text: string }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 主模型手動發送私訊至線程 ${args.thread_id}`)
        const res = await mcp.igSendDm({
          thread_id: args.thread_id,
          text: args.text,
          jitter_min: 1.0,
          jitter_max: 2.0,
        })
        return res
      },
    },

    {
      name: 'ig_run_duties_now',
      description: '立刻依次執行所有已啟用的排程任務（私訊檢查、被 @ 留言應答、標籤巡查）',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log('[Tools] 手動觸發全套任務循環...')
        const dmRes = await executeDmReplyDuty(ctx, config, mcp, ledger, log)
        const mentionRes = await executeMentionReplyDuty(ctx, config, mcp, ledger, log)
        const patrolRes = await executePatrolDuty(ctx, config, mcp, ledger, log)
        return {
          ok: true,
          dm: dmRes,
          mention: mentionRes,
          patrol: patrolRes,
        }
      },
    },

    {
      name: 'ig_browse_user_posts',
      description: '指定 Instagram 帳號（例如 wired, techcrunch, verge 等）讀取其最新發布的貼文與影片列表。包含詳細資訊、媒體類型（圖片/影片/Reel/輪播）與聯名作者標示。純瀏覽，安全唯讀不發文。',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'Instagram 使用者帳號（例如 wired，開頭可不帶 @）',
          },
          limit: {
            type: 'number',
            description: '抓取筆數上限（預設 10 筆）',
          },
        },
        required: ['username'],
        additionalProperties: false,
      },
      execute: async (args: { username: string; limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        const user = (args.username || '').replace(/^@/, '').trim()
        log(`[Tools] 純瀏覽指定帳號貼文與影片: @${user}`)
        const res = await mcp.igGetUserMedias(user, args.limit || 10)
        return res
      },
    },

    {
      name: 'ig_browse_reels',
      description: '純瀏覽 Instagram 連續短片 (Reels / Clips)。若指定 username 則瀏覽該用戶的短影音，未指定則瀏覽熱門探索短片。安全唯讀不發文。',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: '可選：欲瀏覽之 Instagram 帳號名稱。留空則瀏覽熱門/探索短片。',
          },
          limit: {
            type: 'number',
            description: '抓取短片筆數上限（預設 10 筆）',
          },
        },
        additionalProperties: false,
      },
      execute: async (args: { username?: string; limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        const user = (args.username || '').replace(/^@/, '').trim()
        if (user) {
          log(`[Tools] 純瀏覽帳號 @${user} 的連續短片 Reels`)
          return await mcp.igGetUserClips(user, args.limit || 10)
        } else {
          log(`[Tools] 純瀏覽探索推薦連續短片 Reels`)
          return await mcp.igGetReelsFeed(args.limit || 10)
        }
      },
    },

    {
      name: 'ig_browse_timeline',
      description: '純瀏覽 Instagram 主頁動態牆 (Timeline Feed) 或探索熱門貼文與影片。安全唯讀不發文、不留言。',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: '抓取筆數上限（預設 10 筆）',
          },
        },
        additionalProperties: false,
      },
      execute: async (args: { limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 純瀏覽 Instagram 動態牆/探索貼文`)
        const res = await mcp.igGetTimelineFeed(args.limit || 10)
        return res
      },
    },

    {
      name: 'ig_search_users',
      description: '搜尋 Instagram 使用者帳號，檢索官方帳號、ID 與頭像。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜尋關鍵字或帳號部分字串',
          },
          limit: {
            type: 'number',
            description: '搜尋結果數量上限（預設 10 筆）',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (args: { query: string; limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 搜尋使用者帳號: ${args.query}`)
        return await mcp.igSearchUsers(args.query, args.limit || 10)
      },
    },

    {
      name: 'ig_search_tags',
      description: '搜尋 Instagram 標籤（Hashtag）名稱與貼文數。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '標籤搜尋關鍵字 (如 ai, tech)',
          },
          limit: {
            type: 'number',
            description: '搜尋結果數量上限（預設 10 筆）',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (args: { query: string; limit?: number }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 搜尋標籤: ${args.query}`)
        return await mcp.igSearchTags(args.query, args.limit || 10)
      },
    },
  ]

  for (const rawTool of toolDefs) {
    const t = {
      ...rawTool,
      output: {
        schema: { type: 'object' },
      },
    }
    try {
      if (typeof tools?.define === 'function') {
        tools.define(t)
      } else if (typeof tools?.register === 'function') {
        tools.register(t)
      } else if (typeof ctx?.tool === 'function') {
        ctx.tool(t.name, t)
      }
      log(`[Tools] 工具註冊完成: ${t.name}`)
    } catch (e: any) {
      log(`[Tools] 工具 ${t.name} 註冊警訊: ${e.message}`)
    }
  }
}
