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
import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'
import { executePatrolDuty } from '../duty/patrol.js'
import { executeMentionReplyDuty, executeRmReplyWithMediaAndFiles } from '../duty/mentionReply.js'
import { executeDmReplyDuty } from '../duty/dmReply.js'
import { executeRepostMedia, generateRepostThoughtForMedia, type RepostMode } from '../duty/repost.js'
import {
  loadSocialFishStore,
  saveSocialFishStore,
  buildIsolatedSocialStoreId,
  recordSocialInteractionMemory,
  recordMediaThoughtMemory,
  recallSocialMemories,
  recallMediaThoughtMemories,
} from '../lib/companion.js'

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

        const svc = (globalThis as any).__DSH_INSTAGRAM_MCP__
        const sessionValid = Boolean(svc?.loginStatus?.ok)
        const sessionMsg = svc?.loginStatus?.message || (mcp?.ready ? 'MCP 運行中，等待登入' : '等待 MCP 連線')

        const stats = ledger.getDailyStats()
        return {
          ok: true,
          mcpConnected: true,
          sessionInherited: true,
          sessionValid,
          sessionStatus: sessionMsg,
          dailyStats: stats,
          configSnapshot: {
            botUsername: toStr(config.botUsername, svc?.loginStatus?.username || ''),
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
      name: 'ig_fuzzy_search_posts',
      description: '在 Instagram 使用關鍵字進行「模糊搜尋」貼文與連續短片 (結合綜合 SERP、Reels 搜尋與相關公開創作者貼文，解決單純 Hashtag 標籤搜尋返回 0 則貼文的問題)',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '模糊搜尋關鍵字（例如 ai, deepseek, coding, tech 等）',
          },
          limit: {
            type: 'number',
            description: '抓取貼文數量上限（預設 10 筆）',
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
        const q = (args.query || '').trim()
        log(`[Tools] 模糊搜尋貼文: "${q}"`)
        const res = typeof (mcp as any).igFuzzySearchPosts === 'function'
          ? await (mcp as any).igFuzzySearchPosts(q, args.limit || 10)
          : await (mcp as any).callTool('ig_fuzzy_search_posts', { query: q, limit: args.limit || 10 }, 75000)
        return res
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
      description: '手動在特定 Instagram 貼文下發布留言或針對特定留言進行子留言回覆（RM），並支援傳送圖片到 RM（透過附圖連動私訊或限動標註）',
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
          image_path: {
            type: 'string',
            description: '可選：欲傳送到 RM 的本地圖片路徑或 data:image/...;base64',
          },
          image_url: {
            type: 'string',
            description: '可選：欲傳送到 RM 的遠端圖片 URL 或 data:image/...;base64',
          },
          target_username: {
            type: 'string',
            description: '可選：RM 互動的目標用戶 Instagram 帳號（供附圖連動直傳或標註）',
          },
        },
        required: ['media_pk', 'text'],
        additionalProperties: false,
      },
      execute: async (args: {
        media_pk: string
        text: string
        reply_to_comment_pk?: string
        image_path?: string
        image_url?: string
        target_username?: string
      }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        if (!args.reply_to_comment_pk && ledger.hasEverSentPost(args.media_pk)) {
          log(`[Tools] ⏭️ 攔截重複留言：貼文/Reel ${args.media_pk} 已經發送過留言，禁止重複發送`)
          return { ok: false, duplicate: true, error: `貼文或 Reel (${args.media_pk}) 已經發送過留言，不可重複發送` }
        }
        log(`[Tools] 主模型手動在貼文 ${args.media_pk} 發布留言 (附圖=${Boolean(args.image_path || args.image_url)})`)
        const res = await mcp.igPostComment({
          media_pk: args.media_pk,
          text: args.text,
          reply_to_comment_pk: args.reply_to_comment_pk || '',
          image_path: args.image_path || '',
          image_url: args.image_url || '',
          target_username: args.target_username || '',
          jitter_min: 1.0,
          jitter_max: 2.0,
        })
        if (!args.reply_to_comment_pk) {
          ledger.markSeenPost(args.media_pk, { recommended: true })
        }
        return res
      },
    },

    {
      name: 'ig_reply_rm_media',
      description:
        '針對被 @ 的貼文或 Reel 留言（RM）進行多模態 AI 應答與附圖回傳：相容讀取貼文/Reel 內容、圖片內容與附帶文件內容（自動防 Prompt 注入消毒），將圖片丟給模型解析（正常使用 DeepSeek，使用額外訂閱額度時走選定的模型如 gemini-3-flash），並可一併傳送圖片到 RM 與寫入 dsh-fish-memory。',
      parameters: {
        type: 'object',
        properties: {
          media_pk_or_url: {
            type: 'string',
            description: '貼文或 Reel 的唯一識別碼 (Media PK)、Shortcode 或完整網址',
          },
          reply_to_comment_pk: {
            type: 'string',
            description: '可選：要回覆的具體留言 PK',
          },
          target_username: {
            type: 'string',
            description: '可選：互動目標用戶 Instagram 帳號',
          },
          custom_reply_text: {
            type: 'string',
            description: '可選：指定手動回覆文字（留空則由 AI 讀取貼文與圖片真實內容動態生成，徹底去 AI 味）',
          },
          send_image_path_or_url: {
            type: 'string',
            description: '可選：欲一併傳送給 RM 對象的圖片本地路徑、遠端 URL 或 data:image/...;base64',
          },
          input_file_paths: {
            type: 'array',
            items: { type: 'string' },
            description: '可選：傳入模型輔助參考的本地文字/文件路徑（如 .txt, .md, .json, .csv）',
          },
          publish_now: {
            type: 'boolean',
            description: '是否立即發布留言與傳送圖片（預設 true，若為 false 僅生成預覽）',
          },
        },
        required: ['media_pk_or_url'],
        additionalProperties: false,
      },
      execute: async (args: {
        media_pk_or_url: string
        reply_to_comment_pk?: string
        target_username?: string
        custom_reply_text?: string
        send_image_path_or_url?: string
        input_file_paths?: string[]
        publish_now?: boolean
      }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 觸發 RM 多模態應答與附圖: ${args.media_pk_or_url}`)
        return await executeRmReplyWithMediaAndFiles(ctx, config, mcp, ledger, {
          mediaPkOrUrl: args.media_pk_or_url,
          replyToCommentPk: args.reply_to_comment_pk,
          targetUsername: args.target_username,
          customReplyText: args.custom_reply_text,
          sendImagePathOrUrl: args.send_image_path_or_url,
          inputFilePaths: args.input_file_paths,
          publishNow: args.publish_now !== false,
        }, log)
      },
    },

    {
      name: 'ig_repost_media',
      description:
        '轉發指定的 Instagram 貼文或 Reel，支援在轉發文案裡面 @ 用戶、手動填寫對這個 Reel 或貼文內容的感想，或留空讓 AI 自動讀取該貼文/Reel 內容（字幕、畫面、內文）動態生成感想後轉發。支援限時動態轉發 (story)、動態牆/Reels 貼文轉發 (feed)、私訊卡片轉發 (dm) 與限動轉發+原貼文留言 (story_and_comment)。',
      parameters: {
        type: 'object',
        properties: {
          media_pk_or_url: {
            type: 'string',
            description: '欲轉發之貼文或 Reel 的唯一識別碼 (Media PK)、Shortcode 或完整 Instagram 網址 (如 https://www.instagram.com/reel/...)',
          },
          thought_text: {
            type: 'string',
            description: '可選：對這個 Reel 或貼文內容的感想 / 轉發文案。若留空，系統會自動先讀取該貼文/Reel 的真實內容並由 AI 生成具體感想。',
          },
          mention_users: {
            type: 'string',
            description: '可選：要在轉發文案裡面 @ 的 Instagram 用戶帳號（多個帳號可用逗號或空白分隔，如 "raxytw, friend2"；留空時預設帶入設定的主人帳號）。',
          },
          repost_mode: {
            type: 'string',
            enum: ['story', 'feed', 'dm', 'story_and_comment'],
            description: '轉發模式：story (轉發至限時動態，含可點擊原貼文卡片 + @用戶 Mention + 感想文字卡片)、feed (下載並轉發為動態貼文/Reel，附上 @用戶 與感想文案)、dm (私訊轉發卡片 + 感想)、story_and_comment (限動轉發同時在原貼文留言)',
          },
          include_credit: {
            type: 'boolean',
            description: '動態牆 (feed) 轉發時是否在文末附上原創作者標註（預設 true）',
          },
        },
        required: ['media_pk_or_url'],
        additionalProperties: false,
      },
      execute: async (args: {
        media_pk_or_url: string
        thought_text?: string
        mention_users?: string
        repost_mode?: RepostMode
        include_credit?: boolean
      }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 主模型觸發轉發貼文/Reel: ${args.media_pk_or_url} (mode=${args.repost_mode || config.repostMode || 'story'})`)
        return await executeRepostMedia(
          ctx,
          config,
          mcp,
          ledger,
          {
            mediaPkOrUrl: args.media_pk_or_url,
            thoughtText: args.thought_text,
            mentionUsers: args.mention_users,
            repostMode: args.repost_mode || config.repostMode || 'story',
            autoGenerateThought: !args.thought_text || !args.thought_text.trim(),
            includeCredit: args.include_credit !== false,
          },
          log
        )
      },
    },

    {
      name: 'ig_generate_repost_thought',
      description:
        '讀取指定 Instagram 貼文或 Reel 的完整內容（內文、字幕、畫面視覺描述、多模態圖片），動態生成帶有 @用戶 與對該貼文/Reel 內容具體感想的轉發文案（僅生成預覽文案，不立即發布）。',
      parameters: {
        type: 'object',
        properties: {
          media_pk_or_url: {
            type: 'string',
            description: '貼文或 Reel 的 Media PK、Shortcode 或完整 Instagram 網址',
          },
          mention_users: {
            type: 'string',
            description: '可選：要在轉發文案中 @ 的用戶帳號（多個可用逗號分隔）',
          },
          user_hint: {
            type: 'string',
            description: '可選：補充給 AI 的感想方向提示（例如「想吐槽最後那個轉場」或「關注它的光影畫法」）',
          },
        },
        required: ['media_pk_or_url'],
        additionalProperties: false,
      },
      execute: async (args: { media_pk_or_url: string; mention_users?: string; user_hint?: string }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 生成貼文/Reel 轉發感想預覽: ${args.media_pk_or_url}`)
        return await generateRepostThoughtForMedia(
          ctx,
          config,
          mcp,
          {
            mediaPkOrUrl: args.media_pk_or_url,
            mentionUsers: args.mention_users,
            userHint: args.user_hint,
          },
          log
        )
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
      description: '手動發送私訊至指定 Instagram 對話線程（支援發送文字、圖片與檔案）',
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
          image_path: {
            type: 'string',
            description: '可選：欲發送的本地圖片檔案路徑或 data:image/...;base64',
          },
          image_url: {
            type: 'string',
            description: '可選：欲發送的遠端圖片 URL 或 data:image/...;base64',
          },
          file_path: {
            type: 'string',
            description: '可選：欲發送的本地檔案路徑',
          },
        },
        required: ['thread_id', 'text'],
        additionalProperties: false,
      },
      execute: async (args: {
        thread_id: string
        text: string
        image_path?: string
        image_url?: string
        file_path?: string
      }) => {
        const mcp = getMcp()
        if (!mcp || !mcp.isRunning) {
          return { ok: false, error: 'Instagram MCP 服務尚未就緒，請稍候' }
        }
        log(`[Tools] 主模型手動發送私訊至線程 ${args.thread_id}`)
        const res = await mcp.igSendDm({
          thread_id: args.thread_id,
          text: args.text,
          image_path: args.image_path || '',
          image_url: args.image_url || '',
          file_path: args.file_path || '',
          jitter_min: 1.0,
          jitter_max: 2.0,
        })
        return res
      },
    },

    {
      name: 'ig_fish_memory',
      description:
        '讀取或寫入 dsh-fish-memory 記憶庫，支援檢索或記錄 Instagram DM、RM 的聊天紀錄，以及刷 Reel 與貼文的感想內容（與主人私人對話物理隔離，嚴防注入攻擊）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write'],
            description: '操作類型：read (讀取記憶) 或 write (寫入記憶)',
          },
          category: {
            type: 'string',
            enum: ['dm', 'rm', 'thought'],
            description: '記憶分類：dm (私訊紀錄)、rm (貼文 @ 提及留言紀錄)、thought (刷 Reel 或貼文的感想內容)',
          },
          username: {
            type: 'string',
            description: '互動對象 Instagram 帳號（若為刷貼文感想可不填，預設為主人帳號）',
          },
          user_text: {
            type: 'string',
            description: '寫入時：對方說的話，或被刷到的貼文/Reel 內容摘要',
          },
          bot_reply: {
            type: 'string',
            description: '寫入時：機器人的回覆內容，或對該貼文/Reel 的感想',
          },
          media_pk: {
            type: 'string',
            description: '可選：關聯的貼文或 Reel PK / 短碼',
          },
          media_url: {
            type: 'string',
            description: '可選：關聯的貼文或 Reel 網址',
          },
          query: {
            type: 'string',
            description: '讀取時：檢索關鍵字',
          },
          limit: {
            type: 'number',
            description: '讀取時：返回的最大筆數（預設 6）',
          },
        },
        required: ['action', 'category'],
        additionalProperties: false,
      },
      execute: async (args: {
        action: 'read' | 'write'
        category: 'dm' | 'rm' | 'thought'
        username?: string
        user_text?: string
        bot_reply?: string
        media_pk?: string
        media_url?: string
        query?: string
        limit?: number
      }) => {
        const cat = args.category || 'thought'
        const targetUser = (args.username || config.targetMentionUser || 'master').replace(/^@/, '').trim()

        if (args.action === 'write') {
          if (cat === 'thought') {
            recordMediaThoughtMemory({
              ownerOrBotKey: targetUser || 'master',
              mediaPk: args.media_pk || `pk_${Date.now()}`,
              mediaUrl: args.media_url,
              authorUsername: targetUser,
              mediaTypeLabel: '貼文/Reel',
              captionExcerpt: args.user_text || '',
              thoughtText: args.bot_reply || '',
              source: 'tool_manual',
            })
            return { ok: true, action: 'write', category: 'thought', message: '已成功將 Reel/貼文感想寫入 dsh-fish-memory' }
          } else {
            recordSocialInteractionMemory({
              platform: 'ig',
              channelType: cat,
              targetUser,
              userMessage: args.user_text || '',
              botReply: args.bot_reply || '',
              contextNote: `工具寫入${cat.toUpperCase()}`,
              mediaPk: args.media_pk,
            })
            return { ok: true, action: 'write', category: cat, message: `已成功將 ${cat.toUpperCase()} 聊天紀錄寫入 dsh-fish-memory` }
          }
        }

        // action === 'read'
        if (cat === 'thought') {
          const memoriesStr = recallMediaThoughtMemories(targetUser || 'master', args.query || '', args.limit || 6)
          const storeId = buildIsolatedSocialStoreId('ig', 'thoughts', targetUser || 'master')
          const store = loadSocialFishStore(storeId)
          return {
            ok: true,
            action: 'read',
            category: 'thought',
            rendered: memoriesStr,
            recentMessages: (store.messages || []).slice(-(args.limit || 10)),
            itemCount: store.memories.length,
          }
        } else {
          const memoriesStr = recallSocialMemories('ig', cat, targetUser, args.query || '', args.limit || 6)
          const storeId = buildIsolatedSocialStoreId('ig', cat, targetUser)
          const store = loadSocialFishStore(storeId)
          return {
            ok: true,
            action: 'read',
            category: cat,
            rendered: memoriesStr,
            recentMessages: (store.messages || []).slice(-(args.limit || 10)),
            itemCount: store.memories.length,
          }
        }
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
        render: (_args: any, value: any) => [
          {
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
          },
        ],
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
