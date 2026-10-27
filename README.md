# DSH Instagram 業務插件 (`dsh-instagram-plugin`)

依賴 `dsh-instagram-mcp` 的 FastMCP 連線與登入憑證。這個插件負責兩大核心能力：
1. **安全唯讀瀏覽與探索 (Read-Only Browsing)**：刷指定創作者貼文、刷 Reels 短片、探索首頁動態、搜尋用戶與標籤（不按讚、不發文、不留痕跡）。
2. **自動化社群互動助理 (Automation Duties)**：標籤巡查推坑、貼文 @提及應答、代回未讀私訊。

Web 設定與瀏覽介面位於 DSH 的 `client.js`。2026-10-27 在本機 `http://127.0.0.1:3080` 完整調試與驗證。

---

## 核心問題與重大修復 (2026-10-27 更新)

針對先前使用者瀏覽時遇到的痛點，本版已進行徹底修復與升級：

### 1. 解決「工具叫不到」：雙軌呼叫機制
- **DSH 工具註冊**：新增註冊 5 個專屬唯讀工具（`ig_browse_user_posts`、`ig_browse_reels`、`ig_browse_timeline`、`ig_search_users`、`ig_search_tags`）。
- **獨立 REST HTTP 瀏覽端點**：即便在某些對話環境中模型未載入插件工具，任何腳本、curl 或前端介面皆可透過 `http://127.0.0.1:3080/api/instagram/browse/*` 直連調用，絕不受阻。

### 2. 解決「沒有只瀏覽入口」：全新只讀瀏覽線路
- 舊版只有 `/api/instagram/run`，會執行巡查並可能直接發留言 @人。
- 新增專屬 `/api/instagram/browse/user`、`/api/instagram/browse/reels` 等端點，純讀取創作者貼文或短片，絕不觸發任何留言、點讚或追蹤，安全無風控疑慮。

### 3. 解決「標籤搜尋假成功（回傳 0 則卻顯示 ok）」
- **真實現象**：Instagram 官方行動端 API 近期對公開 Hashtag 的 `recent` 與 `top` 端點實施嚴格風控限制，多數標籤請求會被 Instagram 官方阻斷並回傳空列表。
- **修復**：後端不再吞掉例外假裝成功，而是診斷並回傳 `status: "restricted_or_empty"`，並在 Web 介面與回應中明確提醒：「Instagram 官方已限制公開 Hashtag 端點，建議改用『指定創作者貼文』或『探索 Reels』獲取可靠內容」。

### 4. 解決「改抓帳號貼文不穩與聯名發文混淆」
- **空帳號排查**：部分帳號如 `theverge`、`hypertech` 貼文為 0，是因為這些是佔名號或無貼文帳號（例如科技媒體 The Verge 的真實官方帳號為 `verge`，有 6,400+ 篇貼文）。新版回傳包含 `user_meta`（粉絲數、貼文總數 `media_count`），若 `media_count: 0` 會明確標註警告，防止誤判。
- **聯名貼文 (Collaborative Posts) 正確標籤**：例如 TechCrunch 與作者的聯名貼文，Instagram 官方結構會將作者放在 `m.user`（例如 `@dominicmadori`），而將 TechCrunch 放在 `m.coauthor_producers`。新版核心解析器已補全 `is_collaborative: true` 與 `coauthors`，並在前端以 `[聯名發布] @dominicmadori × @techcrunch` 清晰標示，不再誤認抓錯來源。

### 5. 解決「登入狀態看錯與 Session 混淆」
- 狀態不再顯示登入時填寫的 Email（例如 `raxytw.ai@gmail.com`），而是透過 Instagram 用戶 ID 逆向解析出真實的用戶名稱（例如 `@raxytw.ai`）。
- **Session 自動回退偵測**：若插件自身目錄下的 `data/ig_session.json` 為空檔（2 bytes `{}`），後端會自動回退探測並載入 `dsh-instagram-mcp/vendor/instagram-mcp/data/ig_session.json` 中的有效憑證，兩份路徑無縫相容。

---

## 唯讀瀏覽與探索 API (純讀不發文)

### 1. 讀取指定創作者貼文 (User Posts)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/user?username=wired&limit=5"
```
**回傳格式：**
```json
{
  "ok": true,
  "username": "wired",
  "count": 5,
  "user_meta": {
    "username": "wired",
    "full_name": "WIRED",
    "is_verified": true,
    "is_private": false,
    "media_count": 5420,
    "follower_count": 1840000,
    "following_count": 320,
    "biography": "What's next..."
  },
  "posts": [
    {
      "id": "3589...",
      "code": "DD...",
      "author": "wired",
      "caption": "...",
      "media_type": 1,
      "is_video": false,
      "is_reel": false,
      "is_collaborative": false,
      "coauthors": [],
      "like_count": 1250,
      "comment_count": 45,
      "url": "https://www.instagram.com/p/DD.../"
    }
  ]
}
```

### 2. 刷 Reels 連續短片 (Reels Feed)
- **探索熱門推薦 Reels**：
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/reels?limit=6"
  ```
- **指定創作者的 Reels**：
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/reels?username=wired&limit=6"
  ```

### 3. 首頁動態探索 (Explore Timeline)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/explore?limit=6"
```

### 4. 搜尋用戶與標籤 (Search)
- **搜尋使用者**：
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/search?q=verge&type=users"
  ```
- **搜尋主題標籤**：
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/search?q=technology&type=tags"
  ```

---

## 業務與自動化 API

### 1. 檢查目前狀態與登入帳號
```bash
curl http://127.0.0.1:3080/api/instagram/status
```
重點欄位：
- `loginStatus.ok`: 是否已登入
- `loginStatus.username`: 當前登入的真實 Instagram Handle（如 `raxytw.ai`）
- `loginStatus.message`: 登入狀態說明與憑證來源
- `sessionPath`: 當前生效的 Session 檔案實體路徑

### 2. 驗證 Session 或登入帳號
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"你的帳號\",\"password\":\"你的密碼\"}"
```

### 3. 立即手動執行一輪自動化循環 (注意：會執行留言與推坑)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/run \
  -H "Content-Type: application/json" \
  -d "{}"
```
*提示：若僅需「瀏覽貼文／短片」，請使用上方 `/api/instagram/browse/*` 端點，不要使用 `/run`。*

---

## 插件工具清單 (向 DSH 註冊之 Tool)

| 工具名稱 | 類型 | 說明 | 關鍵參數 |
| :--- | :--- | :--- | :--- |
| `ig_browse_user_posts` | **唯讀** | 讀取指定創作者的最新貼文，包含個人檔案與聯名作者解析 | `username` (必填), `limit` |
| `ig_browse_reels` | **唯讀** | 刷 Reels 短片（可指定創作者或探索推薦） | `username` (可選), `limit` |
| `ig_browse_timeline` | **唯讀** | 讀取首頁動態探索貼文流 | `limit` |
| `ig_search_users` | **唯讀** | 搜尋 Instagram 使用者（回傳粉絲數、認證標章） | `query` (必填), `limit` |
| `ig_search_tags` | **唯讀** | 搜尋 Instagram 標籤（回傳公開貼文總量） | `query` (必填), `limit` |
| `ig_check_status` | 資訊 | 取得外掛程式連線狀態、登入用戶名與配額 | 無 |
| `ig_login` | 認證 | 驗證既有 Session 或重新以帳密登入 | `username`, `password`, `two_factor_code` |
| `ig_search_hashtag` | 查詢 | 查詢指定標籤最新貼文（官方 API 受限時回傳診斷提示） | `hashtag` (必填), `limit` |
| `ig_get_post_context` | 唯讀 | 取得特定貼文之全文與留言清單 | `media_pk` (必填), `comment_limit` |
| `ig_manual_patrol` | 寫入 | 立即執行標籤巡查（若達門檻將發表推薦留言） | `hashtag` (可選) |
| `ig_manual_reply_post` | 寫入 | 對指定貼文發表新留言或回覆特定留言 | `media_pk`, `text`, `reply_to_comment_pk` |
| `ig_manual_send_dm` | 寫入 | 對私訊對話發送訊息 | `thread_id`, `text` |
| `ig_run_duties_now` | 寫入 | 巡查、提及回覆、私訊各執行一輪 | 無 |

---

## Web 前端控制面板 (`client.js`)

前端面板遵循 `.agents/skills/design-taste-frontend` 規範，提供六大專屬分頁：
1. **帳號與認證**：顯示真實已登入的 `@handle` 與 Session 狀態，管理登入參數。
2. **瀏覽與探索 (全新推出)**：
   - **連續短片 (Reels)**：刷短片封面、播放連結與發布資訊。
   - **創作者主頁貼文**：輸入帳號（如 `wired`, `verge`），完整呈現個人 Bio、粉絲數、公開貼文卡片與聯名合作標記。
   - **首頁動態探索**：一鍵瀏覽探索動態。
   - **搜尋 用戶/標籤**：搜尋創作者並可一鍵跳轉瀏覽其主頁。
3. **標籤巡查推坑**：設定巡查主題標籤、LLM 人設 Prompt、推薦推坑模板。
4. **提及應答**：設定 @機器人 提問的自動回答策略與黑白名單。
5. **私訊互動**：代回 Instagram 未讀私訊。
6. **運行與統計**：每日額度進度條（KPI Cards，支援 `tabular-nums`）與手動觸發。

---

## 常見排查與問答

### Q1：為什麼查詢 `theverge` 貼文數是 0，而 `wired` 正常？
- **解答**：`theverge` 在 Instagram 上是一個沒有任何貼文的空帳號（佔位號），其 `media_count` 為 0。知名科技媒體 The Verge 的真實官方 Instagram 帳號名是 **`verge`**（擁有 6,400+ 篇貼文）。在新版外掛程式中，查詢時頂部名片會即時顯示該帳號的真實貼文總數，並提出診斷提醒。

### Q2：為什麼在 `techcrunch` 的結果中，作者卻顯示為 `@dominicmadori`？
- **解答**：這是 Instagram 官方的「聯名發布 (Collaborative Posts)」機制。此貼文由 TechCrunch 與作者 Dominic Madori 共同發布，Instagram 官方 API 會將主要作者設為 `dominicmadori`，並在 `coauthor_producers` 中列出 `techcrunch`。新版程式已解析此欄位，卡片上會明確以 `[聯名發布] @dominicmadori × @techcrunch` 呈現，不會再造成混淆。

### Q3：為什麼標籤搜尋 `#technology` 一直抓不到貼文？
- **解答**：Instagram 近期大幅收緊公開 Hashtag 的 API 存取權限。非商業驗證節點直接查詢標籤端點多半會被 Instagram 限制並回傳空資料。建議改用「創作者主頁 (User Posts)」直接訂閱知名媒體或帳號，或是透過「連續短片 (Reels)」獲取最新熱門短片。

---

## 更新與安裝

在專案根目錄執行專屬更新腳本：
```powershell
powershell -ExecutionPolicy Bypass -File .\Updata_Plugin_Instagram.ps1
```
腳本將自動完成 `dsh-instagram-mcp` 與 `dsh-instagram-plugin` 的 TypeScript 編譯，並自動建立符號連結至 DSH 執行環境中。
