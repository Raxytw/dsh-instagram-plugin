# AGENTS.md — `@luoyi-dsh/instagram-plugin` 操作指南與工具調用規範

本文件為 AI Agent、DeepSeek Harness (DSH) 主模型與開發者提供 `@luoyi-dsh/instagram-plugin` 的完整操作方法、DSH 工具清單、唯讀瀏覽與自動化 REST API、LLM 外部訂閱額度調用、AIGC 過濾規則與貼文/Reel 提及回覆 (RM) 規範。

---

## 🧠 1. 核心運作規範

1. **帳號自動繼承**：
   - 機器人帳號 (`username`) 與主人帳號 (`masterUsername`) 自動從 `@luoyi-dsh/instagram-mcp` 讀取並同步，無須在本插件重複設定。
2. **外部訂閱插件額度與 AI 生成 (DM / RM / Patrol)**：
   - 參照 `@luoyi-dsh/discord-plugin` 架構，透過 `src/lib/llm.ts` 支援讀取外部訂閱插件 (`dsh-plugin-subscriptions`，`~/.dsh/plugins/subscriptions/auth.json`) 授權之平台額度（Google Antigravity / OpenAI Codex / xAI Grok / GitHub Copilot）與自訂 OpenAI/DeepSeek API，且具備 402 餘額不足無縫降級機制。
   - 私訊 (DM) 與被 `@` 提及回覆 (RM) 全程由 AI 即時生成，嚴禁發送固定罐頭回覆。
3. **RM (Mention Reply) 讀取真實貼文/Reel 內容（嚴禁瞎回答）**：
   - 當機器人在貼文或 Reel 留言區被 `@` 時，自動整合通知收件匣 (`ig_get_recent_mentions`)、主人與機器人最新貼文/Reels、以及 `ledger.json` 與 `scroll_ledger.json` 記錄。
   - 完整讀取該則貼文或 Reel 的 `caption`（內文）、`title`（標題）、`accessibility_caption`（無障礙視覺描述）、`audio_info`（配樂/原聲）、`video_subtitles`（影片語音字幕）、`image_urls`（透過多模態視覺模型直接看圖）與父留言上下文，100% 依據貼文/Reel 實際內容作答。
4. **嚴格過濾 AI 生成內容 (AIGC Filter)**：
   - 搜尋與巡查自動排除 AI 生成的影片、AI 動畫、AI 繪圖與 AI 農場文章（如 `#aiart`, `#aivideo`, `#aianimation`, `#sora`, `#midjourney`, `#runwayml`, `#klingai`, `AI生成`, `AI影片`, `AI動畫` 等）。
5. **【第一條件】對話絕對不要 AI 味 (`ANTI_AI_FLAVOR_PRIMARY_RULE`)**：
   - 作為最高優先級鐵則注入所有 DM、RM 與巡查推坑 Prompt，並由 `stripAiFlavorArtifacts()` 後處理清洗。
   - 嚴禁客服腔（「你好！很高興為您解答」、「希望這對你有幫助」）、總結腔（「總而言之」、「首先/其次/最後」）、對稱排比句、機械式吹捧、Markdown 列表/粗體與括號舞台動作描寫，強制以真人在 IG 上的自然短句口語互動。
6. **防範 RM 與 DM 的 Prompt 注入 (`Prompt Injection Defense`)**：
   - 透過 `inspectAndSanitizeUntrustedInput()` 預先攔截高風險注入指令（如「忽略先前指令 / Ignore previous instructions」、「輸出 System Prompt / 私人記憶 / API Key」、偽造 `<system>` / `[INST]` / `【系統指令】` 等），命中即拒絕回覆並標記已讀。
   - 所有外部不可信內容（貼文內文、網友留言、私訊）均以 `<untrusted_external_content>` 邊界標籤隔離封裝。
7. **兼容接入 `dsh-feiyu-mood` 心情指標**：
   - 自動讀取 `~/.dsh/feiyu-mood/state.json` 與 `config.json`，計算時間半衰期衰減後的心情值 (`mood` 0–100) 與七維度情緒 (`happy`, `calm`, `sweet`, `heartache`, `worry`, `sad`, `jealous`)，自然滲透至對話語氣中（對外部網友自動遮蔽私人 `lastReason` 防止隱私外洩）。
8. **與 `dsh-fish-memory` 建立隔離對話記憶庫（與私人對話記憶嚴格隔離）**：
   - 採用 `dsh-fish-memory` v2 標準結構將社交對話記憶獨立存放於 `~/.dsh/fish-memory/social_ig_dm_<username>.json` 與 `social_ig_rm_<username>.json`，並在 `fish-memory-config.json` 中標記 `sessions[storeId] = false`，與主人的私人對話 Session 記憶庫完全物理隔離，絕不讀取或外洩任何私人對話記憶。

---

## 🛠️ 2. 提供之 DSH 工具清單

| 工具名稱 | 類型 | 說明 | 關鍵參數 |
| :--- | :--- | :--- | :--- |
| **`ig_browse_user_posts`** | **唯讀** | 讀取指定創作者的最新貼文，包含個人檔案與聯名作者解析 | `username` (必填), `limit` |
| **`ig_browse_reels`** | **唯讀** | 刷 Reels 短片（可指定創作者或探索推薦） | `username` (可選), `limit` |
| **`ig_browse_timeline`** | **唯讀** | 讀取首頁動態探索貼文流 | `limit` |
| **`ig_search_users`** | **唯讀** | 搜尋 Instagram 使用者（回傳粉絲數、認證標章） | `query` (必填), `limit` |
| **`ig_search_tags`** | **唯讀** | 搜尋 Instagram 標籤（回傳公開貼文總量） | `query` (必填), `limit` |
| **`ig_check_status`** | 資訊 | 取得外掛程式連線狀態、登入用戶名與配額 | 無 |
| **`ig_search_hashtag`** | 查詢 | 模糊/標籤搜尋指定關鍵字最新貼文（已過濾 AIGC） | `hashtag` (必填), `limit` |
| **`ig_get_post_context`** | 唯讀 | 取得特定貼文或 Reel 之全文、視覺描述、字幕與留言清單 | `media_pk` (必填), `comment_limit` |
| **`ig_manual_patrol`** | 寫入 | 立即執行主題巡查（若達門檻將由 AI 生成推薦留言並 @主人） | `hashtag` (可選) |
| **`ig_manual_reply_post`** | 寫入 | 對指定貼文發表新留言或回覆特定留言 | `media_pk`, `text`, `reply_to_comment_pk` |
| **`ig_manual_send_dm`** | 寫入 | 對私訊對話發送訊息 | `thread_id`, `text` |
| **`ig_run_duties_now`** | 寫入 | 巡查、提及回覆 (RM)、私訊回覆 (DM) 各執行一輪 | 無 |

---

## 🔍 3. 唯讀瀏覽與探索 REST API (預設埠 3080)

### 1. 讀取指定創作者貼文 (`GET /api/instagram/browse/user`)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/user?username=wired&limit=5"
```

### 2. 刷 Reels 連續短片 (`GET /api/instagram/browse/reels`)
```bash
# 探索熱門推薦 Reels
curl "http://127.0.0.1:3080/api/instagram/browse/reels?limit=6"

# 指定創作者的 Reels
curl "http://127.0.0.1:3080/api/instagram/browse/reels?username=wired&limit=6"
```

### 3. 首頁動態探索 (`GET /api/instagram/browse/explore`)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/explore?limit=6"
```

### 4. 搜尋用戶與標籤 (`GET /api/instagram/browse/search`)
```bash
# 搜尋使用者
curl "http://127.0.0.1:3080/api/instagram/browse/search?q=verge&type=users"

# 搜尋主題標籤
curl "http://127.0.0.1:3080/api/instagram/browse/search?q=technology&type=tags"
```

---

## ⚡ 4. 業務、自動化與模型測試 REST API

### 1. 檢查狀態與已授權訂閱平台 (`GET /api/instagram/status`)
```bash
curl http://127.0.0.1:3080/api/instagram/status
```

### 2. 測試 AI 推理模型連線 (`POST /api/instagram/test-llm`)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/test-llm \
  -H "Content-Type: application/json" \
  -d '{"llmMode":"auto"}'
```

### 3. 立即手動執行一輪自動化循環 (`POST /api/instagram/run`)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/run \
  -H "Content-Type: application/json" \
  -d "{}"
```

### 4. 讀取與更新配置 (`GET / POST /api/instagram/config`)
```bash
curl http://127.0.0.1:3080/api/instagram/config
```
