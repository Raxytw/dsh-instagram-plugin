# DSH Instagram 業務插件 (`@luoyi-dsh/instagram-plugin`)

<div align="center">

![DSH Instagram Plugin Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md)**

</div>

> 依賴 `@luoyi-dsh/instagram-mcp` 的 FastMCP 連線與登入憑證。這個插件負責兩大核心能力：  
> 1. **安全唯讀瀏覽與探索 (Read-Only Browsing)**：刷指定創作者貼文、刷 Reels 短片、探索首頁動態、搜尋用戶與標籤（不按讚、不發文、不留痕跡）。  
> 2. **自動化社群互動助理 (Automation Duties)**：標籤巡查推坑、貼文 @提及應答、代回未讀私訊。  
> 
> 完全繼承底層 MCP Session，無須重複設定帳密。Web 設定與瀏覽介面位於 DSH 的 `client.js`。

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
- `loginStatus.username`: 當前登入的真實 Instagram Handle
- `loginStatus.message`: 登入狀態說明與憑證來源
- `inheritedSession`: 是否完全繼承自 MCP Session

### 2. 檢查與同步繼承的 MCP Session 狀態
```bash
# 說明：本外掛無須輸入帳密，帳號密碼由 @luoyi-dsh/instagram-mcp 集中管理
curl -X POST http://127.0.0.1:3080/api/instagram/login \
  -H "Content-Type: application/json" \
  -d "{}"
```

### 3. 立即手動執行一輪自動化循環 (注意：會執行留言與推坑)
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/run \
  -H "Content-Type: application/json" \
  -d "{}"
```

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
| `ig_search_hashtag` | 查詢 | 查詢指定標籤最新貼文（官方 API 受限時回傳診斷提示） | `hashtag` (必填), `limit` |
| `ig_get_post_context` | 唯讀 | 取得特定貼文之全文與留言清單 | `media_pk` (必填), `comment_limit` |
| `ig_manual_patrol` | 寫入 | 立即執行標籤巡查（若達門檻將發表推薦留言） | `hashtag` (可選) |
| `ig_manual_reply_post` | 寫入 | 對指定貼文發表新留言或回覆特定留言 | `media_pk`, `text`, `reply_to_comment_pk` |
| `ig_manual_send_dm` | 寫入 | 對私訊對話發送訊息 | `thread_id`, `text` |
| `ig_run_duties_now` | 寫入 | 巡查、提及回覆、私訊各執行一輪 | 無 |

---

## Web 前端控制面板 (`client.js`)

前端面板提供六大專屬分頁：
1. **身分與 MCP 會話**：顯示繼承自 `@luoyi-dsh/instagram-mcp` 的 Session 狀態與已登入帳號 Handle，設定推坑目標用戶與機器人名稱。
2. **瀏覽與探索**：
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
- **解答**：`theverge` 在 Instagram 上是一個沒有任何貼文的空帳號（佔位號），其 `media_count` 為 0。知名科技媒體 The Verge 的真實官方 Instagram 帳號名是 **`verge`**（擁有 6,400+ 篇貼文）。

### Q2：為什麼在 `techcrunch` 的結果中，作者卻顯示為 `@dominicmadori`？
- **解答**：這是 Instagram 官方的「聯名發布 (Collaborative Posts)」機制。此貼文由 TechCrunch 與作者 Dominic Madori 共同發布，卡片上會明確以 `[聯名發布] @dominicmadori × @techcrunch` 呈現。

---

## 資料目錄與動態持久化架構

```text
dsh-instagram-plugin/
├── client.js              # 前端 Web UI 控制面板
├── cordis.patch.yml       # DSH Cordis 插件聲明
├── package.json           # 模組定義與依賴宣告
├── tsconfig.json          # TypeScript 編譯設定
├── CHANGELOG.md           # 版本更新紀錄
├── README.md              # 英文說明文件
├── README.zh-Hant.md      # 繁體中文說明文件
├── assets/
│   ├── banner.png         # 專案橫幅圖示
│   └── zh-Hant.md         # 本地化說明文件
├── src/                   # TypeScript 源代碼
└── data/                  # 【執行期動態建立，不進 Git / NPM】
    ├── config.json        # 外掛持久化配置（自動根據默認值產生）
    └── ledger.json        # 狀態去重與每日配額帳本（自動初始化）
```

- **安裝方式**：
  ```bash
  dsh plugin --profile web add @luoyi-dsh/instagram-plugin
  # 或
  npm install @luoyi-dsh/instagram-plugin
  ```

---

## 📜 版本發布紀錄 (Releases)

詳細版本演進與更新紀錄，請參閱 [CHANGELOG.md](CHANGELOG.md)。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 開源授權。
