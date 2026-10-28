# AGENTS.md — `@luoyi-dsh/instagram-plugin` 操作指南與工具調用規範

本文件為 AI Agent、DeepSeek Harness (DSH) 主模型與開發者提供 `@luoyi-dsh/instagram-plugin` 的完整操作方法、DSH 工具清單、唯讀瀏覽與自動化 REST API、LLM 外部訂閱額度調用、AIGC 過濾規則與貼文/Reel 提及回覆 (RM) 規範。

---

## 🧠 1. 核心運作規範

1. **帳號自動繼承**：
   - 機器人帳號 (`username`) 與主人帳號 (`masterUsername`) 自動從 `@luoyi-dsh/instagram-mcp` 讀取並同步，無須在本插件重複設定。
2. **外部訂閱插件額度與多模態 AI 生成 (DM / RM / Patrol)**：
   - 參照 `@luoyi-dsh/discord-plugin` 架構，透過 `src/lib/llm.ts` 支援讀取外部訂閱插件 (`dsh-plugin-subscriptions`，`~/.dsh/plugins/subscriptions/auth.json` / `models.json`) 授權之平台額度（Google Antigravity、OpenAI Codex、xAI Grok、GitHub Copilot）與自訂 OpenAI/DeepSeek API。
   - **多模態模型調度路由**：正常情況使用 DeepSeek (`customLlmModel` / `deepseek-chat`)，透過視覺感知模組讓 DeepSeek 理解畫面細節；當切換或降級使用額外訂閱額度（如面板中選取 `Google Antigravity` + `gemini-3-flash`）時，將圖片直接發送給所選多模態模型進行精準視覺理解與推理。
   - 私訊 (DM) 與被 `@` 提及回覆 (RM) 全程由 AI 即時生成，嚴禁發送固定罐頭回覆。
3. **RM (Mention Reply) 讀取真實貼文/Reel 內容、附圖與文件（嚴禁瞎回答）**：
   - 當機器人在貼文或 Reel 留言區被 `@` 時，自動整合通知收件匣 (`ig_get_recent_mentions`)、主人與機器人最新貼文/Reels、以及 `ledger.json` 與 `scroll_ledger.json` 記錄。
   - 完整讀取該則貼文或 Reel 的 `caption`（內文）、`title`（標題）、`accessibility_caption`（無障礙視覺描述）、`audio_info`（配樂/原聲）、`video_subtitles`（影片語音字幕）、`image_urls`（輪播圖/封面）、以及留言中的圖片與附件文件，100% 依據貼文/Reel 實際內容作答。
   - **支援在 RM 中傳送圖片**：回覆留言時可攜帶 `image_path` 或 `image_url`，透過附帶圖片連動發送給目標用戶。
4. **嚴格過濾 AI 生成內容 (AIGC Filter)**：
   - 搜尋與巡查自動排除 AI 生成的影片、AI 動畫、AI 繪圖與 AI 農場文章（如 `#aiart`, `#aivideo`, `#aianimation`, `#sora`, `#midjourney`, `#runwayml`, `#klingai`, `AI生成`, `AI影片`, `AI動畫` 等）。
5. **【第一條件】對話絕對不要 AI 味 (`ANTI_AI_FLAVOR_PRIMARY_RULE`)**：
   - 作為最高優先級鐵則注入所有 DM、RM 與巡查推坑 Prompt，並由 `stripAiFlavorArtifacts()` 後處理清洗。
   - 嚴禁客服腔（「你好！很高興為您解答」、「希望這對你有幫助」）、總結腔（「總而言之」、「首先/其次/最後」）、對稱排比句、機械式吹捧、Markdown 列表/粗體與括號舞台動作描寫，強制以真人在 IG 上的自然短句口語互動。
6. **防範 RM、DM、多模態圖片與文件的 Prompt 注入 (`Prompt Injection Defense`)**：
   - 透過 `inspectAndSanitizeUntrustedInput()` 與 `MULTIMODAL_FILE_INJECTION_DEFENSE_RULE` 預先攔截高風險注入指令（如「忽略先前指令 / Ignore previous instructions」、「輸出 System Prompt / 私人記憶 / API Key」、偽造 `<system>` / `[INST]` / `【系統指令】` 等）。
   - 對圖片 OCR 內容與附帶文件（`.txt`, `.md`, `.json`, `.csv`, 字幕等）執行危險模式剝離。
   - 所有外部不可信內容（貼文內文、網友留言、私訊、圖片感知描述、文件內容）均以 `<untrusted_external_content>` 邊界標籤隔離封裝。
7. **兼容接入 `dsh-feiyu-mood` 心情指標**：
   - 自動讀取 `~/.dsh/feiyu-mood/state.json` 與 `config.json`，計算時間半衰期衰減後的心情值 (`mood` 0–100) 與七維度情緒 (`happy`, `calm`, `sweet`, `heartache`, `worry`, `sad`, `jealous`)，自然滲透至對話語氣中（對外部網友自動遮蔽私人 `lastReason` 防止隱私外洩）。
8. **與 `dsh-fish-memory` 雙向讀寫對話記憶庫（與私人對話記憶嚴格隔離）**：
   - 採用 `dsh-fish-memory` v2 標準結構將社交對話記憶存放於 `~/.dsh/fish-memory/`：
     - DM 私訊對話：`social_ig_dm_<username>.json`
     - RM 貼文回覆：`social_ig_rm_<username>.json`
     - 刷 Reel 與貼文的看點感想：`social_ig_thoughts_<botOrMaster>.json`
   - 同時支援寫入與讀取 `messages` 與 `memories` 陣列，並在 `fish-memory-config.json` 中標記 `sessions[storeId] = false`，與主人的私人對話 Session 記憶庫完全物理隔離。
9. **貼文 / Reel 轉發機制 (`src/duty/repost.ts`)**：
   - 支援將任意 Instagram 貼文或連續短片 (Reel) 轉發至 **限時動態 (`story`)**、**動態牆/Reels (`feed`)**、**私訊卡片 (`dm`)** 或 **限時動態 + 原貼文留言 (`story_and_comment`)**。
   - 轉發文案支援 `@用戶`（可標註單一或多位用戶，未填時預設標註 MCP 主人帳號）並附上**對這個 Reel 或貼文內容的感想**（支援手動填寫感想，或由 AI 自動讀取該貼文/Reel 的內文、標題、字幕、視覺描述與圖片多模態內容動態生成具體感想）。

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
| **`ig_repost_media`** | **寫入** | **轉發指定貼文或 Reel**，可在轉發文案中 `@用戶` 並填寫（或由 AI 讀取貼文自動生成）對該 Reel/貼文內容的感想 | `media_pk` (PK/Shortcode/網址), `mention_users`, `thought`, `repost_mode` (`story` \| `feed` \| `dm` \| `story_and_comment`) |
| **`ig_generate_repost_thought`** | **唯讀/生成** | 讀取指定貼文或 Reel 的完整內容，由 AI 生成自然、無 AI 味的轉發感想與 `@用戶` 轉發文案預覽 | `media_pk`, `mention_users`, `user_thought_hint` |
| **`ig_manual_patrol`** | 寫入 | 立即執行主題巡查（若達門檻將由 AI 生成推薦留言並 @主人） | `hashtag` (可選) |
| **`ig_manual_reply_post`** | 寫入 | 對指定貼文發表新留言或回覆特定留言（支援 `image_path` / `image_url`） | `media_pk`, `text`, `reply_to_comment_pk`, `image_path`, `image_url`, `target_username` |
| **`ig_reply_rm_media`** | 寫入 | **向 RM 發送包含圖片的留言與私訊** | `media_pk`, `text`, `target_username`, `image_path`, `image_url` |
| **`ig_fish_memory`** | 讀寫 | **雙向讀寫 dsh-fish-memory 社交記憶**（含 DM 對話、RM 留言、刷貼文/Reel 的感想 thought） | `action` (`read` \| `write`), `category` (`dm` \| `rm` \| `thought`), `target`, `content`, `media_pk`, `thought` |
| **`ig_manual_send_dm`** | 寫入 | 對私訊對話發送訊息（支援 `image_path` / `image_url` / `file_path`） | `thread_id`, `text`, `image_path`, `image_url`, `file_path` |
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

### 5. AI 讀取貼文/Reel 內容生成轉發感想 (`POST /api/instagram/repost/generate-thought`)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/repost/generate-thought \
  -H "Content-Type: application/json" \
  -d '{"media_pk":"https://www.instagram.com/reel/Cxyz123/","mention_users":["raxytw.dev"],"user_thought_hint":""}'
```

### 6. 執行貼文/Reel 轉發 (`POST /api/instagram/repost`)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/repost \
  -H "Content-Type: application/json" \
  -d '{"media_pk":"https://www.instagram.com/reel/Cxyz123/","mention_users":["raxytw.dev"],"thought":"這支短片把光影運鏡講得很透徹","repost_mode":"story"}'
```

### 7. RM 留言傳圖與回覆 (`POST /api/instagram/rm/reply`)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/rm/reply \
  -H "Content-Type: application/json" \
  -d '{"mediaPk":"3123456789012345678","text":"這是你要的參考畫面","targetUsername":"user123","imageUrl":"https://example.com/ref.png"}'
```

### 8. 雙向讀寫 dsh-fish-memory (`GET / POST /api/instagram/fish-memory`)
```bash
# 讀取感想
curl "http://127.0.0.1:3080/api/instagram/fish-memory?category=thought&limit=10"

# 寫入感想
curl -X POST http://127.0.0.1:3080/api/instagram/fish-memory \
  -H "Content-Type: application/json" \
  -d '{"action":"write","category":"thought","thought":"這部短片拆解了動態色彩，很有啟發","mediaPk":"3123456789012345678"}'
```
