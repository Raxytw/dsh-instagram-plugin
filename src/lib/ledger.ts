/**
 * src/lib/ledger.ts —— 狀態帳本持久化與頻次限制控制
 * ============================================================================
 * 職責：
 * 1. 記憶體維護快取並以原子寫入持久化至 data/ledger.json。
 * 2. 針對貼文 PK、留言 PK、私訊 Message ID 提供去重檢查。
 * 3. 實作對話輪數上限（Round Cap），避免機器人之間互覆或惡意刷留言造成無窮遞迴。
 * 4. 統計當日推坑次數、回覆次數、私訊次數，並於跨日（按本地日期）自動歸零。
 * ============================================================================
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface DailyStats {
  date: string
  patrolComments: number
  mentionReplies: number
  dmReplies: number
  userDms: Record<string, number>
}

export interface LedgerState {
  seenPosts: Record<string, { timestamp: string; hashtag?: string; recommended?: boolean }>
  seenComments: Record<string, { timestamp: string; postPk?: string; user?: string }>
  seenMessages: Record<string, { timestamp: string; threadId?: string; userId?: string }>
  postReplyRounds: Record<string, number>
  dailyStats: DailyStats
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
    if (!existsSync(this.filePath)) {
      this.save()
    }
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
            seenComments: parsed.seenComments || {},
            seenMessages: parsed.seenMessages || {},
            postReplyRounds: parsed.postReplyRounds || {},
            dailyStats: parsed.dailyStats || defaultState.dailyStats,
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

  // === 貼文去重 ===
  public hasSeenPost(postPk: string): boolean {
    return Boolean(this.state.seenPosts[postPk])
  }

  public markSeenPost(postPk: string, meta: { hashtag?: string; recommended?: boolean } = {}): void {
    this.state.seenPosts[postPk] = {
      timestamp: new Date().toISOString(),
      ...meta,
    }
    this.save()
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
    return this.state.postReplyRounds[postPk] || 0
  }

  public canReplyToPost(postPk: string, roundCap: number): boolean {
    if (roundCap <= 0) return true
    const currentRounds = this.getPostReplyRound(postPk)
    return currentRounds < roundCap
  }

  public incrementPostReplyRound(postPk: string): number {
    const next = (this.state.postReplyRounds[postPk] || 0) + 1
    this.state.postReplyRounds[postPk] = next
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
}
