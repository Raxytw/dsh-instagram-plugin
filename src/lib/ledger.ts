/**
 * src/lib/ledger.ts —— 狀態帳本持久化、跨外掛永久去重與頻次限制控制
 * ============================================================================
 * 職責：
 * 1. 記憶體維護快取並以原子寫入持久化至 data/ledger.json。
 * 2. 與姊妹外掛 dsh-instagram-scroll 及底層 dsh-instagram-mcp 共享全域永久已發送清單
 *    (~/.dsh/instagram-sent-media.json + scroll_ledger.json 雙向同步)，
 *    同時比對 Canonical PK、Shortcode (code)、URL 與作者+內文指紋，
 *    100% 確保任何已發送或已看過的貼文 / Reel 絕對不會重複發送！
 * 3. 針對貼文 PK、留言 PK、私訊 Message ID 提供去重檢查。
 * 4. 實作對話輪數上限（Round Cap），避免機器人之間互覆或惡意刷留言造成無窮遞迴。
 * 5. 統計當日推坑次數、回覆次數、私訊次數，並於跨日（按本地日期）自動歸零。
 * ============================================================================
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface DailyStats {
  date: string
  patrolComments: number
  mentionReplies: number
  dmReplies: number
  userDms: Record<string, number>
}

export interface HourlyAction {
  type: 'patrolComments' | 'mentionReplies' | 'dmReplies'
  time: number
}

export interface SeenPostMeta {
  timestamp: string
  hashtag?: string
  recommended?: boolean
  code?: string
  url?: string
  author?: string
  fingerprint?: string
}

export interface LedgerState {
  seenPosts: Record<string, SeenPostMeta>
  sentPosts?: Record<string, SeenPostMeta>
  seenComments: Record<string, { timestamp: string; postPk?: string; user?: string }>
  seenMessages: Record<string, { timestamp: string; threadId?: string; userId?: string }>
  postReplyRounds: Record<string, number>
  dailyStats: DailyStats
  hourlyActions?: HourlyAction[]
  cooldownUntil?: number
  cooldownReason?: string
}

export interface SharedSentMediaFile {
  version: number
  updatedAt: string
  sentPks: Record<string, { timestamp: string; code?: string; url?: string; source?: string; fingerprint?: string }>
  sentCodes: Record<string, string> // code -> canonicalPk
  sentFingerprints: Record<string, string> // author+captionHash -> canonicalPk
  seenPks: Record<string, { timestamp: string; code?: string; source?: string }>
  seenCodes: Record<string, string>
}

/** 正規化提取貼文或 Reel 的所有唯一識別碼 (Canonical PK、Shortcode、URL、內容指紋) */
export function extractCanonicalMediaIdentity(postOrPk: any): {
  canonicalPk: string
  rawPk: string
  code: string
  url: string
  author: string
  fingerprint: string
} {
  if (typeof postOrPk === 'string' || typeof postOrPk === 'number') {
    const raw = String(postOrPk).trim()
    const canonicalPk = raw.split('_')[0].trim()
    const urlCodeMatch = raw.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)
    const code = urlCodeMatch ? urlCodeMatch[1] : ''
    return { canonicalPk, rawPk: raw, code, url: '', author: '', fingerprint: '' }
  }

  const obj = postOrPk || {}
  const rawPk = String(obj.pk || obj.id || obj.postPk || '').trim()
  const canonicalPk = rawPk.split('_')[0].trim()
  const url = String(obj.url || '').trim()
  const urlCodeMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)
  const code = String(obj.code || (urlCodeMatch ? urlCodeMatch[1] : '') || '').trim()
  const author = String(obj.user?.username || obj.author || '')
    .toLowerCase()
    .replace(/^@/, '')
    .trim()
  const cleanCaption = String(obj.caption || '')
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/\s+/g, '')
    .slice(0, 80)
  const fingerprint = author && cleanCaption.length >= 12 ? `${author}:${cleanCaption}` : ''

  return { canonicalPk, rawPk, code, url, author, fingerprint }
}

export class LedgerManager {
  private filePath: string
  private state: LedgerState

  constructor(ledgerPath: string = 'data/ledger.json') {
    this.filePath = ledgerPath
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch {}
    }
    this.state = this.load()
    this.syncSharedRegistry()
    if (!existsSync(this.filePath)) {
      this.save()
    }
  }

  private getDshHomeDir(): string {
    return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh')
  }

  private getSharedSentMediaPath(): string {
    const dir = this.getDshHomeDir()
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch {}
    }
    return join(dir, 'instagram-sent-media.json')
  }

  private getSiblingScrollLedgerPath(): string {
    // data/ledger.json -> dsh-instagram-plugin -> parent -> dsh-instagram-scroll/data/scroll_ledger.json
    const pluginRoot = dirname(dirname(this.filePath))
    return join(dirname(pluginRoot), 'dsh-instagram-scroll', 'data', 'scroll_ledger.json')
  }

  private getSiblingScrollReportsDir(): string {
    const pluginRoot = dirname(dirname(this.filePath))
    return join(dirname(pluginRoot), 'dsh-instagram-scroll', 'data', 'reports')
  }

  private loadSharedRegistry(): SharedSentMediaFile {
    const sharedPath = this.getSharedSentMediaPath()
    const empty: SharedSentMediaFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sentPks: {},
      sentCodes: {},
      sentFingerprints: {},
      seenPks: {},
      seenCodes: {},
    }
    try {
      if (existsSync(sharedPath)) {
        const parsed = JSON.parse(readFileSync(sharedPath, 'utf-8'))
        return {
          version: 1,
          updatedAt: parsed.updatedAt || empty.updatedAt,
          sentPks: parsed.sentPks || {},
          sentCodes: parsed.sentCodes || {},
          sentFingerprints: parsed.sentFingerprints || {},
          seenPks: parsed.seenPks || {},
          seenCodes: parsed.seenCodes || {},
        }
      }
    } catch {}
    return empty
  }

  private saveSharedRegistry(reg: SharedSentMediaFile): void {
    try {
      reg.updatedAt = new Date().toISOString()
      const sharedPath = this.getSharedSentMediaPath()
      const tmp = `${sharedPath}.tmp`
      writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf-8')
      renameSync(tmp, sharedPath)
      ;(globalThis as any).__DSH_IG_SENT_REGISTRY__ = reg
    } catch {}
  }

  /**
   * 雙向同步本插件 ledger.json、dsh-instagram-scroll 的 scroll_ledger.json 與歷史日報，
   * 確保兩邊曾發送或看過的貼文/Reel 全部匯入全域永久去重帳本
   */
  public syncSharedRegistry(): SharedSentMediaFile {
    const reg = this.loadSharedRegistry()
    let dirty = false

    // 1. 同步本插件自身的 seenPosts 與 sentPosts
    if (!this.state.sentPosts) this.state.sentPosts = {}
    for (const [rawKey, meta] of Object.entries(this.state.seenPosts || {})) {
      const cleanPk = String(rawKey).split('_')[0].trim()
      if (!cleanPk) continue
      if (!reg.seenPks[cleanPk]) {
        reg.seenPks[cleanPk] = { timestamp: meta.timestamp || new Date().toISOString(), code: meta.code, source: 'plugin' }
        dirty = true
      }
      if (meta.code && !reg.seenCodes[meta.code]) {
        reg.seenCodes[meta.code] = cleanPk
        dirty = true
      }
      if (meta.recommended) {
        this.state.sentPosts[cleanPk] = meta
        if (!reg.sentPks[cleanPk]) {
          reg.sentPks[cleanPk] = {
            timestamp: meta.timestamp || new Date().toISOString(),
            code: meta.code,
            url: meta.url,
            fingerprint: meta.fingerprint,
            source: 'plugin-patrol',
          }
          dirty = true
        }
        if (meta.code && !reg.sentCodes[meta.code]) {
          reg.sentCodes[meta.code] = cleanPk
          dirty = true
        }
        if (meta.fingerprint && !reg.sentFingerprints[meta.fingerprint]) {
          reg.sentFingerprints[meta.fingerprint] = cleanPk
          dirty = true
        }
      }
    }

    // 2. 同步姊妹外掛 dsh-instagram-scroll 的 scroll_ledger.json
    const scrollLedgerPath = this.getSiblingScrollLedgerPath()
    if (existsSync(scrollLedgerPath)) {
      try {
        const scrollData = JSON.parse(readFileSync(scrollLedgerPath, 'utf-8'))
        for (const [rawKey, meta] of Object.entries<any>(scrollData?.seenPosts || {})) {
          const cleanPk = String(rawKey).split('_')[0].trim()
          if (!cleanPk) continue
          if (!reg.seenPks[cleanPk]) {
            reg.seenPks[cleanPk] = { timestamp: meta?.timestamp || new Date().toISOString(), source: 'scroll' }
            dirty = true
          }
          if (meta?.worthy && !reg.sentPks[cleanPk]) {
            reg.sentPks[cleanPk] = { timestamp: meta?.timestamp || new Date().toISOString(), source: 'scroll' }
            dirty = true
          }
        }
        const recArrays = [
          ...(Array.isArray(scrollData?.recommendedToday) ? scrollData.recommendedToday : []),
          ...(Array.isArray(scrollData?.recommendedHistory) ? scrollData.recommendedHistory : []),
          ...(Array.isArray(scrollData?.dailyStats?.recommendedItems) ? scrollData.dailyStats.recommendedItems : []),
        ]
        for (const item of recArrays) {
          const idInfo = extractCanonicalMediaIdentity(item)
          if (idInfo.canonicalPk && !reg.sentPks[idInfo.canonicalPk]) {
            reg.sentPks[idInfo.canonicalPk] = {
              timestamp: item?.timestamp || new Date().toISOString(),
              code: idInfo.code,
              url: idInfo.url,
              source: 'scroll-recommend',
            }
            dirty = true
          }
          if (idInfo.code && !reg.sentCodes[idInfo.code]) {
            reg.sentCodes[idInfo.code] = idInfo.canonicalPk || idInfo.code
            dirty = true
          }
        }
      } catch {}
    }

    // 3. 掃描 dsh-instagram-scroll/data/reports/*.md 歷史日報內所有已推薦過的貼文/Reel 短碼
    const reportsDir = this.getSiblingScrollReportsDir()
    if (existsSync(reportsDir)) {
      try {
        const files = readdirSync(reportsDir).filter((f) => f.endsWith('.md'))
        for (const f of files) {
          const md = readFileSync(join(reportsDir, f), 'utf-8')
          const matches = md.matchAll(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/gi)
          for (const m of matches) {
            const code = m[1]
            if (code && !reg.sentCodes[code]) {
              reg.sentCodes[code] = `report:${f}`
              dirty = true
            }
            if (code && !reg.seenCodes[code]) {
              reg.seenCodes[code] = `report:${f}`
              dirty = true
            }
          }
        }
      } catch {}
    }

    if (dirty || !existsSync(this.getSharedSentMediaPath())) {
      this.saveSharedRegistry(reg)
    } else {
      ;(globalThis as any).__DSH_IG_SENT_REGISTRY__ = reg
    }
    return reg
  }

  private getTodayString(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private load(): LedgerState {
    const today = this.getTodayString()
    const defaultState: LedgerState = {
      seenPosts: {},
      sentPosts: {},
      seenComments: {},
      seenMessages: {},
      postReplyRounds: {},
      dailyStats: {
        date: today,
        patrolComments: 0,
        mentionReplies: 0,
        dmReplies: 0,
        userDms: {},
      },
    }

    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8').trim()
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<LedgerState>
          const loaded: LedgerState = {
            seenPosts: parsed.seenPosts || {},
            sentPosts: parsed.sentPosts || {},
            seenComments: parsed.seenComments || {},
            seenMessages: parsed.seenMessages || {},
            postReplyRounds: parsed.postReplyRounds || {},
            dailyStats: parsed.dailyStats || defaultState.dailyStats,
            hourlyActions: Array.isArray(parsed.hourlyActions) ? parsed.hourlyActions : [],
            cooldownUntil: parsed.cooldownUntil || 0,
            cooldownReason: parsed.cooldownReason || '',
          }
          if (!loaded.dailyStats.userDms) {
            loaded.dailyStats.userDms = {}
          }
          this.checkRollover(loaded)
          return loaded
        }
      }
    } catch (err) {
      console.warn(`[Ledger] Warning loading ledger file ${this.filePath}:`, err)
    }

    return defaultState
  }

  private checkRollover(targetState: LedgerState = this.state): boolean {
    const today = this.getTodayString()
    if (targetState.dailyStats.date !== today) {
      targetState.dailyStats = {
        date: today,
        patrolComments: 0,
        mentionReplies: 0,
        dmReplies: 0,
        userDms: {},
      }
      return true
    }
    return false
  }

  public save(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      this.checkRollover()
      const content = JSON.stringify(this.state, null, 2)
      const tmpPath = `${this.filePath}.tmp`
      writeFileSync(tmpPath, content, 'utf-8')
      renameSync(tmpPath, this.filePath)
    } catch (err) {
      console.error(`[Ledger] Error saving ledger to ${this.filePath}:`, err)
    }
  }

  // === 貼文與 Reel 跨外掛永久去重 ===

  /**
   * 檢查該貼文或 Reel 是否已經發送/推薦過，或已經被任一外掛審閱過
   * 支援傳入 post 物件或 pk 字串，自動比對 Canonical PK、Raw PK、Shortcode (code) 與內容指紋
   */
  public hasSeenPost(postOrPk: any): boolean {
    const { canonicalPk, rawPk, code, fingerprint } = extractCanonicalMediaIdentity(postOrPk)
    const reg = this.syncSharedRegistry()

    if (canonicalPk) {
      if (this.state.seenPosts[canonicalPk] || this.state.sentPosts?.[canonicalPk]) return true
      if (reg.sentPks[canonicalPk] || reg.seenPks[canonicalPk]) return true
    }
    if (rawPk) {
      if (this.state.seenPosts[rawPk] || this.state.sentPosts?.[rawPk]) return true
      if (reg.sentPks[rawPk] || reg.seenPks[rawPk]) return true
    }
    if (code) {
      if (reg.sentCodes[code] || reg.seenCodes[code]) return true
      for (const meta of Object.values(this.state.seenPosts)) {
        if (meta.code && meta.code === code) return true
      }
    }
    if (fingerprint && reg.sentFingerprints[fingerprint]) {
      return true
    }
    return false
  }

  /**
   * 專門檢查該貼文或 Reel 是否「曾經被發送/推薦過」(跨日永久有效，絕不允許二次發送)
   */
  public hasEverSentPost(postOrPk: any): boolean {
    const { canonicalPk, rawPk, code, fingerprint } = extractCanonicalMediaIdentity(postOrPk)
    const reg = this.syncSharedRegistry()

    if (canonicalPk) {
      if (this.state.sentPosts?.[canonicalPk] || this.state.seenPosts[canonicalPk]?.recommended) return true
      if (reg.sentPks[canonicalPk]) return true
    }
    if (rawPk) {
      if (this.state.sentPosts?.[rawPk] || this.state.seenPosts[rawPk]?.recommended) return true
      if (reg.sentPks[rawPk]) return true
    }
    if (code && reg.sentCodes[code]) {
      return true
    }
    if (fingerprint && reg.sentFingerprints[fingerprint]) {
      return true
    }
    return false
  }

  public markSeenPost(
    postOrPk: any,
    meta: { hashtag?: string; recommended?: boolean; code?: string; url?: string; author?: string } = {}
  ): void {
    const idInfo = extractCanonicalMediaIdentity(postOrPk)
    const key = idInfo.canonicalPk || idInfo.rawPk
    if (!key) return

    const nowIso = new Date().toISOString()
    const finalCode = meta.code || idInfo.code || undefined
    const finalUrl = meta.url || idInfo.url || undefined
    const finalAuthor = meta.author || idInfo.author || undefined
    const finalFingerprint = idInfo.fingerprint || undefined

    const entry: SeenPostMeta = {
      timestamp: nowIso,
      ...meta,
      ...(finalCode ? { code: finalCode } : {}),
      ...(finalUrl ? { url: finalUrl } : {}),
      ...(finalAuthor ? { author: finalAuthor } : {}),
      ...(finalFingerprint ? { fingerprint: finalFingerprint } : {}),
    }

    this.state.seenPosts[key] = entry
    if (idInfo.rawPk && idInfo.rawPk !== key) {
      this.state.seenPosts[idInfo.rawPk] = entry
    }
    if (!this.state.sentPosts) this.state.sentPosts = {}
    if (meta.recommended) {
      this.state.sentPosts[key] = entry
    }
    this.save()

    // 同步寫入全域共享去重檔案 ~/.dsh/instagram-sent-media.json
    const reg = this.loadSharedRegistry()
    reg.seenPks[key] = { timestamp: nowIso, code: finalCode, source: 'plugin' }
    if (finalCode) {
      reg.seenCodes[finalCode] = key
    }
    if (meta.recommended) {
      reg.sentPks[key] = {
        timestamp: nowIso,
        code: finalCode,
        url: finalUrl,
        fingerprint: finalFingerprint,
        source: 'plugin-patrol',
      }
      if (finalCode) reg.sentCodes[finalCode] = key
      if (finalFingerprint) reg.sentFingerprints[finalFingerprint] = key
    }
    this.saveSharedRegistry(reg)
  }

  // === 留言去重 ===
  public hasSeenComment(commentPk: string): boolean {
    return Boolean(this.state.seenComments[commentPk])
  }

  public markSeenComment(commentPk: string, meta: { postPk?: string; user?: string } = {}): void {
    this.state.seenComments[commentPk] = {
      timestamp: new Date().toISOString(),
      ...meta,
    }
    this.save()
  }

  // === 私訊去重 ===
  public hasSeenMessage(messageId: string): boolean {
    return Boolean(this.state.seenMessages[messageId])
  }

  public markSeenMessage(messageId: string, meta: { threadId?: string; userId?: string } = {}): void {
    this.state.seenMessages[messageId] = {
      timestamp: new Date().toISOString(),
      ...meta,
    }
    this.save()
  }

  // === 貼文 Round Cap (對話輪數上限) ===
  public getPostReplyRound(postPk: string): number {
    const cleanPk = String(postPk || '').split('_')[0].trim()
    return this.state.postReplyRounds[cleanPk] || this.state.postReplyRounds[postPk] || 0
  }

  public canReplyToPost(postPk: string, roundCap: number): boolean {
    if (roundCap <= 0) return true
    const currentRounds = this.getPostReplyRound(postPk)
    return currentRounds < roundCap
  }

  public incrementPostReplyRound(postPk: string): number {
    const cleanPk = String(postPk || '').split('_')[0].trim() || postPk
    const next = (this.state.postReplyRounds[cleanPk] || 0) + 1
    this.state.postReplyRounds[cleanPk] = next
    this.save()
    return next
  }

  // === 每日配額控制 ===
  public canDoDaily(type: 'patrolComments' | 'mentionReplies' | 'dmReplies', cap: number): boolean {
    this.checkRollover()
    if (cap <= 0) return true
    return this.state.dailyStats[type] < cap
  }

  public incrementDaily(type: 'patrolComments' | 'mentionReplies' | 'dmReplies'): number {
    this.checkRollover()
    this.state.dailyStats[type] = (this.state.dailyStats[type] || 0) + 1
    this.save()
    return this.state.dailyStats[type]
  }

  public canSendUserDm(userId: string, capPerUser: number): boolean {
    this.checkRollover()
    if (capPerUser <= 0) return true
    const userCount = this.state.dailyStats.userDms[userId] || 0
    return userCount < capPerUser
  }

  public incrementUserDm(userId: string): number {
    this.checkRollover()
    const next = (this.state.dailyStats.userDms[userId] || 0) + 1
    this.state.dailyStats.userDms[userId] = next
    this.save()
    return next
  }

  public getDailyStats(): DailyStats {
    this.checkRollover()
    return { ...this.state.dailyStats }
  }

  // === 防風控熔斷冷卻 (Circuit Breaker Cooldown) ===
  public isInCooldown(): boolean {
    return typeof this.state.cooldownUntil === 'number' && Date.now() < this.state.cooldownUntil
  }

  public getCooldownRemainingSeconds(): number {
    if (!this.isInCooldown()) return 0
    return Math.max(0, Math.ceil((this.state.cooldownUntil! - Date.now()) / 1000))
  }

  public getCooldownReason(): string {
    return this.state.cooldownReason || ''
  }

  public triggerCooldown(minutes = 30, reason = ''): void {
    this.state.cooldownUntil = Date.now() + minutes * 60 * 1000
    this.state.cooldownReason = reason
    this.save()
    console.warn(
      `[Ledger] 🚨 觸發防風控冷卻保護！持續 ${minutes} 分鐘 (至 ${new Date(this.state.cooldownUntil).toLocaleTimeString()})。原因: ${reason}`
    )
  }

  public resetCooldown(): void {
    this.state.cooldownUntil = 0
    this.state.cooldownReason = ''
    this.save()
  }

  // === 小時頻次防護 ===
  private cleanOldHourlyActions(): void {
    const oneHourAgo = Date.now() - 3600 * 1000
    if (!Array.isArray(this.state.hourlyActions)) {
      this.state.hourlyActions = []
      return
    }
    this.state.hourlyActions = this.state.hourlyActions.filter((a) => a.time >= oneHourAgo)
  }

  public getHourlyCount(type: 'patrolComments' | 'mentionReplies' | 'dmReplies'): number {
    this.cleanOldHourlyActions()
    return (this.state.hourlyActions || []).filter((a) => a.type === type).length
  }

  public canDoHourly(type: 'patrolComments' | 'mentionReplies' | 'dmReplies', hourlyCap: number): boolean {
    if (this.isInCooldown()) return false
    if (hourlyCap <= 0) return true
    this.cleanOldHourlyActions()
    return this.getHourlyCount(type) < hourlyCap
  }

  public recordAction(type: 'patrolComments' | 'mentionReplies' | 'dmReplies'): void {
    this.cleanOldHourlyActions()
    if (!Array.isArray(this.state.hourlyActions)) {
      this.state.hourlyActions = []
    }
    this.state.hourlyActions.push({ type, time: Date.now() })
    this.incrementDaily(type)
  }
}
