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
}

export const defaultConfig: InstagramPluginConfig = {
  // 1. 身份與目標
  botUsername: '',
  targetMentionUser: '',

  // 2. 背景巡查與推薦
  patrolEnabled: true,
  patrolIntervalMinutes: 15,
  hashtags: ['ai', 'deepseek', 'coding', 'tech'],
  patrolSearchLimit: 10,
  minLikes: 20,
  minComments: 2,
  excludeKeywords: ['廣告', '互粉', '代購', '抽獎', '博彩', '色情', '兼職'],
  requireKeywords: [],
  maxDailyPatrolComments: 10,
  patrolPersonaPrompt: '你是一個熱情、專業且具備敏銳眼光的科技社群助手。評估這則貼文是否具有實質技術或應用價值，若值得推薦，請用簡短吸引人的語氣向目標用戶推薦推坑。',
  recommendTemplate: '@{targetUser} 這篇關於 #{hashtag} 的內容很值得一看：{summary}',

  // 3. 被 @ 提問應答
  mentionReplyEnabled: true,
  mentionIntervalMinutes: 5,
  maxContextComments: 10,
  roundCapPerPost: 3,
  maxDailyMentionReplies: 20,
  whitelistUsers: [],
  blacklistUsers: [],
  mentionPersonaPrompt: '你是一個聰慧、客氣且具備深度技術理解的 AI 助理。請結合貼文的完整上下文（發布者、內文、相鄰留言）認真回答用戶的提問，語氣自然友善，回答精簡聚焦。',

  // 4. 私訊雙向應答
  dmReplyEnabled: true,
  dmIntervalMinutes: 3,
  dmWhitelistOnly: false,
  dmWhitelist: [],
  dmMaxPerUserPerDay: 5,
  dmDailyCap: 30,
  dmPersonaPrompt: '你是一個禮貌、溫暖的社群助理。這是一則私訊互動，請用簡潔自然的口吻給予用戶解答或致謝。',

  // 5. 安全防風控
  jitterMinSeconds: 3,
  jitterMaxSeconds: 6,
}

/**
 * 解包 Schemastery volatile 欄位與防止空物件 {} 污染
 */
export function unwrapValue<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback
  if (val === '[object Object]') return fallback
  if (typeof val === 'object' && typeof val.get === 'function') {
    const v = val.get()
    return (v !== undefined && v !== null && typeof v !== 'object') ? v : fallback
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    return fallback
  }
  return val as T
}

export function sanitizeConfig(raw: any): InstagramPluginConfig {
  const c = raw || {}
  const botUser = unwrapValue(c.botUsername, unwrapValue(c.username, defaultConfig.botUsername))
  return {
    botUsername: botUser,
    targetMentionUser: unwrapValue(c.targetMentionUser, defaultConfig.targetMentionUser),

    patrolEnabled: unwrapValue(c.patrolEnabled, defaultConfig.patrolEnabled),
    patrolIntervalMinutes: unwrapValue(c.patrolIntervalMinutes, defaultConfig.patrolIntervalMinutes),
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
    patrolEnabled: z.boolean().default(true).description('是否開啟標籤背景巡查與推坑').extra('volatile', true),
    patrolIntervalMinutes: z.natural().default(15).description('標籤巡查週期（分鐘，預設 15）').extra('volatile', true),
    hashtags: z.array(z.string()).default(['ai', 'deepseek', 'coding', 'tech']).description('監聽的 Hashtags 標籤列表').extra('volatile', true),
    patrolSearchLimit: z.natural().default(10).description('每次搜尋各標籤抓取貼文的最大數量').extra('volatile', true),
    minLikes: z.natural().default(20).description('貼文門檻：最低按讚數（低於此值自動跳過）').extra('volatile', true),
    minComments: z.natural().default(2).description('貼文門檻：最低留言數').extra('volatile', true),
    excludeKeywords: z.array(z.string()).default(['廣告', '互粉', '代購', '抽獎', '博彩', '兼職']).description('排除關鍵字（命中即過濾垃圾宣傳）').extra('volatile', true),
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

    // === 安全防風控 ===
    jitterMinSeconds: z.number().default(3).description('動作前隨機抖動最小等待秒數').extra('volatile', true),
    jitterMaxSeconds: z.number().default(6).description('動作前隨機抖動最大等待秒數').extra('volatile', true),
  })
}
