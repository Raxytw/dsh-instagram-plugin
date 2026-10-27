import { LedgerManager } from '../dist/lib/ledger.js'
import { rmSync, existsSync } from 'node:fs'

const testLedgerPath = './data/test_ledger.json'
if (existsSync(testLedgerPath)) rmSync(testLedgerPath)

console.log('--- 測試 LedgerManager ---')
const ledger = new LedgerManager(testLedgerPath)

// 1. 貼文去重
console.assert(!ledger.hasSeenPost('post_1001'), 'post_1001 初始應未見')
ledger.markSeenPost('post_1001', { hashtag: 'tech', recommended: true })
console.assert(ledger.hasSeenPost('post_1001'), 'post_1001 標記後應為已見')

// 2. 留言去重
console.assert(!ledger.hasSeenComment('cmt_2001'), 'cmt_2001 初始應未見')
ledger.markSeenComment('cmt_2001', { postPk: 'post_1001', user: 'alice' })
console.assert(ledger.hasSeenComment('cmt_2001'), 'cmt_2001 標記後應為已見')

// 3. Round Cap 輪次控制
console.assert(ledger.canReplyToPost('post_1001', 3), '初始輪次為 0，應可回覆')
ledger.incrementPostReplyRound('post_1001')
ledger.incrementPostReplyRound('post_1001')
ledger.incrementPostReplyRound('post_1001')
console.assert(!ledger.canReplyToPost('post_1001', 3), '已滿 3 輪，應不可再回覆')

// 4. 每日上限測試
console.assert(ledger.canDoDaily('patrolComments', 2), '初始每日計數應小於上限 2')
ledger.incrementDaily('patrolComments')
ledger.incrementDaily('patrolComments')
console.assert(!ledger.canDoDaily('patrolComments', 2), '已達 2 次，應不可再執行')

// 清理測試檔案
if (existsSync(testLedgerPath)) rmSync(testLedgerPath)
if (existsSync(`${testLedgerPath}.tmp`)) rmSync(`${testLedgerPath}.tmp`)

console.log('✅ LedgerManager 單元測試全部通過！')
