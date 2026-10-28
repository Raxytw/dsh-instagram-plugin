/**
 * src/index.ts —— DSH Instagram 插件入口 (Cordis Plugin)
 * ============================================================================
 * 職責：
 * 1. 導出標準 DSH / Cordis 插件結構 (name, inject, Config, apply)。
 * 2. 整合宿主 schemastery，提供 settings 面板 schema 渲染。
 * 3. 依賴 dsh-instagram-mcp 核心服務 (ctx.instagramMcp)，共享 FastMCP 連線與 Session。
 * 4. 透過 webServer.register({ kind: 'prefix', path: '/api/instagram', handler })
 *    提供標準 HTTP 路由，供 client.js 前端設定面板讀寫。
 * 5. 生命週期管理：自動化職責排程器 (Patrol, Mention, DM) 與優雅卸載。
 * ============================================================================
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildConfigSchema, defaultConfig, InstagramPluginConfig, sanitizeConfig, unwrapValue } from './config.js'
import { loadSchemastery } from './lib/hostdeps.js'
import { LedgerManager } from './lib/ledger.js'
import { registerIgTools } from './tools/igTools.js'
import { executePatrolDuty } from './duty/patrol.js'
import { executeMentionReplyDuty, executeRmReplyWithMediaAndFiles } from './duty/mentionReply.js'
import { executeDmReplyDuty } from './duty/dmReply.js'
import { executeRepostMedia, generateRepostThoughtForMedia } from './duty/repost.js'
import { getAuthorizedSubscriptionProviders, testLlmConnection } from './lib/llm.js'
import {
  getSocialFishMemoryStats,
  loadSocialFishStore,
  buildIsolatedSocialStoreId,
  recordSocialInteractionMemory,
  recordMediaThoughtMemory,
  recallSocialMemories,
  recallMediaThoughtMemories,
} from './lib/companion.js'
import {
  type InstagramMcpClient,
  getSharedMcpClient,
  getSharedMcpService,
} from '@luoyi-dsh/instagram-mcp'

export const name = 'instagram-plugin'
export const inject = ['webServer', 'tools']

// 優先載入宿主 schemastery，若無則退回依賴項
const zInstance = await loadSchemastery()
export const Config = buildConfigSchema(zInstance)

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: any) => { body += chunk })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) }
      catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

export function apply(ctx: any, userConfig: Partial<InstagramPluginConfig> = {}) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const dataDir = join(pluginRoot, 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const configFile = join(dataDir, 'config.json')

  // 讀取本地持久化設定 (本地優先)
  const localSavedConfig = (() => {
    try {
      if (existsSync(configFile)) {
        return JSON.parse(readFileSync(configFile, 'utf-8'))
      }
    } catch {}
    return {}
  })()

  // 合併設定：預設值 -> 宿主設定 (過濾 volatile 容器) -> 本地保存設定
  const activeConfig: InstagramPluginConfig = sanitizeConfig({
    ...defaultConfig,
    ...userConfig,
    ...localSavedConfig,
  })

  // 若 config.json 尚不存在，動態創建初始配置檔
  if (!existsSync(configFile)) {
    try {
      writeFileSync(configFile, JSON.stringify(activeConfig, null, 2), 'utf-8')
    } catch {}
  }


  ;(globalThis as any).__DSH_INSTAGRAM_PLUGIN_CONFIG__ = activeConfig

  const saveConfig = (patch: Partial<InstagramPluginConfig>) => {
    const cleanPatch = sanitizeConfig({ ...activeConfig, ...patch })
    Object.assign(activeConfig, cleanPatch)
    ;(globalThis as any).__DSH_INSTAGRAM_PLUGIN_CONFIG__ = activeConfig
    try {
      writeFileSync(configFile, JSON.stringify(activeConfig, null, 2), 'utf-8')
    } catch (e: any) {
      log(`保存 config.json 失敗: ${e.message}`)
    }
  }

  const log = (msg: string) => {
    console.log(`[DSH-IG] ${msg}`)
  }

  log(`Instagram 業務插件正在初始化... (根目錄: ${pluginRoot})`)

  // 初始化狀態帳本
  const ledgerPath = join(dataDir, 'ledger.json')
  const ledger = new LedgerManager(ledgerPath)

  let patrolTimer: NodeJS.Timeout | null = null
  let mentionTimer: NodeJS.Timeout | null = null
  let dmTimer: NodeJS.Timeout | null = null
  let isDisposed = false

  // 取得共享的 MCP Client（來自 dsh-instagram-mcp 單例，安全無拋錯）
  const getMcpClient = (): InstagramMcpClient | null => {
    const client = getSharedMcpClient()
    return client && client.ready ? client : (client || null)
  }

  const getLoginStatus = () => {
    const svc = getSharedMcpService()
    if (svc?.loginStatus) {
      return svc.loginStatus
    }
    const client = getMcpClient()
    if (!client || !client.ready) {
      return { ok: false, message: '等待 @luoyi-dsh/instagram-mcp 核心服務就緒...' }
    }
    return { ok: false, message: 'Instagram MCP 未登入，請至 MCP 面板輸入帳密登入' }
  }

  // 立即註冊自動化專屬 Tools 給主模型
  registerIgTools(ctx, activeConfig, getMcpClient, ledger, log)

  // 排程啟動管理器
  const setupSchedulers = () => {
    if (isDisposed) return
    const mcpClient = getMcpClient()
    if (!mcpClient || !mcpClient.ready) return

    // 1. 私訊回覆排程
    if (activeConfig.dmReplyEnabled && !dmTimer) {
      const dmIntervalMs = Math.max(1, activeConfig.dmIntervalMinutes || 3) * 60 * 1000
      log(`啟動私訊雙向應答排程，間隔: ${activeConfig.dmIntervalMinutes} 分鐘`)
      const runDm = async () => {
        const client = getMcpClient()
        if (isDisposed || !client) return
        try {
          await executeDmReplyDuty(ctx, activeConfig, client, ledger, log)
        } catch (e: any) {
          log(`私訊排程執行異常: ${e.message}`)
        }
      }
      setTimeout(runDm, 5000)
      dmTimer = setInterval(runDm, dmIntervalMs)
    }

    // 2. 被 @ 留言提問應答排程
    if (activeConfig.mentionReplyEnabled && !mentionTimer) {
      const mentionIntervalMs = Math.max(1, activeConfig.mentionIntervalMinutes || 5) * 60 * 1000
      log(`啟動被 @ 提問應答排程，間隔: ${activeConfig.mentionIntervalMinutes} 分鐘`)
      const runMention = async () => {
        const client = getMcpClient()
        if (isDisposed || !client) return
        try {
          await executeMentionReplyDuty(ctx, activeConfig, client, ledger, log)
        } catch (e: any) {
          log(`提及應答排程執行異常: ${e.message}`)
        }
      }
      setTimeout(runMention, 12000)
      mentionTimer = setInterval(runMention, mentionIntervalMs)
    }

    // 3. 標籤巡查推坑排程
    if (activeConfig.patrolEnabled && !patrolTimer) {
      const patrolIntervalMs = Math.max(1, activeConfig.patrolIntervalMinutes || 15) * 60 * 1000
      log(`啟動標籤巡查推坑排程，間隔: ${activeConfig.patrolIntervalMinutes} 分鐘`)
      const runPatrol = async () => {
        const client = getMcpClient()
        if (isDisposed || !client) return
        try {
          await executePatrolDuty(ctx, activeConfig, client, ledger, log)
        } catch (e: any) {
          log(`巡查排程執行異常: ${e.message}`)
        }
      }
      setTimeout(runPatrol, 20000)
      patrolTimer = setInterval(runPatrol, patrolIntervalMs)
    }
  }

  // 監聽/輪詢直到 FastMCP 就緒後掛載排程
  const checkMcpReadyTimer = setInterval(() => {
    if (isDisposed) {
      clearInterval(checkMcpReadyTimer)
      return
    }
    const client = getMcpClient()
    if (client && client.ready) {
      setupSchedulers()
      clearInterval(checkMcpReadyTimer)
    }
  }, 3000)

  // ==========================================================================
  // Web API 路由 (供前端面板 client.js 使用)
  // 遵循 DSH 官方 webServer.register 規範，解決 HTTP 404 問題
  // ==========================================================================
  const handleRequest = async (req: any, res: any) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const pathname = url.pathname

      // 讀取當前完整配置
      if (req.method === 'GET' && pathname === '/api/instagram/config') {
        const svc = getSharedMcpService()
        const inheritedBot = svc?.loginStatus?.username || svc?.config?.username || activeConfig.botUsername || ''
        const inheritedMaster = svc?.config?.masterUsername || activeConfig.targetMentionUser || ''
        return sendJson(res, 200, {
          ok: true,
          config: sanitizeConfig({
            ...activeConfig,
            botUsername: inheritedBot,
            targetMentionUser: inheritedMaster,
          }),
        })
      }

      // 儲存並即時更新配置
      if (req.method === 'POST' && pathname === '/api/instagram/config') {
        const newCfg = await readBody(req)
        saveConfig(newCfg)
        log('收到前端設定更新，重設排程調度器...')
        if (patrolTimer) clearInterval(patrolTimer)
        if (mentionTimer) clearInterval(mentionTimer)
        if (dmTimer) clearInterval(dmTimer)
        patrolTimer = null
        mentionTimer = null
        dmTimer = null
        setupSchedulers()
        const svc = getSharedMcpService()
        const inheritedBot = svc?.loginStatus?.username || svc?.config?.username || activeConfig.botUsername || ''
        const inheritedMaster = svc?.config?.masterUsername || activeConfig.targetMentionUser || ''
        return sendJson(res, 200, {
          ok: true,
          config: sanitizeConfig({
            ...activeConfig,
            botUsername: inheritedBot,
            targetMentionUser: inheritedMaster,
          }),
        })
      }

      // 讀取當前運行狀態與今日統計
      if (req.method === 'GET' && pathname === '/api/instagram/status') {
        const client = getMcpClient()
        const status = getLoginStatus()
        const svc = getSharedMcpService()
        const activeBotUser = svc?.loginStatus?.username || svc?.config?.username || status?.username || activeConfig.botUsername || ''
        const activeMasterUser = svc?.config?.masterUsername || activeConfig.targetMentionUser || ''
        return sendJson(res, 200, {
          ok: true,
          mcpRunning: Boolean(client?.isRunning),
          mcpReady: Boolean(client?.ready),
          loginStatus: status,
          inheritedSession: true,
          botUsername: activeBotUser,
          masterUsername: activeMasterUser,
          dailyStats: ledger.getDailyStats(),
          feiyuMood: getSocialFishMemoryStats('social_ig_').moodSnapshot,
          fishMemory: {
            isolated: true,
            storeFilePrefix: '~/.dsh/fish-memory/social_ig_*.json',
          },
        })
      }

      // 檢查並同步繼承的 MCP Session 狀態 (不自管帳密，完全沿用 MCP 獲取之會話)
      if (req.method === 'POST' && pathname === '/api/instagram/login') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, {
            ok: false,
            error: 'FastMCP 服務尚未就緒，請確認 dsh-instagram-mcp 已啟動。',
          })
        }

        const svc = getSharedMcpService()
        let currentLoginStatus = svc?.loginStatus || { ok: false, message: '等待 MCP 登入' }
        if (!currentLoginStatus.ok && client && client.ready) {
          const res: any = await client.igLogin({}).catch((e: any) => ({ ok: false, message: e.message }))
          if (res?.ok) {
            currentLoginStatus = {
              ok: true,
              method: res.method,
              username: res.username || '',
              user_id: res.user_id,
              message: `已登入 (${res.method === 'session' ? 'Session 快取' : '帳號連線'}) - @${res.username || ''}`,
            }
            if (svc) svc.setLoginStatus(currentLoginStatus)
          }
        }
        return sendJson(res, 200, {
          ok: Boolean(currentLoginStatus?.ok),
          inheritedSession: true,
          loginStatus: currentLoginStatus,
        })
      }

      // ======================================================================
      // 純瀏覽與檢索專用路由 (Read-Only，安全只讀不發文、不點讚、不留言)
      // ======================================================================

      // 1. 指定帳號貼文與影片純瀏覽 (User Medias)
      if (req.method === 'GET' && pathname === '/api/instagram/browse/user') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒，請確認 dsh-instagram-mcp 已啟動。' })
        }
        const username = url.searchParams.get('username') || activeConfig.botUsername || activeConfig.targetMentionUser
        const limit = Number(url.searchParams.get('limit')) || 10
        if (!username) {
          return sendJson(res, 400, { ok: false, error: '缺少 username 參數 (例如 ?username=wired)' })
        }
        const userRes = await client.igGetUserMedias(username.replace(/^@/, '').trim(), limit)
        return sendJson(res, 200, userRes)
      }

      // 2. 連續短片純瀏覽 (Reels / Clips)
      if (req.method === 'GET' && pathname === '/api/instagram/browse/reels') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒' })
        }
        const username = url.searchParams.get('username')
        const limit = Number(url.searchParams.get('limit')) || 10
        if (username && username.trim()) {
          const clipsRes = await client.igGetUserClips(username.replace(/^@/, '').trim(), limit)
          return sendJson(res, 200, clipsRes)
        } else {
          const exploreClips = await client.igGetReelsFeed(limit)
          return sendJson(res, 200, exploreClips)
        }
      }

      // 3. 動態牆與探索推薦純瀏覽 (Feed & Explore)
      if (req.method === 'GET' && pathname === '/api/instagram/browse/explore') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒' })
        }
        const limit = Number(url.searchParams.get('limit')) || 10
        const feedRes = await client.igGetTimelineFeed(limit)
        return sendJson(res, 200, feedRes)
      }

      // 4. 搜尋帳號、標籤或模糊搜尋貼文 (Search Users / Tags / Fuzzy Posts)
      if (req.method === 'GET' && pathname === '/api/instagram/browse/search') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒' })
        }
        const q = (url.searchParams.get('q') || '').trim()
        const type = url.searchParams.get('type') || 'fuzzy'
        const limit = Number(url.searchParams.get('limit')) || 10
        if (!q) {
          return sendJson(res, 400, { ok: false, error: '缺少 q 搜尋關鍵字' })
        }
        if (type === 'fuzzy' || type === 'posts') {
          const fuzzyRes = typeof (client as any).igFuzzySearchPosts === 'function'
            ? await (client as any).igFuzzySearchPosts(q, limit)
            : await (client as any).callTool('ig_fuzzy_search_posts', { query: q, limit }, 75000)
          return sendJson(res, 200, fuzzyRes)
        } else if (type === 'tags' || q.startsWith('#')) {
          const tagsRes = await client.igSearchTags(q.replace(/^#/, ''), limit)
          return sendJson(res, 200, { ...tagsRes, results: tagsRes?.tags || [] })
        } else {
          const usersRes = await client.igSearchUsers(q.replace(/^@/, ''), limit)
          return sendJson(res, 200, { ...usersRes, results: usersRes?.users || [] })
        }
      }

      // 取得 DSH 已授權之外部插件訂閱模型清單 (dsh-plugin-subscriptions)
      if (req.method === 'GET' && pathname === '/api/instagram/subscriptions') {
        const providers = getAuthorizedSubscriptionProviders()
        return sendJson(res, 200, { ok: true, providers })
      }

      // 測試 LLM 模型連線 (支援外部插件訂閱額度與自訂 API)
      if (req.method === 'POST' && pathname === '/api/instagram/test-llm') {
        const body = await readBody(req)
        const testConfig: Partial<InstagramPluginConfig> = {
          ...activeConfig,
          llmMode: body.llmMode || activeConfig.llmMode || 'auto',
          subscriptionProvider: body.subscriptionProvider || activeConfig.subscriptionProvider || 'antigravity',
          subscriptionModel: body.subscriptionModel || activeConfig.subscriptionModel || 'gemini-2.5-flash',
          customLlmApiKey: body.apiKey !== undefined ? body.apiKey : activeConfig.customLlmApiKey,
          customLlmApiBase: body.apiBase || activeConfig.customLlmApiBase || 'https://api.deepseek.com',
          customLlmModel: body.model || activeConfig.customLlmModel || 'deepseek-chat',
        }
        const testRes = await testLlmConnection(ctx, testConfig, log)
        return sendJson(res, testRes.ok ? 200 : 400, testRes)
      }

      // 手動立即執行一次全任務循環
      if (req.method === 'POST' && pathname === '/api/instagram/run') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒' })
        }

        log('收到手動全任務執行指令，依序執行巡查、提及、私訊...')
        const patrolRes = await executePatrolDuty(ctx, activeConfig, client, ledger, log)
        const mentionRes = await executeMentionReplyDuty(ctx, activeConfig, client, ledger, log)
        const dmRes = await executeDmReplyDuty(ctx, activeConfig, client, ledger, log)

        return sendJson(res, 200, {
          ok: true,
          patrol: patrolRes,
          mention: mentionRes,
          dm: dmRes,
        })
      }

      // 讀取貼文/Reel 內容並由 AI 生成轉發感想預覽
      if (req.method === 'POST' && pathname === '/api/instagram/repost/generate-thought') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒，請確認 dsh-instagram-mcp 已啟動。' })
        }
        const body = await readBody(req)
        const mediaPkOrUrl = String(body.mediaPkOrUrl || body.media_pk || body.url || '').trim()
        if (!mediaPkOrUrl) {
          return sendJson(res, 400, { ok: false, error: '請輸入貼文或 Reel 的網址或 PK' })
        }
        const genRes = await generateRepostThoughtForMedia(
          ctx,
          activeConfig,
          client,
          {
            mediaPkOrUrl,
            mentionUsers: body.mentionUsers || body.mention_users,
            userHint: body.userHint || body.user_hint,
          },
          log
        )
        return sendJson(res, genRes.ok ? 200 : 400, genRes)
      }

      // 立即執行貼文/Reel 轉發（支援 @用戶 + 填寫或自動生成對該內容的感想）
      if (req.method === 'POST' && pathname === '/api/instagram/repost') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒，請確認 dsh-instagram-mcp 已啟動。' })
        }
        const body = await readBody(req)
        const mediaPkOrUrl = String(body.mediaPkOrUrl || body.media_pk || body.url || '').trim()
        if (!mediaPkOrUrl) {
          return sendJson(res, 400, { ok: false, error: '請輸入要轉發的貼文或 Reel 網址或 PK' })
        }
        const repostRes = await executeRepostMedia(
          ctx,
          activeConfig,
          client,
          ledger,
          {
            mediaPkOrUrl,
            thoughtText: body.thoughtText ?? body.thought_text ?? '',
            mentionUsers: body.mentionUsers ?? body.mention_users,
            repostMode: body.repostMode || body.repost_mode || activeConfig.repostMode || 'story',
            autoGenerateThought: body.autoGenerateThought !== false,
            repostTemplate: body.repostTemplate || activeConfig.repostTemplate,
            includeCredit: body.includeCredit !== false,
            allowResend: Boolean(body.allowResend),
          },
          log
        )
        return sendJson(res, repostRes.ok ? 200 : 400, repostRes)
      }

      // 支援多模態 RM 應答與附圖直傳 (讀取貼文/Reel、圖片、文件並防 Prompt 注入)
      if (req.method === 'POST' && pathname === '/api/instagram/rm/reply') {
        const client = getMcpClient()
        if (!client || !client.ready) {
          return sendJson(res, 503, { ok: false, error: 'FastMCP 服務尚未就緒，請確認 dsh-instagram-mcp 已啟動。' })
        }
        const body = await readBody(req)
        const mediaPkOrUrl = String(body.mediaPkOrUrl || body.media_pk || body.url || '').trim()
        if (!mediaPkOrUrl) {
          return sendJson(res, 400, { ok: false, error: '請輸入貼文或 Reel 的 PK 或網址' })
        }
        const rmRes = await executeRmReplyWithMediaAndFiles(
          ctx,
          activeConfig,
          client,
          ledger,
          {
            mediaPkOrUrl,
            replyToCommentPk: body.replyToCommentPk || body.commentPk,
            targetUsername: body.targetUsername || body.username,
            customReplyText: body.customReplyText || body.text,
            sendImagePathOrUrl: body.sendImagePathOrUrl || body.imagePath || body.imageUrl,
            inputImageUrls: Array.isArray(body.inputImageUrls) ? body.inputImageUrls : [],
            inputFilePaths: Array.isArray(body.inputFilePaths) ? body.inputFilePaths : [],
            inlineFileContents: Array.isArray(body.inlineFileContents) ? body.inlineFileContents : [],
            publishNow: body.publishNow !== false,
          },
          log
        )
        return sendJson(res, rmRes.ok ? 200 : 400, rmRes)
      }

      // 讀取 dsh-fish-memory 社交隔離記憶庫
      if (req.method === 'GET' && pathname === '/api/instagram/fish-memory') {
        const cat = (url.searchParams.get('category') || 'thought').toLowerCase()
        const user = (url.searchParams.get('username') || activeConfig.targetMentionUser || 'master')
          .replace(/^@/, '')
          .trim()
        const q = url.searchParams.get('q') || ''
        const limit = Number(url.searchParams.get('limit')) || 10
        if (cat === 'thought') {
          const rendered = recallMediaThoughtMemories(user || 'master', q, limit)
          const store = loadSocialFishStore(buildIsolatedSocialStoreId('ig', 'thoughts', user || 'master'))
          return sendJson(res, 200, {
            ok: true,
            category: 'thought',
            rendered,
            messages: (store.messages || []).slice(-limit),
            memories: store.memories.slice(-limit),
            count: store.memories.length,
          })
        } else {
          const rendered = recallSocialMemories('ig', cat as any, user, q, limit)
          const store = loadSocialFishStore(buildIsolatedSocialStoreId('ig', cat as any, user))
          return sendJson(res, 200, {
            ok: true,
            category: cat,
            rendered,
            messages: (store.messages || []).slice(-limit),
            memories: store.memories.slice(-limit),
            count: store.memories.length,
          })
        }
      }

      // 寫入 dsh-fish-memory 社交記憶庫 (支援 DM/RM 對話與 Reel/貼文感想寫入)
      if (req.method === 'POST' && pathname === '/api/instagram/fish-memory') {
        const body = await readBody(req)
        const cat = String(body.category || 'thought').toLowerCase()
        const targetUser = (body.username || activeConfig.targetMentionUser || 'master').replace(/^@/, '').trim()
        if (cat === 'thought') {
          recordMediaThoughtMemory({
            ownerOrBotKey: targetUser || 'master',
            mediaPk: body.mediaPk || `pk_${Date.now()}`,
            mediaUrl: body.mediaUrl,
            authorUsername: targetUser,
            mediaTypeLabel: body.mediaTypeLabel || '貼文/Reel',
            captionExcerpt: body.userText || body.caption || '',
            thoughtText: body.botReply || body.thought || '',
            source: 'web_manual',
          })
          return sendJson(res, 200, { ok: true, message: '已成功將 Reel/貼文感想寫入 dsh-fish-memory' })
        } else {
          recordSocialInteractionMemory({
            platform: 'ig',
            channelType: cat as any,
            targetUser,
            userMessage: body.userText || '',
            botReply: body.botReply || '',
            contextNote: `Web手動${cat.toUpperCase()}`,
            mediaPk: body.mediaPk,
          })
          return sendJson(res, 200, { ok: true, message: `已成功將 ${cat.toUpperCase()} 聊天紀錄寫入 dsh-fish-memory` })
        }
      }

      sendJson(res, 404, { ok: false, error: `Not found: ${pathname}` })
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err.message })
    }
  }

  const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer

  if ((globalThis as any).__DSH_IG_ROUTES_REGISTERED__) {
    // 已經註冊過，防止重複載入導致 duplicate prefix route
  } else if (webServer) {
    try {
      if (typeof webServer.register === 'function') {
        webServer.register({
          kind: 'prefix',
          path: '/api/instagram',
          handler: handleRequest,
        })
        ;(globalThis as any).__DSH_IG_ROUTES_REGISTERED__ = true
        log('✅ 已註冊 DSH 官方路由: /api/instagram')
      } else if (webServer.router) {
        webServer.router.all('/api/instagram/*', handleRequest)
        ;(globalThis as any).__DSH_IG_ROUTES_REGISTERED__ = true
      }
    } catch (e: any) {
      log(`註冊 Web 路由異常: ${e.message}`)
    }
  }

  // 優雅卸載清理
  const dispose = async () => {
    isDisposed = true
    clearInterval(checkMcpReadyTimer)
    if (patrolTimer) clearInterval(patrolTimer)
    if (mentionTimer) clearInterval(mentionTimer)
    if (dmTimer) clearInterval(dmTimer)
    log('插件已成功卸載。')
  }

  if (typeof ctx?.on === 'function') {
    ctx.on('dispose', dispose)
  }
}

export default {
  name,
  inject,
  Config,
  apply,
}
