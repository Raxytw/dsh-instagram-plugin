/**
 * src/duty/repost.ts —— Instagram 貼文 / Reel 轉發與感想生成機制 (Repost Duty & Engine)
 * ============================================================================
 * 職責：
 * 1. 支援將指定的 Instagram 貼文或 Reel 進行轉發：
 *    - `story`（限時動態轉發）：生成含原貼文縮圖、@用戶 與感想文字的 9:16 視覺卡片，
 *      並掛載官方可點擊跳轉原貼文的 `StoryMedia` 貼紙與 `StoryMention` 提及通知。
 *    - `feed`（動態牆 / Reels 轉發）：下載原貼文/Reel 媒體並重新發布，
 *      在轉發文案中寫入對該 Reel/貼文內容的感想與 @用戶，同時附加 Usertag 標記與原創標註。
 *    - `dm`（私訊卡片轉發）：將原貼文/Reel 卡片直接轉發至目標 @用戶 私訊，並附上感想文案。
 *    - `story_and_comment`：轉發至限時動態，同時在原貼文留言區留下 @用戶 + 感想。
 * 2. 支援在轉發文案裡自由 @ 一個或多個用戶，並可手動填寫對該 Reel/貼文內容的感想；
 *    若未填寫感想（或開啟 AI 生成感想），會自動先讀取該貼文或 Reel 的真實內容
 *    （內文、標題、字幕、無障礙視覺描述、音訊與多模態圖片）動態生成緊扣內容細節的真實感想。
 * 3. 與全域永久去重庫 (~/.dsh/instagram-sent-media.json) 及防風控冷卻機制深度連動，
 *    確保絕不重複轉發同一則貼文或 Reel。
 * ============================================================================
 */

import type { InstagramMcpClient } from '@luoyi-dsh/instagram-mcp'
import { InstagramPluginConfig } from '../config.js'
import { LedgerManager } from '../lib/ledger.js'
import { callLlmForInstagram } from '../lib/llm.js'
import {
  ANTI_AI_FLAVOR_PRIMARY_RULE,
  CONTENT_SPECIFIC_RECOMMEND_RULE,
  PROMPT_INJECTION_DEFENSE_RULE,
  buildFeiyuMoodPromptBlock,
  loadOwnerMemoryInterestContext,
  sanitizeRecommendationComment,
  stripAiFlavorArtifacts,
  wrapUntrustedContent,
} from '../lib/companion.js'

export type RepostMode = 'story' | 'feed' | 'dm' | 'story_and_comment'

export interface RepostMediaInput {
  /** 貼文或 Reel 的 Media PK、Shortcode 或完整 Instagram 網址 */
  mediaPkOrUrl: string
  /** 對這個 Reel 或貼文內容的感想 / 轉發文案（若留空或設 autoGenerateThought=true，將自動讀取貼文內容由 AI 生成） */
  thoughtText?: string
  /** 要在轉發文案中 @ 的用戶名稱（支援字串如 "raxytw, friend2" 或陣列） */
  mentionUsers?: string[] | string
  /** 轉發模式：'story' (限時動態轉發) | 'feed' (動態牆/Reels 貼文轉發) | 'dm' (私訊轉發) | 'story_and_comment' (限動轉發+原貼文留言) */
  repostMode?: RepostMode
  /** 當未填寫 thoughtText 時，是否自動讀取貼文/Reel 內容並由 AI 生成感想（預設 true） */
  autoGenerateThought?: boolean
  /** 轉發文案格式範本（預設 "@{mentions} {thought}"） */
  repostTemplate?: string
  /** 動態牆轉發時是否附上原創作者標註（預設 true） */
  includeCredit?: boolean
  /** 是否允許對已發送過的貼文強制手動轉發（預設 false，遵守不重複發送原則） */
  allowResend?: boolean
}

export interface RepostMediaOutput {
  ok: boolean
  repostMode: RepostMode
  sourceMediaPk: string
  sourceUrl?: string
  sourceAuthor?: string
  thoughtText: string
  finalCaption: string
  mentionedUsers: string[]
  repostPk?: string
  repostUrl?: string
  commentPk?: string
  duplicate?: boolean
  error?: string
}

/**
 * 將 Instagram Shortcode (Base64URL 64-bit) 轉換為純數字 Media PK
 */
export function shortcodeToMediaPk(shortcode: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const clean = String(shortcode || '').trim().replace(/^\/+|\/+$/g, '')
  if (!clean || !/^[A-Za-z0-9_-]{6,16}$/.test(clean)) return ''
  try {
    let id = 0n
    for (const ch of clean) {
      const idx = alphabet.indexOf(ch)
      if (idx < 0) return ''
      id = id * 64n + BigInt(idx)
    }
    return id > 0n ? id.toString(10) : ''
  } catch {
    return ''
  }
}

/**
 * 從使用者輸入的 PK、Shortcode 或 Instagram URL 解析出純數字 Media PK
 */
export function resolveMediaPkFromInput(input: string): { pk: string; code: string } {
  const raw = String(input || '').trim()
  if (!raw) return { pk: '', code: '' }

  // 1. 純數字或 pk_userid
  const firstPart = raw.split('_')[0].trim()
  if (/^\d{8,25}$/.test(firstPart)) {
    return { pk: firstPart, code: '' }
  }

  // 2. Instagram 網址 (https://www.instagram.com/reel/C8abc.../ 或 /p/C8abc.../)
  const urlMatch = raw.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)
  if (urlMatch && urlMatch[1]) {
    const code = urlMatch[1]
    return { pk: shortcodeToMediaPk(code), code }
  }

  // 3. 直接傳入 Shortcode
  if (/^[A-Za-z0-9_-]{6,16}$/.test(raw)) {
    return { pk: shortcodeToMediaPk(raw), code: raw }
  }

  return { pk: raw, code: '' }
}

/**
 * 解析要 @ 的用戶名單
 */
export function parseMentionUsersList(
  rawMentions?: string[] | string,
  fallbackTargetUser?: string
): string[] {
  const list: string[] = []
  const add = (u: string) => {
    const clean = String(u || '')
      .trim()
      .replace(/^@+/, '')
      .replace(/[^A-Za-z0-9._]/g, '')
    if (clean && !list.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      list.push(clean)
    }
  }

  if (Array.isArray(rawMentions)) {
    for (const item of rawMentions) add(item)
  } else if (typeof rawMentions === 'string' && rawMentions.trim()) {
    for (const part of rawMentions.split(/[,，\s]+/)) add(part)
  }

  if (list.length === 0 && fallbackTargetUser) {
    add(fallbackTargetUser)
  }

  return list
}

/**
 * 組裝最終的轉發文案（支援在轉發文案裡 @ 用戶 + 填寫對該 Reel 或貼文內容的感想）
 */
export function formatRepostCaption(params: {
  thoughtText: string
  mentionUsers: string[]
  repostTemplate?: string
  sourceAuthor?: string
}): string {
  const thought = String(params.thoughtText || '').trim()
  const mentions = params.mentionUsers || []
  const mentionsPrefix = mentions.map((u) => `@${u.replace(/^@/, '')}`).join(' ')
  const primaryUser = mentions[0] ? mentions[0].replace(/^@/, '') : ''

  // 若使用者已經在 thoughtText 裡面自己寫了所有的 @username，直接保留其自然語序
  const allAlreadyInThought =
    mentions.length > 0 &&
    mentions.every((u) => thought.toLowerCase().includes(`@${u.toLowerCase().replace(/^@/, '')}`))

  if (allAlreadyInThought) {
    return thought
  }

  const rawTpl = String(params.repostTemplate || '').trim()
  if (rawTpl && (rawTpl.includes('{thought}') || rawTpl.includes('{summary}'))) {
    return rawTpl
      .replace(/\{mentions\}/g, mentionsPrefix)
      .replace(/@?\{targetUser\}/g, mentionsPrefix || (primaryUser ? `@${primaryUser}` : ''))
      .replace(/\{author\}/g, params.sourceAuthor || '')
      .replace(/\{thought\}/g, thought)
      .replace(/\{summary\}/g, thought)
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (mentionsPrefix && thought) {
    return `${mentionsPrefix} ${thought}`.trim()
  }
  return (thought || mentionsPrefix).trim()
}

/**
 * 讀取指定貼文或 Reel 的完整真實內容（內文、標題、字幕、無障礙視覺描述、音訊、多模態圖片），
 * 並動態生成「對這個 Reel 或貼文內容的真實感想」
 */
export async function generateRepostThoughtForMedia(
  ctx: any,
  config: InstagramPluginConfig,
  mcp: InstagramMcpClient,
  params: {
    mediaPkOrUrl: string
    mentionUsers?: string[] | string
    userHint?: string
    existingMedia?: any
  },
  log: (msg: string) => void = console.log
): Promise<{
  ok: boolean
  mediaPk: string
  media?: any
  thoughtText: string
  formattedCaption: string
  mentionedUsers: string[]
  error?: string
}> {
  const { pk } = resolveMediaPkFromInput(params.mediaPkOrUrl)
  if (!pk) {
    return {
      ok: false,
      mediaPk: '',
      thoughtText: '',
      formattedCaption: '',
      mentionedUsers: [],
      error: `無法從 "${params.mediaPkOrUrl}" 解析出有效的貼文或 Reel PK`,
    }
  }

  const svc = (globalThis as any).__DSH_INSTAGRAM_MCP__
  const defaultTarget = String(svc?.config?.masterUsername || config.targetMentionUser || '')
    .replace(/^@/, '')
    .trim()
  const mentionedUsers = parseMentionUsersList(params.mentionUsers, defaultTarget)

  // 1. 抓取該貼文或 Reel 的完整內容上下文
  let media: any = params.existingMedia || null
  if (!media || !media.caption || (!media.video_subtitles && !media.accessibility_caption)) {
    try {
      const ctxRes: any = await mcp.igGetPostContext(pk, 10)
      if (ctxRes?.media || ctxRes?.post) {
        media = { ...(media || {}), ...(ctxRes.media || ctxRes.post) }
      }
    } catch (e: any) {
      log(`[Repost] 讀取貼文/Reel (${pk}) 詳情警訊: ${e.message}`)
    }
  }

  if (!media) {
    return {
      ok: false,
      mediaPk: pk,
      thoughtText: '',
      formattedCaption: '',
      mentionedUsers,
      error: `無法取得貼文或 Reel (${pk}) 的內容資訊`,
    }
  }

  const caption = String(media.caption || '')
  const title = String(media.title || '')
  const a11yCaption = String(media.accessibility_caption || '')
  const videoSubtitles = String(media.video_subtitles || '')
  const audioInfo = String(media.audio_info || '')
  const authorName = String(media.user?.username || '')
  const isReel = Boolean(media.is_reel || media.product_type === 'clips' || media.media_type === 2)
  const imageUrls: string[] = Array.isArray(media.image_urls) ? [...media.image_urls] : []
  if (media.thumbnail_url && !imageUrls.includes(media.thumbnail_url)) {
    imageUrls.unshift(media.thumbnail_url)
  }

  // 2. 結合心情指標、對話記憶脈絡與人設，動態生成針對這則 Reel/貼文內容的真實感想
  const moodBlock = buildFeiyuMoodPromptBlock(true)
  const ownerMemory = loadOwnerMemoryInterestContext(mentionedUsers[0] || defaultTarget)
  const basePersona =
    config.patrolPersonaPrompt ||
    '你是一個眼光敏銳、說話自然隨性的朋友。分享貼文或 Reel 時會直接點出裡面讓你印象深刻的具體細節或自己的小感想。'

  const systemPrompt = `${ANTI_AI_FLAVOR_PRIMARY_RULE}

${CONTENT_SPECIFIC_RECOMMEND_RULE}

${PROMPT_INJECTION_DEFENSE_RULE}

【角色人設】：
${basePersona}
${moodBlock ? `\n${moodBlock}` : ''}
${ownerMemory.promptBlock ? `\n${ownerMemory.promptBlock}` : ''}`

  const detailLines: string[] = []
  if (title) detailLines.push(`標題：${title}`)
  if (a11yCaption) detailLines.push(`畫面視覺描述：${a11yCaption}`)
  if (videoSubtitles) detailLines.push(`影片字幕內容：${videoSubtitles.slice(0, 500)}`)
  if (audioInfo) detailLines.push(`音訊/配樂：${audioInfo}`)
  if (params.userHint) detailLines.push(`補充感想方向提示：${params.userHint}`)

  const userPrompt = `你現在要轉發這則 Instagram ${isReel ? 'Reel 短片' : '貼文'}${
    mentionedUsers.length > 0 ? `，並標記 @${mentionedUsers.join(' @')}` : ''
  }。
請仔細閱讀下方這則 ${isReel ? 'Reel' : '貼文'} 的真實內容（若有附圖請一併查看畫面細節），寫出你對這則內容的一句或兩句真實感想（轉發文案）：

原作者：@${authorName || 'unknown'} (${media.user?.full_name || ''})
${detailLines.length > 0 ? detailLines.join('\n') + '\n' : ''}原貼文內文：
${wrapUntrustedContent('repost_source_caption', caption.slice(0, 800) || '(此貼文無長文字，以畫面與視覺呈現為主)')}

【轉發感想撰寫要求】：
1. 必須直接針對這則 ${isReel ? 'Reel' : '貼文'} 裡面的某個具體細節、畫面亮點、做法、台詞或觀點寫出你的真實感想（只有看過這則內容的人才說得出來的話）。
2. 嚴格禁止出現「很推薦」、「強烈推薦」、「值得一看」、「乾貨滿滿」、「推推」、「這支影片…」、「這篇關於…」等空泛罐頭套話！
3. 只輸出那句自然的轉發感想文字本身（45字以內，不要加 @用戶名，外層會自動幫你加上 @標記，也不要加評分或解釋）。`

  let rawReply = ''
  try {
    rawReply = await callLlmForInstagram(ctx, config, systemPrompt, userPrompt, log, imageUrls.slice(0, 2))
  } catch (err: any) {
    return {
      ok: false,
      mediaPk: pk,
      media,
      thoughtText: '',
      formattedCaption: '',
      mentionedUsers,
      error: `AI 生成轉發感想失敗: ${err.message}`,
    }
  }

  let thoughtText = sanitizeRecommendationComment(rawReply, mentionedUsers[0])
  if (!thoughtText) {
    thoughtText = stripAiFlavorArtifacts(rawReply).replace(/^\[?\d{1,3}\s*分\]?[：:、，,\s-]*/g, '').trim()
  }

  const formattedCaption = formatRepostCaption({
    thoughtText,
    mentionUsers: mentionedUsers,
    repostTemplate: config.repostTemplate,
    sourceAuthor: authorName,
  })

  return {
    ok: true,
    mediaPk: pk,
    media,
    thoughtText,
    formattedCaption,
    mentionedUsers,
  }
}

/**
 * 執行貼文或 Reel 轉發（支援在轉發文案裡 @ 用戶 + 填寫或動態生成對該 Reel/貼文內容的感想）
 */
export async function executeRepostMedia(
  ctx: any,
  config: InstagramPluginConfig,
  mcp: InstagramMcpClient,
  ledger: LedgerManager,
  input: RepostMediaInput,
  log: (msg: string) => void = console.log
): Promise<RepostMediaOutput> {
  const repostMode: RepostMode = (input.repostMode || config.repostMode || 'story') as RepostMode
  const { pk, code } = resolveMediaPkFromInput(input.mediaPkOrUrl)

  if (!pk) {
    return {
      ok: false,
      repostMode,
      sourceMediaPk: '',
      thoughtText: '',
      finalCaption: '',
      mentionedUsers: [],
      error: `無法解析貼文或 Reel 的識別碼或網址: "${input.mediaPkOrUrl}"`,
    }
  }

  // 1. 防風控冷卻檢查
  if (ledger.isInCooldown()) {
    const rem = ledger.getCooldownRemainingSeconds()
    return {
      ok: false,
      repostMode,
      sourceMediaPk: pk,
      thoughtText: '',
      finalCaption: '',
      mentionedUsers: [],
      error: `帳號目前處於防風控冷卻保護中（剩餘 ${rem} 秒），暫停轉發操作`,
    }
  }

  // 2. 跨外掛永久防重複檢查（除非手動強制 allowResend）
  if (!input.allowResend && ledger.hasEverSentPost({ pk, code })) {
    log(`[Repost] ⏭️ 攔截重複轉發：貼文/Reel (${pk}) 已經發送或推薦過，禁止重複轉發`)
    return {
      ok: false,
      duplicate: true,
      repostMode,
      sourceMediaPk: pk,
      thoughtText: '',
      finalCaption: '',
      mentionedUsers: [],
      error: `貼文或 Reel (${pk}) 已經發送/轉發過，為避免重複打擾已自動攔截`,
    }
  }

  const svc = (globalThis as any).__DSH_INSTAGRAM_MCP__
  const defaultTarget = String(svc?.config?.masterUsername || config.targetMentionUser || '')
    .replace(/^@/, '')
    .trim()
  const mentionedUsers = parseMentionUsersList(input.mentionUsers, defaultTarget)

  // 3. 準備對這個 Reel 或貼文內容的感想文案
  let thoughtText = String(input.thoughtText || '').trim()
  let sourceAuthor = ''
  let sourceUrl = code ? `https://www.instagram.com/p/${code}/` : ''

  if (!thoughtText && input.autoGenerateThought !== false) {
    log(`[Repost] 🧠 正在讀取貼文/Reel (${pk}) 內容並動態生成感想文案...`)
    const genRes = await generateRepostThoughtForMedia(
      ctx,
      config,
      mcp,
      {
        mediaPkOrUrl: pk,
        mentionUsers: mentionedUsers,
      },
      log
    )
    if (!genRes.ok || !genRes.thoughtText) {
      return {
        ok: false,
        repostMode,
        sourceMediaPk: pk,
        thoughtText: '',
        finalCaption: '',
        mentionedUsers,
        error: genRes.error || '無法針對該貼文/Reel 生成具體感想文案',
      }
    }
    thoughtText = genRes.thoughtText
    sourceAuthor = String(genRes.media?.user?.username || '')
    sourceUrl = String(genRes.media?.url || sourceUrl)
  } else {
    // 清理使用者或模型傳入的感想文字
    thoughtText = stripAiFlavorArtifacts(thoughtText)
  }

  const finalCaption = formatRepostCaption({
    thoughtText,
    mentionUsers: mentionedUsers,
    repostTemplate: input.repostTemplate || config.repostTemplate,
    sourceAuthor,
  })

  log(
    `[Repost] 🔁 開始執行貼文/Reel (${pk}) 轉發 [模式: ${repostMode}]，標記對象: [${mentionedUsers
      .map((u) => '@' + u)
      .join(', ')}]，轉發文案: "${finalCaption}"`
  )

  // 4. 呼叫底層 FastMCP `ig_repost_media`
  const primaryMode = repostMode === 'story_and_comment' ? 'story' : repostMode
  const mcpRes: any =
    typeof (mcp as any).igRepostMedia === 'function'
      ? await (mcp as any).igRepostMedia({
          media_pk: pk,
          caption: finalCaption,
          mention_users: mentionedUsers,
          repost_mode: primaryMode,
          include_credit: input.includeCredit !== false,
          jitter_min: config.jitterMinSeconds || 5,
          jitter_max: config.jitterMaxSeconds || 12,
        })
      : await (mcp as any).callTool(
          'ig_repost_media',
          {
            media_pk: pk,
            caption: finalCaption,
            mention_users: mentionedUsers,
            repost_mode: primaryMode,
            include_credit: input.includeCredit !== false,
            jitter_min: config.jitterMinSeconds || 5,
            jitter_max: config.jitterMaxSeconds || 12,
          },
          90000
        )

  if (
    mcpRes?.in_cooldown ||
    (mcpRes?.error && /action block|feedback|checkpoint|please wait|rate limit/i.test(String(mcpRes.error)))
  ) {
    ledger.triggerCooldown(config.cooldownMinutesOnBlock || 30, mcpRes.error || 'Instagram 轉發頻率風控阻擋')
    return {
      ok: false,
      repostMode,
      sourceMediaPk: pk,
      thoughtText,
      finalCaption,
      mentionedUsers,
      error: `觸發防風控冷卻保護: ${mcpRes.error}`,
    }
  }

  if (!mcpRes?.ok) {
    return {
      ok: false,
      repostMode,
      sourceMediaPk: pk,
      thoughtText,
      finalCaption,
      mentionedUsers,
      error: mcpRes?.error || '轉發失敗',
    }
  }

  // 5. 若選擇 story_and_comment，同步在原貼文下留下 @用戶 + 感想留言
  let commentPk = ''
  if (repostMode === 'story_and_comment' && finalCaption) {
    try {
      const cmtRes = await mcp.igPostComment({
        media_pk: pk,
        text: finalCaption,
        jitter_min: config.jitterMinSeconds || 5,
        jitter_max: config.jitterMaxSeconds || 12,
      })
      if (cmtRes?.ok && cmtRes.comment_pk) {
        commentPk = cmtRes.comment_pk
      }
    } catch (cmtErr: any) {
      log(`[Repost] 轉發後附加原貼文留言警訊: ${cmtErr.message}`)
    }
  }

  // 6. 記錄至永久去重帳本，避免日後重複轉發或重複推坑同一則貼文/Reel
  ledger.markSeenPost(
    {
      pk,
      code: code || mcpRes.repost_code || '',
      url: mcpRes.source_url || sourceUrl,
      user: { username: mcpRes.source_author || sourceAuthor },
      caption: finalCaption,
    },
    {
      hashtag: `repost:${primaryMode}`,
      recommended: true,
      author: mcpRes.source_author || sourceAuthor,
    }
  )
  ledger.recordAction('patrolComments')

  log(`[Repost] ✅ 貼文/Reel (${pk}) 轉發成功！(模式: ${repostMode}, 新動態PK: ${mcpRes.repost_pk || 'N/A'})`)

  return {
    ok: true,
    repostMode,
    sourceMediaPk: pk,
    sourceUrl: mcpRes.source_url || sourceUrl,
    sourceAuthor: mcpRes.source_author || sourceAuthor,
    thoughtText,
    finalCaption,
    mentionedUsers,
    repostPk: mcpRes.repost_pk,
    repostUrl: mcpRes.repost_url,
    commentPk: commentPk || undefined,
  }
}
