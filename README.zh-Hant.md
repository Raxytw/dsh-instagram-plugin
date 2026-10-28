# DSH Instagram 業務與智慧互動插件 (`@luoyi-dsh/instagram-plugin`)

<div align="center">

![DSH Instagram Plugin Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md) | [操作方法與 Agent 指南](AGENTS.md)**

</div>

> 依賴 `@luoyi-dsh/instagram-mcp` 的 FastMCP 連線與集中式帳號設定（自動繼承機器人帳號與主人帳號）。本插件負責兩大核心能力：  
> 1. **安全唯讀瀏覽與探索 (Read-Only Browsing)**：刷指定創作者貼文、刷 Reels 短片、探索首頁動態、搜尋用戶與標籤（不按讚、不發文、不留痕跡）。  
> 2. **AI 驅動自動化社群助理 (Automation Duties)**：模糊關鍵字巡查推坑、讀取貼文/Reel 實際內容的 `@提及應答 (RM)`、以及智慧代回未讀私訊 (`DM`)，全面支援讀取外部訂閱插件 (`dsh-plugin-subscriptions`) 額度。

> [!CAUTION]
> ### ⚠️ 重要風險警告與免責聲明 (CRITICAL DISCLAIMER)
> 1. **違反 Instagram 社群守則與使用條款**：本插件採用非官方 API 進行自動化操作，明確違反 Instagram / Meta 的服務條款與社群守則。
> 2. **切勿使用本人主要帳號運行**：嚴禁使用個人日常主要帳號或重要商業帳號！請務必使用測試小號並搭配純淨住宅代理。
> 3. **免責宣告**：本專案純屬技術研究用途，任何帳號停權或損失由使用者自負風險。

---

## 🌟 核心特色

1. **自動沿用 MCP 帳號設定**：
   - 自動同步 `@luoyi-dsh/instagram-mcp` 設定的機器人帳號与主人帳號，無須重複填寫。
2. **支援外部插件訂閱額度與多元 AI 推理 (`src/lib/llm.ts`)**：
   - 參照 `@luoyi-dsh/discord-plugin` 架構，支援直接讀取 `dsh-plugin-subscriptions` 授權之平台額度（Google Antigravity、OpenAI Codex、xAI Grok、GitHub Copilot）與自訂 API，並具備 402 餘額不足自動切換備援。
3. **貼文與 Reel 真實內容感知應答 (RM 防瞎答機制)**：
   - 回覆留言區 `@提及` 時，自動抓取被 `@` 的那則貼文或 Reel 的完整內文、標題、無障礙視覺描述、配樂資訊、影片字幕、多模態視覺封面與樓中樓上下文，嚴格依據貼文真實內容回答，絕不瞎編或使用罐頭訊息。
4. **嚴格過濾 AI 生成內容 (AIGC Filter)**：
   - 搜尋與巡查自動攔截並排除 AI 生成影片、AI 動畫、AI 繪圖與 AI 農場文章。
5. **內建防風控安全護欄**：
   - 具備單輪上限、每小時/每日配額、擬真隨機等待 (Jitter) 與 30 分鐘異常熔斷冷卻保護。

---

## 🚀 安裝方式

```bash
# 透過 DSH CLI 安裝
dsh plugin --profile web add @luoyi-dsh/instagram-plugin

# 或透過 npm 安裝
npm install @luoyi-dsh/instagram-plugin
```

---

## 📖 插件操作方法與工具調用說明

完整的 DSH 工具清單、唯讀瀏覽與自動化 REST API、模型調用設定與操作範例，請參閱 **[AGENTS.md](AGENTS.md)**。

---

## 📁 目錄結構

```text
dsh-instagram-plugin/
├── client.js              # 前端 Web UI 控制面板
├── cordis.patch.yml       # DSH Cordis 插件聲明
├── package.json           # 模組定義與依賴宣告
├── tsconfig.json          # TypeScript 編譯設定
├── AGENTS.md              # 插件操作方法與 Agent 調用指南
├── CHANGELOG.md           # 版本更新紀錄
├── README.md              # 英文介紹文件
├── README.zh-Hant.md      # 繁體中文介紹文件 (本檔案)
└── src/                   # TypeScript 核心源代碼 (LLM 引擎、巡查、RM 提及應答、DM 私訊回覆)
```

---

## 📜 版本紀錄與授權條款

- 詳細版本演進與更新紀錄，請參閱 [CHANGELOG.md](CHANGELOG.md)。
- 本專案採用 [MIT License](LICENSE) 開源授權。
