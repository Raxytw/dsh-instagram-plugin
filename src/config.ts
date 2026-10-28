/**
 * src/config.ts —— 插件配置與詳細條件定義 (支援 DSH Schemastery 與 volatile 欄位)
 * ============================================================================
 * 在 DSH (Cordis) 規範中：
 * 1. 設置面板會以 `Config` schema 渲染前端表單。
 * 2. 每個可動態修改的欄位都必須標記 `.extra('volatile', true)`，
 *    DSH 的 settings.update() 才能熱更新寫入設定。
 * ============================================================================
 */

export interface InstagramPluginConfig {
  // === 1. 身份與目標 (認證憑證與 Session 統一由 @luoyi-dsh/instagram-mcp 管理) ===
  botUsername: string
  targetMentionUser: string
  /** @deprecated 已遷移至 @luoyi-dsh/instagram-mcp，保留以相容舊設定檔 */
  username?: string
  /** @deprecated 已遷移至 @luoyi-dsh/instagram-mcp，保留以相容舊設定檔 */
  password?: string
  /** @deprecated 已遷移至 @luoyi-dsh/instagram-mcp，保留以相容舊設定檔 */
  twoFactorCode?: string
  /** @deprecated 已遷移至 @luoyi-dsh/instagram-mcp，保留以相容舊設定檔 */
  sessionPath?: string
  /** @deprecated 已遷移至 @luoyi-dsh/instagram-mcp，保留以相容舊設定檔 */
  proxyUrl?: string

  // === 2. 背景巡查與推薦詳細條件 (Patrol Duty) ===
  patrolEnabled: boolean
  patrolIntervalMinutes: number
  fuzzySearchEnabled: boolean
  fuzzyKeywords: string[]
  tagSearchEnabled: boolean
  hashtags: string[]
  patrolSearchLimit: number
  minLikes: number
  minComments: number
  excludeKeywords: string[]
  requireKeywords: string[]
  maxDailyPatrolComments: number
  patrolPersonaPrompt: string
  recommendTemplate: string

  // === 3. 被 @ 提問應答詳細條件 (Mention Reply Duty) ===
  mentionReplyEnabled: boolean
  mentionIntervalMinutes: number
  maxContextComments: number
  roundCapPerPost: number
  maxDailyMentionReplies: number
  whitelistUsers: string[]
  blacklistUsers: string[]
  mentionPersonaPrompt: string

  // === 4. 私訊雙向應答詳細條件 (DM Reply Duty) ===
  dmReplyEnabled: boolean
  dmIntervalMinutes: number
  dmWhitelistOnly: boolean
  dmWhitelist: string[]
  dmMaxPerUserPerDay: number
  dmDailyCap: number
  dmPersonaPrompt: string

  // === 5. 安全防風控 ===
  jitterMinSeconds: number
  jitterMaxSeconds: number
  maxHourlyPatrolComments: number
  maxPatrolCommentsPerRun: number
  minCommentIntervalSeconds: number
  maxHourlyMentionReplies: number
  maxMentionRepliesPerRun: number
  maxHourlyDmReplies: number
  maxDmRepliesPerRun: number
  cooldownMinutesOnBlock: number

  // === 6. LLM 模型與外部訂閱額度 (參照 dsh-discord-plugin) ===
  llmMode: 'auto' | 'subscriptions' | 'custom'
  subscriptionProvider: string
  subscriptionModel: string
  customLlmApiKey: string
  customLlmApiBase: string
  customLlmModel: string
}

export const DEFAULT_EXCLUDE_KEYWORDS = [
  '廣告',
  '互粉',
  '代購',
  '抽獎',
  '博彩',
  '色情',
  '兼職',
  'AI生成',
  'AI影片',
  'AI動畫',
  'AI繪圖',
  'AI文章',
  'AIGC',
  'Midjourney',
  'Stable Diffusion',
  'Sora',
  'Runway',
  'Kling',
  '可靈',
  '即夢',
  'AI配音',
  'AI美女',
]

export const defaultConfig: InstagramPluginConfig = {
  // 1. 身份與目標
  botUsername: '',
  targetMentionUser: '',

  // 2. 背景巡查與推薦 (預設不搜泛用 'ai' 以免搜出大量 AI 生成影片/動畫/農場文)
  patrolEnabled: true,
  patrolIntervalMinutes: 15,
  fuzzySearchEnabled: true,
  fuzzyKeywords: ['deepseek', 'coding', 'tech', 'github'],
  tagSearchEnabled: false,
  hashtags: ['deepseek', 'coding', 'tech', 'github'],
  patrolSearchLimit: 10,
  minLikes: 20,
  minComments: 2,
  excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
  requireKeywords: [],
  maxDailyPatrolComments: 10,
  patrolPersonaPrompt:
    '你是一個熱情、專業且具備敏銳眼光的科技社群助手。評估這則貼文是否具有實質技術、真實創作或應用價值（嚴格排除 AI 生成的影片、AI 動畫、AI 繪圖與 AI 生成文章），若值得推薦，請用簡短吸引人的語氣向目標用戶推薦推坑。',
  recommendTemplate: '@{targetUser} 這篇關於 #{hashtag} 的內容很值得一看：{summary}',

  // 3. 被 @ 提問應答
  mentionReplyEnabled: true,
  mentionIntervalMinutes: 5,
  maxContextComments: 10,
  roundCapPerPost: 3,
  maxDailyMentionReplies: 20,
  whitelistUsers: [],
  blacklistUsers: [],
  mentionPersonaPrompt:
    '你是一個聰慧、客氣且具備深度技術理解的 AI 助理。請結合貼文的完整上下文（發布者、內文、相鄰留言）認真回答用戶的提問，語氣自然友善，回答精簡聚焦。',

  // 4. 私訊雙向應答
  dmReplyEnabled: true,
  dmIntervalMinutes: 3,
  dmWhitelistOnly: false,
  dmWhitelist: [],
  dmMaxPerUserPerDay: 5,
  dmDailyCap: 30,
  dmPersonaPrompt:
    '你是一個禮貌、溫暖的社群助理。這是一則私訊互動，請用簡潔自然的口吻給予用戶解答或致謝。',

  // 5. 安全防風控 (保守安全設定，保護帳號避免停權)
  jitterMinSeconds: 6,
  jitterMaxSeconds: 15,
  maxHourlyPatrolComments: 3,
  maxPatrolCommentsPerRun: 1,
  minCommentIntervalSeconds: 30,
  maxHourlyMentionReplies: 5,
  maxMentionRepliesPerRun: 2,
  maxHourlyDmReplies: 8,
  maxDmRepliesPerRun: 3,
  cooldownMinutesOnBlock: 30,

  // 6. LLM 模型與外部插件訂閱額度
  llmMode: 'auto',
  subscriptionProvider: 'antigravity',
  subscriptionModel: 'gemini-2.5-flash',
  customLlmApiKey: '',
  customLlmApiBase: 'https://api.deepseek.com',
  customLlmModel: 'deepseek-chat',
}

/**
 * 解包 Schemastery volatile 欄位與防止空物件 {} 污染
 */
export function unwrapValue<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback
  if (val === '[object Object]') return fallback
  if (typeof val === 'object' && typeof val.get === 'function') {
    const v = val.get()
    return v !== undefined && v !== null && typeof v !== 'object' ? v : fallback
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    return fallback
  }
  return val as T
}

export function sanitizeConfig(raw: any): InstagramPluginConfig {
  const c = raw || {}
  const botUser = unwrapValue(c.botUsername, unwrapValue(c.username, defaultConfig.botUsername))
  const rawMode = String(unwrapValue(c.llmMode, defaultConfig.llmMode) || 'auto').trim()
  const llmMode = (['auto', 'subscriptions', 'custom'].includes(rawMode) ? rawMode : 'auto') as
    | 'auto'
    | 'subscriptions'
    | 'custom'

  return {
    botUsername: botUser,
    targetMentionUser: unwrapValue(c.targetMentionUser, defaultConfig.targetMentionUser),

    patrolEnabled: unwrapValue(c.patrolEnabled, defaultConfig.patrolEnabled),
    patrolIntervalMinutes: unwrapValue(c.patrolIntervalMinutes, defaultConfig.patrolIntervalMinutes),
    fuzzySearchEnabled: unwrapValue(c.fuzzySearchEnabled, defaultConfig.fuzzySearchEnabled),
    fuzzyKeywords: Array.isArray(c.fuzzyKeywords)
      ? c.fuzzyKeywords
      : Array.isArray(c.hashtags)
      ? c.hashtags
      : defaultConfig.fuzzyKeywords,
    tagSearchEnabled: unwrapValue(c.tagSearchEnabled, defaultConfig.tagSearchEnabled),
    hashtags: Array.isArray(c.hashtags) ? c.hashtags : defaultConfig.hashtags,
    patrolSearchLimit: unwrapValue(c.patrolSearchLimit, defaultConfig.patrolSearchLimit),
    minLikes: unwrapValue(c.minLikes, defaultConfig.minLikes),
    minComments: unwrapValue(c.minComments, defaultConfig.minComments),
    excludeKeywords: Array.isArray(c.excludeKeywords) ? c.excludeKeywords : defaultConfig.excludeKeywords,
    requireKeywords: Array.isArray(c.requireKeywords) ? c.requireKeywords : defaultConfig.requireKeywords,
    maxDailyPatrolComments: unwrapValue(c.maxDailyPatrolComments, defaultConfig.maxDailyPatrolComments),
    patrolPersonaPrompt: unwrapValue(c.patrolPersonaPrompt, defaultConfig.patrolPersonaPrompt),
    recommendTemplate: unwrapValue(c.recommendTemplate, defaultConfig.recommendTemplate),

    mentionReplyEnabled: unwrapValue(c.mentionReplyEnabled, defaultConfig.mentionReplyEnabled),
    mentionIntervalMinutes: unwrapValue(c.mentionIntervalMinutes, defaultConfig.mentionIntervalMinutes),
    maxContextComments: unwrapValue(c.maxContextComments, defaultConfig.maxContextComments),
    roundCapPerPost: unwrapValue(c.roundCapPerPost, defaultConfig.roundCapPerPost),
    maxDailyMentionReplies: unwrapValue(c.maxDailyMentionReplies, defaultConfig.maxDailyMentionReplies),
    whitelistUsers: Array.isArray(c.whitelistUsers) ? c.whitelistUsers : defaultConfig.whitelistUsers,
    blacklistUsers: Array.isArray(c.blacklistUsers) ? c.blacklistUsers : defaultConfig.blacklistUsers,
    mentionPersonaPrompt: unwrapValue(c.mentionPersonaPrompt, defaultConfig.mentionPersonaPrompt),

    dmReplyEnabled: unwrapValue(c.dmReplyEnabled, defaultConfig.dmReplyEnabled),
    dmIntervalMinutes: unwrapValue(c.dmIntervalMinutes, defaultConfig.dmIntervalMinutes),
    dmWhitelistOnly: unwrapValue(c.dmWhitelistOnly, defaultConfig.dmWhitelistOnly),
    dmWhitelist: Array.isArray(c.dmWhitelist) ? c.dmWhitelist : defaultConfig.dmWhitelist,
    dmMaxPerUserPerDay: unwrapValue(c.dmMaxPerUserPerDay, defaultConfig.dmMaxPerUserPerDay),
    dmDailyCap: unwrapValue(c.dmDailyCap, defaultConfig.dmDailyCap),
    dmPersonaPrompt: unwrapValue(c.dmPersonaPrompt, defaultConfig.dmPersonaPrompt),

    jitterMinSeconds: unwrapValue(c.jitterMinSeconds, defaultConfig.jitterMinSeconds),
    jitterMaxSeconds: unwrapValue(c.jitterMaxSeconds, defaultConfig.jitterMaxSeconds),
    maxHourlyPatrolComments: unwrapValue(c.maxHourlyPatrolComments, defaultConfig.maxHourlyPatrolComments),
    maxPatrolCommentsPerRun: unwrapValue(c.maxPatrolCommentsPerRun, defaultConfig.maxPatrolCommentsPerRun),
    minCommentIntervalSeconds: unwrapValue(c.minCommentIntervalSeconds, defaultConfig.minCommentIntervalSeconds),
    maxHourlyMentionReplies: unwrapValue(c.maxHourlyMentionReplies, defaultConfig.maxHourlyMentionReplies),
    maxMentionRepliesPerRun: unwrapValue(c.maxMentionRepliesPerRun, defaultConfig.maxMentionRepliesPerRun),
    maxHourlyDmReplies: unwrapValue(c.maxHourlyDmReplies, defaultConfig.maxHourlyDmReplies),
    maxDmRepliesPerRun: unwrapValue(c.maxDmRepliesPerRun, defaultConfig.maxDmRepliesPerRun),
    cooldownMinutesOnBlock: unwrapValue(c.cooldownMinutesOnBlock, defaultConfig.cooldownMinutesOnBlock),

    llmMode,
    subscriptionProvider: String(unwrapValue(c.subscriptionProvider, defaultConfig.subscriptionProvider) || 'antigravity').trim(),
    subscriptionModel: String(unwrapValue(c.subscriptionModel, defaultConfig.subscriptionModel) || 'gemini-2.5-flash').trim(),
    customLlmApiKey: String(unwrapValue(c.customLlmApiKey, defaultConfig.customLlmApiKey) || '').trim(),
    customLlmApiBase: String(unwrapValue(c.customLlmApiBase, defaultConfig.customLlmApiBase) || 'https://api.deepseek.com').trim(),
    customLlmModel: String(unwrapValue(c.customLlmModel, defaultConfig.customLlmModel) || 'deepseek-chat').trim(),
  }
}

/**
 * 構建 Schemastery Schema (若 DSH 宿主提供 z/schemastery 則建構，否則優雅降級)
 */
export function buildConfigSchema(z: any) {
  if (!z || typeof z.object !== 'function') {
    return undefined
  }

  return z.object({
    // === 身份識別 (帳號密碼與 Session 由 @luoyi-dsh/instagram-mcp 核心服務提供) ===
    botUsername: z.string().default('').description('機器人自身的 Instagram 帳號名（留空時自動沿用 MCP 登入之帳號）').extra('volatile', true),
    targetMentionUser: z.string().default('').description('推坑目標用戶帳號（巡查發現優質貼文時 @目標用戶）').extra('volatile', true),

    // === 背景巡查與推薦 ===
    patrolEnabled: z.boolean().default(true).description('是否開啟背景巡查與推坑').extra('volatile', true),
    patrolIntervalMinutes: z.natural().default(15).description('巡查週期（分鐘，預設 15）').extra('volatile', true),
    fuzzySearchEnabled: z.boolean().default(true).description('是否啟用模糊搜尋抓取貼文（推薦開啟，解決 Tags 抓到 0 則貼文問題）').extra('volatile', true),
    fuzzyKeywords: z.array(z.string()).default(['deepseek', 'coding', 'tech', 'github']).description('模糊搜尋關鍵字列表').extra('volatile', true),
    tagSearchEnabled: z.boolean().default(false).description('是否啟用 Tags 標籤搜尋（預設關閉，保留可手動切換開關）').extra('volatile', true),
    hashtags: z.array(z.string()).default(['deepseek', 'coding', 'tech', 'github']).description('監聽的 Hashtags 標籤列表（當開啟 Tags 搜尋時使用）').extra('volatile', true),
    patrolSearchLimit: z.natural().default(10).description('每次搜尋各關鍵字/標籤抓取貼文的最大數量').extra('volatile', true),
    minLikes: z.natural().default(20).description('貼文門檻：最低按讚數（低於此值自動跳過）').extra('volatile', true),
    minComments: z.natural().default(2).description('貼文門檻：最低留言數').extra('volatile', true),
    excludeKeywords: z.array(z.string()).default(DEFAULT_EXCLUDE_KEYWORDS).description('排除關鍵字（命中即過濾垃圾宣傳與 AI 生成影片/動畫/文章）').extra('volatile', true),
    requireKeywords: z.array(z.string()).default([]).description('必要關鍵字（非空時內文需命中至少一項）').extra('volatile', true),
    maxDailyPatrolComments: z.natural().default(10).description('每日巡查推坑留言上限（安全頻次保護）').extra('volatile', true),
    patrolPersonaPrompt: z.string().role('textarea').default(defaultConfig.patrolPersonaPrompt).description('巡查推坑口吻與評估準則 Prompt').extra('volatile', true),
    recommendTemplate: z.string().default(defaultConfig.recommendTemplate).description('推坑留言格式範本').extra('volatile', true),

    // === 被 @ 提問應答 ===
    mentionReplyEnabled: z.boolean().default(true).description('是否開啟被 @ 提問應答').extra('volatile', true),
    mentionIntervalMinutes: z.natural().default(5).description('提問檢查週期（分鐘，預設 5）').extra('volatile', true),
    maxContextComments: z.natural().default(10).description('抓取貼文上下文時相鄰留言的最大筆數').extra('volatile', true),
    roundCapPerPost: z.natural().default(3).description('單一貼文最多回覆輪數（Round Cap，防互刷）').extra('volatile', true),
    maxDailyMentionReplies: z.natural().default(20).description('每日被 @ 回覆次數總上限').extra('volatile', true),
    whitelistUsers: z.array(z.string()).default([]).description('白名單用戶（非空時僅回覆名單內用戶）').extra('volatile', true),
    blacklistUsers: z.array(z.string()).default([]).description('黑名單用戶（無視名單內用戶之 @ 提問）').extra('volatile', true),
    mentionPersonaPrompt: z.string().role('textarea').default(defaultConfig.mentionPersonaPrompt).description('被 @ 回覆時的人設與風格 Prompt').extra('volatile', true),

    // === 私訊雙向應答 ===
    dmReplyEnabled: z.boolean().default(true).description('是否開啟未讀私訊自動應答').extra('volatile', true),
    dmIntervalMinutes: z.natural().default(3).description('私訊輪詢週期（分鐘，預設 3）').extra('volatile', true),
    dmWhitelistOnly: z.boolean().default(false).description('是否僅回覆私訊白名單用戶').extra('volatile', true),
    dmWhitelist: z.array(z.string()).default([]).description('私訊允許回覆之對象名單').extra('volatile', true),
    dmMaxPerUserPerDay: z.natural().default(5).description('單一用戶每日私訊回覆上限').extra('volatile', true),
    dmDailyCap: z.natural().default(30).description('全域每日私訊回覆總上限').extra('volatile', true),
    dmPersonaPrompt: z.string().role('textarea').default(defaultConfig.dmPersonaPrompt).description('私訊專用回覆口吻 Prompt').extra('volatile', true),

    // === 5. 安全防風控 ===
    jitterMinSeconds: z.number().default(6).description('動作前隨機抖動最小等待秒數 (建議 6 秒以上)').extra('volatile', true),
    jitterMaxSeconds: z.number().default(15).description('動作前隨機抖動最大等待秒數 (建議 15 秒以上)').extra('volatile', true),
    maxHourlyPatrolComments: z.natural().default(3).description('每小時巡查推坑留言上限 (防風控頻次保護)').extra('volatile', true),
    maxPatrolCommentsPerRun: z.natural().default(1).description('單次巡查任務最多發布的推坑留言則數 (避免短時間連發)').extra('volatile', true),
    minCommentIntervalSeconds: z.natural().default(30).description('同輪若有多筆留言時的最小強制間隔秒數').extra('volatile', true),
    maxHourlyMentionReplies: z.natural().default(5).description('每小時被 @ 回覆上限').extra('volatile', true),
    maxMentionRepliesPerRun: z.natural().default(2).description('單次檢查最多回覆的被 @ 留言則數').extra('volatile', true),
    maxHourlyDmReplies: z.natural().default(8).description('每小時私訊回覆上限').extra('volatile', true),
    maxDmRepliesPerRun: z.natural().default(3).description('單次檢查最多回覆的未讀私訊則數').extra('volatile', true),
    cooldownMinutesOnBlock: z.natural().default(30).description('遇到 Instagram 頻率限制或 Action Block 時強制冷卻暫停分鐘數').extra('volatile', true),

    // === 6. LLM 模型與外部插件訂閱額度 ===
    llmMode: z
      .union([
        z.const('auto').description('自動偵測 (優先自訂金鑰，未填時使用外部插件訂閱額度)'),
        z.const('subscriptions').description('DSH 平台訂閱額度 (Subscriptions - 免費免 Key)'),
        z.const('custom').description('自訂 API 金鑰 (Custom API)'),
      ])
      .default('auto')
      .description('LLM 推理來源模式')
      .extra('volatile', true),
    subscriptionProvider: z.string().default('antigravity').description('訂閱平台服務商 (如 antigravity, codex, grok)').extra('volatile', true),
    subscriptionModel: z.string().default('gemini-2.5-flash').description('訂閱平台模型名稱').extra('volatile', true),
    customLlmApiKey: z.string().role('secret').default('').description('自訂 LLM API Key (選填，未填時使用訂閱額度或宿主 LLM)').extra('volatile', true),
    customLlmApiBase: z.string().default('https://api.deepseek.com').description('自訂 LLM Base URL').extra('volatile', true),
    customLlmModel: z.string().default('deepseek-chat').description('自訂 LLM 模型名稱').extra('volatile', true),
  })
}
