# DSH Instagram 業務插件 (`@luoyi-dsh/instagram-plugin`)

<div align="center">

![DSH Instagram Plugin Banner](banner.png)

**[English](../README.md) | [繁體中文](zh-Hant.md)**

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

### 2. 刷 Reels 連續短片 (Reels Feed)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/reels?limit=6"
```

### 3. 首頁動態探索 (Explore Timeline)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/explore?limit=6"
```

### 4. 搜尋用戶與標籤 (Search)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/search?q=verge&type=users"
```

---

## 業務與自動化 API

### 1. 檢查目前狀態與登入帳號
```bash
curl http://127.0.0.1:3080/api/instagram/status
```

### 2. 檢查與同步繼承的 MCP Session 狀態
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/login \
  -H "Content-Type: application/json" \
  -d "{}"
```

### 3. 立即手動執行一輪自動化循環
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

## 📜 版本發布紀錄 (Releases)

詳細版本演進與更新紀錄，請參閱 [CHANGELOG.md](../CHANGELOG.md)。

---

## 📄 授權條款

本專案採用 [MIT License](../LICENSE) 開源授權。
