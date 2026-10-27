/**
 * client.js —— DSH Web 瀏覽器端設定介面 (Instagram 社群助理專用面板)
 * ============================================================================
 * 設計規範遵循:
 *  - .agents/skills/design-taste-frontend
 *  - references/app-screens.md (Forms & Settings, KPIs, Quiet Surfaces)
 * 特點:
 *  - 平坦表面與 1px 細緻靜音邊框，無廉價 Emoji / 無多餘漸層 / 無磨砂玻璃雜訊
 *  - 嚴謹的雙欄表單網格，高資訊密度，字元/數字啟用 tabular-nums
 *  - 語意狀態指示（在線 Emerald / 警告 Amber / 離線 Slate）
 *  - 註冊至 DSH 擴展槽: settings.section, settings.plugins.tab, plugins.item
 * ============================================================================
 */

window.__ModuleLoader__.load({
  id: '@luoyi-dsh/instagram-plugin',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const API = '/api/instagram'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`)
    }

    const jget = async (path) => asJson(await fetch(API + path, { credentials: 'same-origin' }))
    const jpost = async (path, body) =>
      asJson(
        await fetch(API + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        })
      )

    // 精美專業向量圖標集合（取代 emoji，符合 anti-slop 規範）
    const Icon = {
      Instagram: ({ size = 18 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('rect', { x: 2, y: 2, width: 20, height: 20, rx: 5, ry: 5 }),
          h('path', { d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z' }),
          h('line', { x1: 17.5, y1: 6.5, x2: 17.51, y2: 6.5 })
        ),
      Shield: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' })
        ),
      Tag: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', {
            d: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z',
          }),
          h('line', { x1: 7, y1: 7, x2: 7.01, y2: 7 })
        ),
      MessageSquare: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
        ),
      Mail: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', {
            d: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z',
          }),
          h('polyline', { points: '22,6 12,13 2,6' })
        ),
      Activity: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })
        ),
      Refresh: ({ size = 14 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('polyline', { points: '23 4 23 10 17 10' }),
          h('polyline', { points: '1 20 1 14 7 14' }),
          h('path', {
            d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
          })
        ),
      Play: ({ size = 13 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            stroke: 'currentColor',
            strokeWidth: 1,
          },
          h('polygon', { points: '5 3 19 12 5 21 5 3' })
        ),
      Save: ({ size = 14 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', {
            d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z',
          }),
          h('polyline', { points: '17 21 17 13 7 13 7 21' }),
          h('polyline', { points: '7 3 7 8 15 8' })
        ),
      Check: ({ size = 14 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('polyline', { points: '20 6 9 17 4 12' })
        ),
      Info: ({ size = 14 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('circle', { cx: 12, cy: 12, r: 10 }),
          h('line', { x1: 12, y1: 16, x2: 12, y2: 12 }),
          h('line', { x1: 12, y1: 8, x2: 12.01, y2: 8 })
        ),
      Compass: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('circle', { cx: 12, cy: 12, r: 10 }),
          h('polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' })
        ),
      Film: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('rect', { x: 2, y: 2, width: 20, height: 20, rx: 2.18, ry: 2.18 }),
          h('line', { x1: 7, y1: 2, x2: 7, y2: 22 }),
          h('line', { x1: 17, y1: 2, x2: 17, y2: 22 }),
          h('line', { x1: 2, y1: 12, x2: 22, y2: 12 }),
          h('line', { x1: 2, y1: 7, x2: 7, y2: 7 }),
          h('line', { x1: 2, y1: 17, x2: 7, y2: 17 }),
          h('line', { x1: 17, y1: 17, x2: 22, y2: 17 }),
          h('line', { x1: 17, y1: 7, x2: 22, y2: 7 })
        ),
      Search: ({ size = 15 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('circle', { cx: 11, cy: 11, r: 8 }),
          h('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
        ),
      ExternalLink: ({ size = 13 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
          h('polyline', { points: '15 3 21 3 21 9' }),
          h('line', { x1: 10, y1: 14, x2: 21, y2: 3 })
        ),
      Heart: ({ size = 13 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', {
            d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
          })
        ),
      MessageCircle: ({ size = 13 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', {
            d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
          })
        ),
      User: ({ size = 14 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
          h('circle', { cx: 12, cy: 7, r: 4 })
        ),
      Users: ({ size = 14 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
          h('circle', { cx: 9, cy: 7, r: 4 }),
          h('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
          h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })
        ),
    }

    const CSS = `
/* ==========================================================================
   Instagram Plugin Settings — Design-Taste-Frontend Architecture
   ========================================================================== */
.ig-root {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 760px;
  padding: 6px 4px 40px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--dsw-alias-label-primary, #f1f5f9);
  line-height: 1.5;
  box-sizing: border-box;
}

/* 頂部標頭列 (Header Shell) */
.ig-header-shell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
.ig-brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ig-brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #181b22;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f43f5e;
}
.ig-brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.ig-brand-sub {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  margin-top: 1px;
}

/* 狀態徽章 (Quiet Status Signal) */
.ig-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.ig-status-badge.connected {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
.ig-status-badge.disconnected {
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
  border-color: rgba(148, 163, 184, 0.2);
}
.ig-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* 分頁導航列 (Quiet Underline/Segmented Tabs) */
.ig-tabs-rail {
  display: flex;
  gap: 2px;
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.025));
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.07));
  border-radius: 8px;
  padding: 3px;
  overflow-x: auto;
}
.ig-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease-in-out;
}
.ig-tab-item:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.04);
}
.ig-tab-item.active {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 訊息通知條 (Subtle Notice Banner) */
.ig-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.45;
  border-left: 3px solid;
}
.ig-banner.good {
  background: rgba(16, 185, 129, 0.08);
  color: #34d399;
  border-left-color: #10b981;
}
.ig-banner.warn {
  background: rgba(245, 158, 11, 0.08);
  color: #fbbf24;
  border-left-color: #f59e0b;
}

/* 設定卡片容器 (Flat Panel, 1px Quiet Border) */
.ig-panel {
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ig-section-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.05));
  padding-bottom: 12px;
}
.ig-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}
.ig-section-desc {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #94a3b8);
}

/* 表單雙欄與控制項 */
.ig-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.ig-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ig-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #cbd5e1);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ig-field-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #64748b);
  line-height: 1.4;
  margin-top: 2px;
}
.ig-input-text {
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: var(--dsw-alias-bg-layer-4, rgba(0, 0, 0, 0.25));
  color: #f1f5f9;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ig-input-text:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px #3b82f6;
}
.ig-input-number {
  font-variant-numeric: tabular-nums;
}
.ig-textarea-input {
  width: 100%;
  min-height: 72px;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: var(--dsw-alias-bg-layer-4, rgba(0, 0, 0, 0.25));
  color: #f1f5f9;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
  transition: border-color 0.15s;
}
.ig-textarea-input:focus {
  outline: none;
  border-color: #3b82f6;
}

/* 開關列 (Switch Row) */
.ig-switch-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.05));
  border-radius: 8px;
}
.ig-switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ig-switch-name {
  font-size: 13px;
  font-weight: 500;
  color: #f1f5f9;
}
.ig-switch-sub {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #94a3b8);
}
.ig-toggle-btn {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
  border: 0;
  padding: 0;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.ig-toggle-btn.on {
  background: #10b981;
}
.ig-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  transition: left 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.ig-toggle-btn.on .ig-toggle-thumb {
  left: 18px;
}

/* 按鈕樣式 (Buttons) */
.ig-btn-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ig-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 34px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.05);
  color: #f1f5f9;
  transition: all 0.15s ease;
}
.ig-button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}
.ig-button.primary {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
  font-weight: 600;
}
.ig-button.primary:hover {
  background: #1d4ed8;
}
.ig-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 數據指標卡片 (KPI Metrics, Quiet Figures) */
.ig-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.ig-kpi-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ig-kpi-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #94a3b8);
}
.ig-kpi-number {
  font-size: 22px;
  font-weight: 600;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.ig-kpi-denom {
  font-size: 12px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary, #64748b);
}
.ig-progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}
.ig-progress-fill {
  height: 100%;
  background: #3b82f6;
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* 底部動作列 (Fixed Action Bar) */
.ig-footer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
.ig-footer-hint {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #64748b);
}

/* ==========================================================================
   瀏覽與探索 (Browse & Reels) 專用樣式
   ========================================================================== */
.ig-browse-subnav {
  display: flex;
  gap: 6px;
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.07));
  border-radius: 8px;
  padding: 4px;
}
.ig-browse-subbtn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: 0;
  cursor: pointer;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  transition: all 0.15s ease;
}
.ig-browse-subbtn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.04);
}
.ig-browse-subbtn.active {
  background: rgba(255, 255, 255, 0.09);
  color: #ffffff;
  font-weight: 600;
}

.ig-browse-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
  padding: 10px 14px;
}
.ig-browse-input-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
}
.ig-browse-input-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #64748b;
  pointer-events: none;
}
.ig-browse-input {
  width: 100%;
  height: 34px;
  box-sizing: border-box;
  padding: 0 10px 0 32px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: var(--dsw-alias-bg-layer-4, rgba(0, 0, 0, 0.3));
  color: #f1f5f9;
  font-family: inherit;
  transition: border-color 0.15s;
}
.ig-browse-input:focus {
  outline: none;
  border-color: #3b82f6;
}
.ig-browse-select {
  height: 34px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: var(--dsw-alias-bg-layer-4, rgba(0, 0, 0, 0.3));
  color: #f1f5f9;
  font-family: inherit;
  cursor: pointer;
}

/* 個人檔案名片 (User Profile Card) */
.ig-profile-card {
  display: flex;
  gap: 16px;
  padding: 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.07));
}
.ig-profile-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #1e222d;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  color: #94a3b8;
}
.ig-profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ig-profile-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.ig-profile-header-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ig-profile-handle {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
}
.ig-profile-name {
  font-size: 13px;
  color: #94a3b8;
}
.ig-badge-verified {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}
.ig-badge-private {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}
.ig-profile-stats {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: #94a3b8;
  margin: 2px 0;
}
.ig-profile-stats span strong {
  color: #ffffff;
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
}
.ig-profile-bio {
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.45;
  white-space: pre-line;
}

/* 貼文 / Reel 卡片網格 */
.ig-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.ig-media-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.07));
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.ig-media-card:hover {
  border-color: rgba(255, 255, 255, 0.16);
  transform: translateY(-1px);
}
.ig-media-thumb-box {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #0f1218;
  overflow: hidden;
}
.ig-media-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ig-media-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  background: #11141c;
}
.ig-media-type-pill {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #ffffff;
  backdrop-filter: blur(4px);
}
.ig-collab-pill {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(20, 24, 33, 0.88);
  color: #cbd5e1;
  border: 1px solid rgba(255, 255, 255, 0.12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ig-collab-pill strong {
  color: #38bdf8;
}
.ig-media-content {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.ig-media-author {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: #f1f5f9;
}
.ig-media-author a {
  color: inherit;
  text-decoration: none;
}
.ig-media-author a:hover {
  color: #38bdf8;
}
.ig-media-caption {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 3.8em;
}
.ig-media-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 11px;
  color: #64748b;
  margin-top: auto;
}
.ig-media-counts {
  display: flex;
  align-items: center;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.ig-media-count-item {
  display: flex;
  align-items: center;
  gap: 3px;
}
.ig-media-ext-link {
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  transition: color 0.15s;
}
.ig-media-ext-link:hover {
  color: #ffffff;
}

/* 搜尋結果列表 */
.ig-search-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.ig-search-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
}
.ig-search-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
.ig-search-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #181c25;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  color: #64748b;
}
.ig-search-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ig-search-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  flex: 1;
}
.ig-search-title {
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ig-search-subtitle {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ig-search-count {
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

/* 專業空狀態與診斷區塊 */
.ig-empty-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px dashed var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  gap: 10px;
}
.ig-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: #cbd5e1;
}
.ig-empty-desc {
  font-size: 12px;
  color: #64748b;
  max-width: 480px;
  line-height: 1.5;
}
`

    // 嚴格型別校正與防污染解包器 (徹底根除 [object Object] 顯示與資料傳遞)
    const cleanStr = (v, fallback = '') => {
      if (typeof v === 'string') {
        return v === '[object Object]' ? fallback : v
      }
      return fallback
    }

    const cleanNum = (v, fallback = 0) => {
      if (typeof v === 'number' && !isNaN(v)) return v
      if (typeof v === 'string') {
        const n = Number(v)
        if (!isNaN(n)) return n
      }
      return fallback
    }

    const cleanArr = (v, fallback = []) => (Array.isArray(v) ? v : fallback)
    const cleanBool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback)

    const normalizeConfig = (raw) => {
      const c = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
      return {
        botUsername: cleanStr(c.botUsername, ''),
        targetMentionUser: cleanStr(c.targetMentionUser, ''),

        patrolEnabled: cleanBool(c.patrolEnabled, true),
        patrolIntervalMinutes: cleanNum(c.patrolIntervalMinutes, 15),
        hashtags: cleanArr(c.hashtags, ['ai', 'deepseek', 'coding', 'tech']),
        patrolSearchLimit: cleanNum(c.patrolSearchLimit, 10),
        minLikes: cleanNum(c.minLikes, 20),
        minComments: cleanNum(c.minComments, 2),
        excludeKeywords: cleanArr(c.excludeKeywords, ['廣告', '互粉', '代購', '抽獎', '博彩', '色情', '兼職']),
        requireKeywords: cleanArr(c.requireKeywords, []),
        maxDailyPatrolComments: cleanNum(c.maxDailyPatrolComments, 10),
        patrolPersonaPrompt: cleanStr(c.patrolPersonaPrompt, '你是一個熱情、專業且具備敏銳眼光的科技社群助手。評估這則貼文是否具有實質技術或應用價值，若值得推薦，請用簡短吸引人的語氣向目標用戶推薦推坑。'),
        recommendTemplate: cleanStr(c.recommendTemplate, '@{targetUser} 這篇關於 #{hashtag} 的內容很值得一看：{summary}'),

        mentionReplyEnabled: cleanBool(c.mentionReplyEnabled, true),
        mentionIntervalMinutes: cleanNum(c.mentionIntervalMinutes, 5),
        maxContextComments: cleanNum(c.maxContextComments, 10),
        roundCapPerPost: cleanNum(c.roundCapPerPost, 3),
        maxDailyMentionReplies: cleanNum(c.maxDailyMentionReplies, 20),
        whitelistUsers: cleanArr(c.whitelistUsers, []),
        blacklistUsers: cleanArr(c.blacklistUsers, []),
        mentionPersonaPrompt: cleanStr(c.mentionPersonaPrompt, '你是一個聰慧、客氣且具備深度技術理解的 AI 助理。請結合貼文的完整上下文（發布者、內文、相鄰留言）認真回答用戶的提問，語氣自然友善，回答精簡聚焦。'),

        dmReplyEnabled: cleanBool(c.dmReplyEnabled, true),
        dmIntervalMinutes: cleanNum(c.dmIntervalMinutes, 3),
        dmWhitelistOnly: cleanBool(c.dmWhitelistOnly, false),
        dmWhitelist: cleanArr(c.dmWhitelist, []),
        dmMaxPerUserPerDay: cleanNum(c.dmMaxPerUserPerDay, 5),
        dmDailyCap: cleanNum(c.dmDailyCap, 30),
        dmPersonaPrompt: cleanStr(c.dmPersonaPrompt, '你是一個禮貌、溫暖的社群助理。這是一則私訊互動，請用簡潔自然的口吻給予用戶解答或致謝。'),

        jitterMinSeconds: cleanNum(c.jitterMinSeconds, 3),
        jitterMaxSeconds: cleanNum(c.jitterMaxSeconds, 6),
        pythonPath: cleanStr(c.pythonPath, ''),
      }
    }

    function Panel() {
      const [tab, setTab] = useState('auth')
      const [cfg, setCfg] = useState(normalizeConfig({}))
      const [status, setStatus] = useState(null)
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [testingLogin, setTestingLogin] = useState(false)
      const [runningDuty, setRunningDuty] = useState(false)
      const [msg, setMsg] = useState(null)

      // 瀏覽與探索狀態
      const [browseSubtab, setBrowseSubtab] = useState('reels') // 'reels' | 'user' | 'explore' | 'search'
      const [browseUser, setBrowseUser] = useState('wired')
      const [browseQuery, setBrowseQuery] = useState('tech')
      const [browseSearchType, setBrowseSearchType] = useState('users') // 'users' | 'tags'
      const [browseLimit, setBrowseLimit] = useState(6)
      const [browseItems, setBrowseItems] = useState([])
      const [browseUserMeta, setBrowseUserMeta] = useState(null)
      const [browseLoading, setBrowseLoading] = useState(false)
      const [browseNotice, setBrowseNotice] = useState(null)
      const [browseDiagnosis, setBrowseDiagnosis] = useState(null)

      const fetchBrowse = async (mode) => {
        const targetMode = mode || browseSubtab
        setBrowseLoading(true)
        setBrowseNotice(null)
        setBrowseDiagnosis(null)
        try {
          if (targetMode === 'reels') {
            const u = browseUser.trim().replace(/^@/, '')
            const url = `/browse/reels?limit=${browseLimit}${u ? `&username=${encodeURIComponent(u)}` : ''}`
            const res = await jget(url)
            if (res?.ok) {
              setBrowseItems(res.reels || [])
              setBrowseUserMeta(res.user_meta || null)
              if (res.user_meta?.media_count === 0) {
                setBrowseDiagnosis('該帳號媒體總數為 0，可能為無貼文之新帳號或佔位號。')
              } else if ((res.reels || []).length === 0) {
                setBrowseDiagnosis('未檢索到 Reels 連續短片。若帳號設為私人或該帳號未發布過短片，將回傳空列表。')
              }
            } else {
              setBrowseNotice({ text: `取得 Reels 失敗: ${res?.error || '未知錯誤'}`, type: 'warn' })
            }
          } else if (targetMode === 'user') {
            const u = browseUser.trim().replace(/^@/, '')
            if (!u) {
              setBrowseNotice({ text: '請輸入要瀏覽的 Instagram 用戶名', type: 'warn' })
              setBrowseLoading(false)
              return
            }
            const res = await jget(`/browse/user?username=${encodeURIComponent(u)}&limit=${browseLimit}`)
            if (res?.ok) {
              setBrowseItems(res.posts || [])
              setBrowseUserMeta(res.user_meta || null)
              if (res.user_meta?.media_count === 0) {
                setBrowseDiagnosis(`帳號 @${u} 的公開貼文計數為 0（例如：theverge 是無貼文的空帳號，科技媒體 The Verge 的真實官方帳號是 @verge）。`)
              } else if (res.user_meta?.is_private) {
                setBrowseDiagnosis(`帳號 @${u} 為私人隱私帳號，非追蹤者無法取得公開貼文。`)
              }
            } else {
              setBrowseNotice({ text: `取得貼文失敗: ${res?.error || '請確認用戶名或登入 Session'}`, type: 'warn' })
            }
          } else if (targetMode === 'explore') {
            const res = await jget(`/browse/explore?limit=${browseLimit}`)
            if (res?.ok) {
              setBrowseItems(res.posts || [])
              setBrowseUserMeta(null)
            } else {
              setBrowseNotice({ text: `取得首頁探索動態失敗: ${res?.error || '請確認登入 Session'}`, type: 'warn' })
            }
          } else if (targetMode === 'search') {
            const q = browseQuery.trim().replace(/^#/, '')
            if (!q) {
              setBrowseNotice({ text: '請輸入搜尋關鍵字', type: 'warn' })
              setBrowseLoading(false)
              return
            }
            const res = await jget(`/browse/search?q=${encodeURIComponent(q)}&type=${browseSearchType}`)
            if (res?.ok) {
              setBrowseItems(res.results || [])
              setBrowseUserMeta(null)
              if ((res.results || []).length === 0) {
                setBrowseDiagnosis(`未找到與「${q}」相符的${browseSearchType === 'users' ? '用戶' : '主題標籤'}。`)
              }
            } else {
              setBrowseNotice({ text: `搜尋失敗: ${res?.error || '未知錯誤'}`, type: 'warn' })
            }
          }
        } catch (e) {
          setBrowseNotice({ text: `請求異常: ${e.message}`, type: 'warn' })
        } finally {
          setBrowseLoading(false)
        }
      }

      const refreshData = async () => {
        try {
          const [cfgRes, statusRes] = await Promise.all([
            jget('/config'),
            jget('/status'),
          ])
          if (cfgRes?.ok) setCfg(normalizeConfig(cfgRes.config))
          if (statusRes?.ok) setStatus(statusRes)
        } catch (e) {
          setMsg({ text: `讀取狀態失敗: ${e.message}`, type: 'warn' })
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => {
        refreshData()
      }, [])

      const updateField = (key, val) => {
        setCfg((prev) => ({ ...prev, [key]: val }))
      }

      const saveSettings = async () => {
        setSaving(true)
        setMsg(null)
        try {
          const cleanPayload = normalizeConfig(cfg)
          const res = await jpost('/config', cleanPayload)
          if (res?.ok) {
            setCfg(normalizeConfig(res.config))
            setMsg({ text: '設定已成功儲存並同步至後端。', type: 'good' })
          } else {
            setMsg({ text: `儲存失敗: ${res?.error || '未知原因'}`, type: 'warn' })
          }
        } catch (e) {
          setMsg({ text: `儲存異常: ${e.message}`, type: 'warn' })
        } finally {
          setSaving(false)
        }
      }

      const testLoginAction = async () => {
        setTestingLogin(true)
        setMsg(null)
        try {
          const res = await jpost('/login', {})
          if (res?.ok) {
            setMsg({ text: res.loginStatus?.message || 'Instagram MCP 會話驗證成功，連線就緒。', type: 'good' })
          } else {
            setMsg({ text: `MCP 會話尚未就緒: ${res?.loginStatus?.message || '請先前往 Instagram FastMCP 設定面板完成登入'}`, type: 'warn' })
          }
          await refreshData()
        } catch (e) {
          setMsg({ text: `會話檢查異常: ${e.message}`, type: 'warn' })
        } finally {
          setTestingLogin(false)
        }
      }

      const runDutiesNowAction = async () => {
        setRunningDuty(true)
        setMsg(null)
        try {
          const res = await jpost('/run', {})
          if (res?.ok) {
            setMsg({
              text: `任務循環完成：推坑留言 ${res.patrol?.recommendedCount || 0} 則，被 @ 應答 ${res.mention?.repliedCount || 0} 則，私訊回覆 ${res.dm?.repliedCount || 0} 則。`,
              type: 'good',
            })
          }
          await refreshData()
        } catch (e) {
          setMsg({ text: `執行任務失敗: ${e.message}`, type: 'warn' })
        } finally {
          setRunningDuty(false)
        }
      }

      const isLoggedIn = Boolean(status?.loginStatus?.ok)

      if (loading) {
        return h(
          'div',
          { className: 'ig-root' },
          h('div', { style: { padding: '24px 0', color: '#94a3b8', fontSize: '13px' } }, '正在載入 Instagram 插件設定...')
        )
      }

      return h(
        'div',
        { className: 'ig-root' },

        // 頂部標頭列 (Header Shell)
        h(
          'div',
          { className: 'ig-header-shell' },
          h(
            'div',
            { className: 'ig-brand-row' },
            h('div', { className: 'ig-brand-mark' }, h(Icon.Instagram, { size: 20 })),
            h(
              'div',
              null,
              h('div', { className: 'ig-brand-title' }, 'Instagram 社群助理'),
              h('div', { className: 'ig-brand-sub' }, status?.loginStatus?.message || '等待檢查連線狀態')
            )
          ),
          h(
            'div',
            { className: `ig-status-badge ${isLoggedIn ? 'connected' : 'disconnected'}` },
            h('span', { className: 'ig-status-dot' }),
            isLoggedIn ? '連線就緒' : '未連接'
          )
        ),

        // 分頁導航列 (Tab Navigation Rail)
        h(
          'div',
          { className: 'ig-tabs-rail' },
          [
            ['auth', Icon.Shield, '身分與 MCP 會話'],
            ['browse', Icon.Compass, '瀏覽與探索'],
            ['patrol', Icon.Tag, '標籤巡查推坑'],
            ['mention', Icon.MessageSquare, '提及應答'],
            ['dm', Icon.Mail, '私訊互動'],
            ['status', Icon.Activity, '運行與統計'],
          ].map(([id, IconCmp, label]) =>
            h(
              'button',
              {
                key: id,
                className: `ig-tab-item ${tab === id ? 'active' : ''}`,
                onClick: () => setTab(id),
              },
              h(IconCmp, { size: 14 }),
              label
            )
          )
        ),

        // 提示通知條 (Notice Banner)
        msg
          ? h(
              'div',
              { className: `ig-banner ${msg.type}` },
              h(Icon.Info, { size: 15 }),
              h('span', null, msg.text)
            )
          : null,

        // ====================================================================
        // TAB 1: 身分與 MCP 會話 (Identity & MCP Session)
        // ====================================================================
        tab === 'auth'
          ? h(
              'div',
              { className: 'ig-panel' },
              h(
                'div',
                { className: 'ig-section-head' },
                h('div', { className: 'ig-section-title' }, 'Instagram MCP 會話與身分配置'),
                h(
                  'div',
                  { className: 'ig-section-desc' },
                  '本插件不用輸入帳號密碼，直接沿用依賴的 @luoyi-dsh/instagram-mcp 核心服務獲取之 Session。'
                )
              ),

              // MCP 會話繼承狀態卡片
              h(
                'div',
                {
                  style: {
                    background: isLoggedIn ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                    border: `1px solid ${isLoggedIn ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
                    borderRadius: '8px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', color: isLoggedIn ? '#34d399' : '#fbbf24' } },
                    h(Icon.Shield, { size: 16 }),
                    isLoggedIn ? '已繼承 Instagram FastMCP 核心會話' : '尚未偵測到有效的 Instagram MCP 會話'
                  ),
                  h(
                    'span',
                    {
                      className: `ig-status-badge ${isLoggedIn ? 'connected' : 'disconnected'}`,
                      style: { fontSize: '11px', padding: '2px 8px' },
                    },
                    h('span', { className: 'ig-status-dot' }),
                    isLoggedIn ? 'Session 就緒' : '等待登入'
                  )
                ),
                h(
                  'div',
                  { style: { fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 } },
                  status?.loginStatus?.message || (isLoggedIn ? '已取得有效的 Instagram 會話' : '請前往「Instagram FastMCP」設定面板輸入帳號密碼完成登入。')
                ),
                h(
                  'div',
                  { style: { fontSize: '11px', color: '#94a3b8' } },
                  '※ 帳號、密碼、2FA 驗證與 Session 持久化由 @luoyi-dsh/instagram-mcp 集中管控，各外掛直接共享底層 Client。'
                )
              ),

              // 業務身分設定
              h(
                'div',
                { className: 'ig-grid-2', style: { marginTop: '8px' } },
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '機器人自身帳號名 (Bot Username)'),
                  h('input', {
                    className: 'ig-input-text',
                    value: cleanStr(cfg.botUsername),
                    placeholder: status?.loginStatus?.username ? `@${status.loginStatus.username} (自動繼承)` : 'bot_account_name',
                    onChange: (e) => updateField('botUsername', e.target.value),
                  }),
                  h(
                    'div',
                    { className: 'ig-field-hint' },
                    status?.loginStatus?.username
                      ? `留空時自動沿用 MCP 登入帳號 (@${status.loginStatus.username})`
                      : '用於辨識貼文留言區中標註 @機器人 的提問；留空時自動沿用 MCP 帳號'
                  )
                ),
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '推坑目標用戶 (Target Mention)'),
                  h('input', {
                    className: 'ig-input-text',
                    value: cleanStr(cfg.targetMentionUser),
                    placeholder: '@your_main_account',
                    onChange: (e) => updateField('targetMentionUser', e.target.value),
                  }),
                  h('div', { className: 'ig-field-hint' }, '巡查發現精選好文時，會在留言區 @ 推薦給此目標帳號')
                )
              ),

              h(
                'div',
                { className: 'ig-btn-group', style: { marginTop: '12px' } },
                h(
                  'button',
                  {
                    className: 'ig-button primary',
                    disabled: testingLogin,
                    onClick: testLoginAction,
                  },
                  h(Icon.Refresh, { size: 13 }),
                  testingLogin ? '正在同步會話...' : '檢查 / 重新同步 MCP 會話'
                ),
                h(
                  'button',
                  {
                    className: 'ig-button',
                    onClick: refreshData,
                  },
                  h(Icon.Refresh, { size: 13 }),
                  '重新整理狀態'
                )
              )
            )
          : null,

        // ====================================================================
        // TAB 2: 瀏覽與探索 (Browse & Reels)
        // ====================================================================
        tab === 'browse'
          ? h(
              'div',
              { className: 'ig-panel' },
              h(
                'div',
                { className: 'ig-section-head' },
                h('div', { className: 'ig-section-title' }, '社群瀏覽與短影音探索 (Browse & Reels)'),
                h(
                  'div',
                  { className: 'ig-section-desc' },
                  '純唯讀模式（不按讚、不發文、不留言）。支援指定創作者貼文、連續短片 (Reels)、首頁動態探索，以及創作者與主題標籤搜尋。'
                )
              ),

              // 子導航列 (Subnav)
              h(
                'div',
                { className: 'ig-browse-subnav' },
                [
                  ['reels', Icon.Film, '連續短片 (Reels)'],
                  ['user', Icon.User, '創作者主頁貼文'],
                  ['explore', Icon.Compass, '首頁動態探索'],
                  ['search', Icon.Search, '搜尋 用戶/標籤'],
                ].map(([id, IconCmp, label]) =>
                  h(
                    'button',
                    {
                      key: id,
                      className: `ig-browse-subbtn ${browseSubtab === id ? 'active' : ''}`,
                      onClick: () => {
                        setBrowseSubtab(id)
                        setBrowseItems([])
                        setBrowseUserMeta(null)
                        setBrowseDiagnosis(null)
                        setBrowseNotice(null)
                      },
                    },
                    h(IconCmp, { size: 13 }),
                    label
                  )
                )
              ),

              // 工具列 (Toolbar)
              h(
                'div',
                { className: 'ig-browse-toolbar' },
                browseSubtab === 'reels'
                  ? [
                      h(
                        'div',
                        { key: 'reels-user-wrap', className: 'ig-browse-input-wrap' },
                        h('span', { className: 'ig-browse-input-icon' }, h(Icon.User, { size: 14 })),
                        h('input', {
                          className: 'ig-browse-input',
                          placeholder: '輸入創作者帳號（如 wired、留空探索公開推薦）',
                          value: browseUser,
                          onChange: (e) => setBrowseUser(e.target.value),
                          onKeyDown: (e) => e.key === 'Enter' && fetchBrowse('reels'),
                        })
                      ),
                      h(
                        'select',
                        {
                          key: 'reels-limit',
                          className: 'ig-browse-select',
                          value: browseLimit,
                          onChange: (e) => setBrowseLimit(Number(e.target.value)),
                        },
                        [4, 6, 8, 12, 16].map((n) => h('option', { key: n, value: n }, `取得 ${n} 則`))
                      ),
                      h(
                        'button',
                        {
                          key: 'reels-btn',
                          className: 'ig-button primary',
                          disabled: browseLoading,
                          onClick: () => fetchBrowse('reels'),
                        },
                        h(Icon.Film, { size: 13 }),
                        browseLoading ? '正在讀取 Reels...' : '刷 Reels 短片'
                      ),
                    ]
                  : null,

                browseSubtab === 'user'
                  ? [
                      h(
                        'div',
                        { key: 'user-input-wrap', className: 'ig-browse-input-wrap' },
                        h('span', { className: 'ig-browse-input-icon' }, h(Icon.User, { size: 14 })),
                        h('input', {
                          className: 'ig-browse-input',
                          placeholder: '輸入 Instagram 帳號（如 wired, verge, techcrunch）',
                          value: browseUser,
                          onChange: (e) => setBrowseUser(e.target.value),
                          onKeyDown: (e) => e.key === 'Enter' && fetchBrowse('user'),
                        })
                      ),
                      h(
                        'select',
                        {
                          key: 'user-limit',
                          className: 'ig-browse-select',
                          value: browseLimit,
                          onChange: (e) => setBrowseLimit(Number(e.target.value)),
                        },
                        [4, 6, 8, 12, 16].map((n) => h('option', { key: n, value: n }, `取得 ${n} 篇`))
                      ),
                      h(
                        'button',
                        {
                          key: 'user-btn',
                          className: 'ig-button primary',
                          disabled: browseLoading,
                          onClick: () => fetchBrowse('user'),
                        },
                        h(Icon.Search, { size: 13 }),
                        browseLoading ? '正在讀取貼文...' : '讀取創作者貼文'
                      ),
                    ]
                  : null,

                browseSubtab === 'explore'
                  ? [
                      h('div', { key: 'explore-hint', style: { fontSize: '12px', color: '#94a3b8', flex: 1 } }, '瀏覽 Instagram 推薦首頁動態探索貼文流（Timeline / Explore）'),
                      h(
                        'select',
                        {
                          key: 'explore-limit',
                          className: 'ig-browse-select',
                          value: browseLimit,
                          onChange: (e) => setBrowseLimit(Number(e.target.value)),
                        },
                        [4, 6, 8, 12, 16].map((n) => h('option', { key: n, value: n }, `取得 ${n} 則`))
                      ),
                      h(
                        'button',
                        {
                          key: 'explore-btn',
                          className: 'ig-button primary',
                          disabled: browseLoading,
                          onClick: () => fetchBrowse('explore'),
                        },
                        h(Icon.Compass, { size: 13 }),
                        browseLoading ? '正在整理動態...' : '刷首頁探索'
                      ),
                    ]
                  : null,

                browseSubtab === 'search'
                  ? [
                      h(
                        'div',
                        { key: 'search-input-wrap', className: 'ig-browse-input-wrap' },
                        h('span', { className: 'ig-browse-input-icon' }, h(Icon.Search, { size: 14 })),
                        h('input', {
                          className: 'ig-browse-input',
                          placeholder: browseSearchType === 'users' ? '搜尋使用者名稱或暱稱...' : '搜尋主題標籤（無需輸入 #）...',
                          value: browseQuery,
                          onChange: (e) => setBrowseQuery(e.target.value),
                          onKeyDown: (e) => e.key === 'Enter' && fetchBrowse('search'),
                        })
                      ),
                      h(
                        'select',
                        {
                          key: 'search-type',
                          className: 'ig-browse-select',
                          value: browseSearchType,
                          onChange: (e) => setBrowseSearchType(e.target.value),
                        },
                        h('option', { value: 'users' }, '搜尋使用者 (Users)'),
                        h('option', { value: 'tags' }, '搜尋標籤 (Tags)')
                      ),
                      h(
                        'button',
                        {
                          key: 'search-btn',
                          className: 'ig-button primary',
                          disabled: browseLoading,
                          onClick: () => fetchBrowse('search'),
                        },
                        h(Icon.Search, { size: 13 }),
                        browseLoading ? '搜尋中...' : '立即搜尋'
                      ),
                    ]
                  : null
              ),

              // 提示與診斷橫幅
              browseNotice
                ? h(
                    'div',
                    { className: `ig-banner ${browseNotice.type}` },
                    h(Icon.Info, { size: 15 }),
                    h('span', null, browseNotice.text)
                  )
                : null,

              browseDiagnosis
                ? h(
                    'div',
                    { className: 'ig-banner warn' },
                    h(Icon.Info, { size: 15 }),
                    h(
                      'div',
                      null,
                      h('strong', null, '系統診斷與排查提示：'),
                      h('div', { style: { marginTop: '2px' } }, browseDiagnosis)
                    )
                  )
                : null,

              // 創作者名片 (Profile Card)
              browseUserMeta
                ? h(
                    'div',
                    { className: 'ig-profile-card' },
                    h(
                      'div',
                      { className: 'ig-profile-avatar' },
                      browseUserMeta.profile_pic_url
                        ? h('img', { src: browseUserMeta.profile_pic_url, alt: browseUserMeta.username })
                        : h(Icon.User, { size: 28 })
                    ),
                    h(
                      'div',
                      { className: 'ig-profile-body' },
                      h(
                        'div',
                        { className: 'ig-profile-header-line' },
                        h('span', { className: 'ig-profile-handle' }, `@${browseUserMeta.username}`),
                        browseUserMeta.full_name ? h('span', { className: 'ig-profile-name' }, browseUserMeta.full_name) : null,
                        browseUserMeta.is_verified ? h('span', { className: 'ig-badge-verified' }, '✓ 官方認證') : null,
                        browseUserMeta.is_private ? h('span', { className: 'ig-badge-private' }, '私人帳號') : null
                      ),
                      h(
                        'div',
                        { className: 'ig-profile-stats' },
                        h('span', null, h('strong', null, Number(browseUserMeta.media_count || 0).toLocaleString()), '篇貼文'),
                        h('span', null, h('strong', null, Number(browseUserMeta.follower_count || 0).toLocaleString()), '位粉絲'),
                        h('span', null, h('strong', null, Number(browseUserMeta.following_count || 0).toLocaleString()), '追蹤中')
                      ),
                      browseUserMeta.biography
                        ? h('div', { className: 'ig-profile-bio' }, browseUserMeta.biography)
                        : null
                    )
                  )
                : null,

              // 貼文 / Reel 卡片網格 (當非搜尋或搜尋為媒體時)
              browseSubtab !== 'search' && browseItems.length > 0
                ? h(
                    'div',
                    { className: 'ig-media-grid' },
                    browseItems.map((item) => {
                      const isReel = item.is_reel || item.media_type === 2
                      const isCollab = item.is_collaborative && Array.isArray(item.coauthors) && item.coauthors.length > 0
                      const author = item.author || (item.user && item.user.username) || 'instagram_user'
                      const thumb = item.thumbnail_url || (item.image_versions2 && item.image_versions2.candidates?.[0]?.url) || ''

                      return h(
                        'div',
                        { key: item.id || item.code || Math.random(), className: 'ig-media-card' },
                        h(
                          'div',
                          { className: 'ig-media-thumb-box' },
                          thumb
                            ? h('img', { className: 'ig-media-thumb-img', src: thumb, alt: 'thumbnail' })
                            : h('div', { className: 'ig-media-thumb-placeholder' }, h(Icon.Instagram, { size: 32 })),
                          h(
                            'div',
                            { className: 'ig-media-type-pill' },
                            isReel ? h(Icon.Film, { size: 10 }) : h(Icon.Tag, { size: 10 }),
                            isReel ? 'Reel 短片' : item.media_type === 8 ? '輪播相簿' : '貼文'
                          ),
                          isCollab
                            ? h(
                                'div',
                                { className: 'ig-collab-pill', title: `共同作者: ${item.coauthors.map((c) => '@' + c.username).join(', ')}` },
                                h(Icon.Users, { size: 11 }),
                                h('span', null, '聯名發布: '),
                                h('strong', null, `@${author}`),
                                h('span', null, ` × @${item.coauthors[0].username}`)
                              )
                            : null
                        ),
                        h(
                          'div',
                          { className: 'ig-media-content' },
                          h(
                            'div',
                            { className: 'ig-media-author' },
                            h(
                              'a',
                              {
                                href: `https://www.instagram.com/${author}/`,
                                target: '_blank',
                                rel: 'noopener noreferrer',
                              },
                              `@${author}`
                            ),
                            item.taken_at
                              ? h('span', { style: { color: '#64748b', fontSize: '10px' } }, new Date(item.taken_at * 1000).toLocaleDateString())
                              : null
                          ),
                          h('div', { className: 'ig-media-caption', title: item.caption || '' }, item.caption || '(無文字內文)'),
                          h(
                            'div',
                            { className: 'ig-media-meta-row' },
                            h(
                              'div',
                              { className: 'ig-media-counts' },
                              h('span', { className: 'ig-media-count-item' }, h(Icon.Heart, { size: 11 }), Number(item.like_count || 0).toLocaleString()),
                              h('span', { className: 'ig-media-count-item' }, h(Icon.MessageCircle, { size: 11 }), Number(item.comment_count || 0).toLocaleString())
                            ),
                            item.url || item.code
                              ? h(
                                  'a',
                                  {
                                    className: 'ig-media-ext-link',
                                    href: item.url || `https://www.instagram.com/p/${item.code}/`,
                                    target: '_blank',
                                    rel: 'noopener noreferrer',
                                    title: '在 Instagram 開啟貼文',
                                  },
                                  h(Icon.ExternalLink, { size: 12 })
                                )
                              : null
                          )
                        )
                      )
                    })
                  )
                : null,

              // 搜尋結果列表 (當 subtab === 'search')
              browseSubtab === 'search' && browseItems.length > 0
                ? h(
                    'div',
                    { className: 'ig-search-grid' },
                    browseItems.map((res) => {
                      if (browseSearchType === 'users') {
                        return h(
                          'div',
                          { key: res.pk || res.id || res.username, className: 'ig-search-card' },
                          h(
                            'div',
                            { className: 'ig-search-avatar' },
                            res.profile_pic_url
                              ? h('img', { src: res.profile_pic_url, alt: res.username })
                              : h(Icon.User, { size: 20 })
                          ),
                          h(
                            'div',
                            { className: 'ig-search-info' },
                            h(
                              'div',
                              { className: 'ig-search-title' },
                              `@${res.username}`,
                              res.is_verified ? h('span', { className: 'ig-badge-verified' }, '✓') : null
                            ),
                            h('div', { className: 'ig-search-subtitle' }, res.full_name || '無全名'),
                            res.follower_count !== undefined
                              ? h('div', { className: 'ig-search-count' }, `${Number(res.follower_count).toLocaleString()} 位粉絲`)
                              : null
                          ),
                          h(
                            'button',
                            {
                              className: 'ig-button',
                              style: { padding: '0 8px', height: '28px' },
                              onClick: () => {
                                setBrowseSubtab('user')
                                setBrowseUser(res.username)
                                setBrowseItems([])
                                setBrowseUserMeta(null)
                                setBrowseDiagnosis(null)
                              },
                            },
                            '看貼文'
                          )
                        )
                      } else {
                        return h(
                          'div',
                          { key: res.id || res.name, className: 'ig-search-card' },
                          h(
                            'div',
                            { className: 'ig-search-avatar', style: { borderRadius: '8px' } },
                            h(Icon.Tag, { size: 18 })
                          ),
                          h(
                            'div',
                            { className: 'ig-search-info' },
                            h('div', { className: 'ig-search-title' }, `#${res.name}`),
                            h('div', { className: 'ig-search-count' }, `${Number(res.media_count || 0).toLocaleString()} 篇公開貼文`)
                          )
                        )
                      }
                    })
                  )
                : null,

              // 空狀態展示 (未查詢或查詢無結果)
              !browseLoading && browseItems.length === 0
                ? h(
                    'div',
                    { className: 'ig-empty-box' },
                    h(Icon.Compass, { size: 36 }),
                    h('div', { className: 'ig-empty-title' }, '準備開始瀏覽 Instagram'),
                    h(
                      'div',
                      { className: 'ig-empty-desc' },
                      browseSubtab === 'reels'
                        ? '點擊「刷 Reels 短片」獲取推薦連續短片；亦可輸入指定創作者帳號瀏覽其短片。'
                        : browseSubtab === 'user'
                        ? '請在上方輸入創作者帳號並點擊「讀取創作者貼文」，安全唯讀其最新公開貼文與互動數據。'
                        : browseSubtab === 'explore'
                        ? '點擊「刷首頁探索」安全抓取首頁動態探索貼文流。'
                        : '輸入關鍵字搜尋 Instagram 使用者或標籤，快速探索創作者主頁。'
                    )
                  )
                : null
            )
          : null,

        // ====================================================================
        // TAB 3: 標籤巡查推坑 (Hashtag Patrol)
        // ====================================================================
        tab === 'patrol'
          ? h(
              'div',
              { className: 'ig-panel' },
              h(
                'div',
                { className: 'ig-section-head' },
                h('div', { className: 'ig-section-title' }, '標籤巡查與精選推坑 (Patrol Duty)'),
                h('div', { className: 'ig-section-desc' }, '定期巡查特定主題標籤，經由 LLM 評估貼文品質後，主動在留言區 @目標用戶推薦優質內容。')
              ),

              h(
                'div',
                { className: 'ig-switch-cell' },
                h(
                  'div',
                  { className: 'ig-switch-text' },
                  h('div', { className: 'ig-switch-name' }, '啟用標籤背景自動巡查'),
                  h('div', { className: 'ig-switch-sub' }, '依據設定的週期於背景定期抓取熱門標籤貼文進行推坑評估')
                ),
                h(
                  'button',
                  {
                    className: `ig-toggle-btn ${cfg.patrolEnabled ? 'on' : ''}`,
                    onClick: () => updateField('patrolEnabled', !cfg.patrolEnabled),
                  },
                  h('span', { className: 'ig-toggle-thumb' })
                )
              ),

              h(
                'div',
                { className: 'ig-grid-2' },
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '巡查週期 (分鐘)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.patrolIntervalMinutes ?? 15,
                    onChange: (e) => updateField('patrolIntervalMinutes', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '排程背景巡查的時間間隔')
                ),
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '每日推坑留言上限 (則)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.maxDailyPatrolComments ?? 10,
                    onChange: (e) => updateField('maxDailyPatrolComments', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '每日累計推坑留言達此上限後自動休眠，防止頻率過高')
                )
              ),

              h(
                'div',
                { className: 'ig-field' },
                h('label', { className: 'ig-field-label' }, '監聽標籤 (Hashtags)'),
                h('input', {
                  className: 'ig-input-text',
                  value: Array.isArray(cfg.hashtags) ? cfg.hashtags.join(', ') : '',
                  placeholder: 'ai, deepseek, coding, python',
                  onChange: (e) =>
                    updateField(
                      'hashtags',
                      e.target.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean)
                    ),
                }),
                h('div', { className: 'ig-field-hint' }, '多個標籤請以逗號分隔，無需輸入 # 符號')
              ),

              h(
                'div',
                { className: 'ig-grid-2' },
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '最低讚數門檻 (Min Likes)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.minLikes ?? 20,
                    onChange: (e) => updateField('minLikes', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '貼文按讚數大於此值才納入推坑考量')
                ),
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '最低留言門檻 (Min Comments)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.minComments ?? 2,
                    onChange: (e) => updateField('minComments', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '貼文留言數大於此值才納入推坑考量')
                )
              ),

              h(
                'div',
                { className: 'ig-field' },
                h('label', { className: 'ig-field-label' }, '排除關鍵字 (Exclude Keywords)'),
                h('input', {
                  className: 'ig-input-text',
                  value: Array.isArray(cfg.excludeKeywords) ? cfg.excludeKeywords.join(', ') : '',
                  placeholder: '廣告, 互粉, 代購, 抽獎, 運彩',
                  onChange: (e) =>
                    updateField(
                      'excludeKeywords',
                      e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                    ),
                }),
                h('div', { className: 'ig-field-hint' }, '貼文內文若包含上述詞彙將直接跳過，以逗號分隔')
              ),

              h(
                'div',
                { className: 'ig-field' },
                h('label', { className: 'ig-field-label' }, '推坑評估人設提示詞 (Persona Prompt)'),
                h('textarea', {
                  className: 'ig-textarea-input',
                  value: cleanStr(cfg.patrolPersonaPrompt),
                  placeholder: '你是一位精通技術與好物的推坑達人...',
                  onChange: (e) => updateField('patrolPersonaPrompt', e.target.value),
                }),
                h('div', { className: 'ig-field-hint' }, '引導大語言模型分析貼文價值並撰寫自然的推薦詞')
              )
            )
          : null,

        // ====================================================================
        // TAB 3: 提及應答 (Mention Reply)
        // ====================================================================
        tab === 'mention'
          ? h(
              'div',
              { className: 'ig-panel' },
              h(
                'div',
                { className: 'ig-section-head' },
                h('div', { className: 'ig-section-title' }, '貼文留言 @機器人 提問應答 (Mention Reply)'),
                h('div', { className: 'ig-section-desc' }, '當貼文留言區有人標註 @機器人 提問時，抓取貼文上下文透過 LLM 進行智慧解答。')
              ),

              h(
                'div',
                { className: 'ig-switch-cell' },
                h(
                  'div',
                  { className: 'ig-switch-text' },
                  h('div', { className: 'ig-switch-name' }, '啟用留言被標註自動應答'),
                  h('div', { className: 'ig-switch-sub' }, '自動監聽被 @ 的留言並在對應串中回覆解答')
                ),
                h(
                  'button',
                  {
                    className: `ig-toggle-btn ${cfg.mentionReplyEnabled ? 'on' : ''}`,
                    onClick: () => updateField('mentionReplyEnabled', !cfg.mentionReplyEnabled),
                  },
                  h('span', { className: 'ig-toggle-thumb' })
                )
              ),

              h(
                'div',
                { className: 'ig-grid-2' },
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '檢查週期 (分鐘)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.mentionIntervalMinutes ?? 5,
                    onChange: (e) => updateField('mentionIntervalMinutes', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '檢查是否有新提及留言的週期頻率')
                ),
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '單篇貼文應答輪數上限 (Round Cap)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.roundCapPerPost ?? 3,
                    onChange: (e) => updateField('roundCapPerPost', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '限制單篇貼文內最多回覆輪次，徹底防範機器人互相刷屏')
                )
              ),

              h(
                'div',
                { className: 'ig-grid-2' },
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '每日被 @ 應答總上限 (則)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.maxDailyMentionReplies ?? 20,
                    onChange: (e) => updateField('maxDailyMentionReplies', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '每日全站留言回覆總量安全防線')
                ),
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '相鄰上下文留言抓取數'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.maxContextComments ?? 10,
                    onChange: (e) => updateField('maxContextComments', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '傳遞給 LLM 理解討論情境的留言數量')
                )
              ),

              h(
                'div',
                { className: 'ig-field' },
                h('label', { className: 'ig-field-label' }, '留言回覆人設提示詞 (Persona Prompt)'),
                h('textarea', {
                  className: 'ig-textarea-input',
                  value: cleanStr(cfg.mentionPersonaPrompt),
                  placeholder: '你是一位友善、專業的社群技術助手...',
                  onChange: (e) => updateField('mentionPersonaPrompt', e.target.value),
                }),
                h('div', { className: 'ig-field-hint' }, '定義回覆提問時的專業口吻與風格規範')
              )
            )
          : null,

        // ====================================================================
        // TAB 4: 私訊互動 (Direct Message Reply)
        // ====================================================================
        tab === 'dm'
          ? h(
              'div',
              { className: 'ig-panel' },
              h(
                'div',
                { className: 'ig-section-head' },
                h('div', { className: 'ig-section-title' }, '私訊 (Direct Message) 雙向互動 (DM Reply)'),
                h('div', { className: 'ig-section-desc' }, '定時收取未讀私訊對話，透過大語言模型進行連貫且符合人設的自然對話回覆。')
              ),

              h(
                'div',
                { className: 'ig-switch-cell' },
                h(
                  'div',
                  { className: 'ig-switch-text' },
                  h('div', { className: 'ig-switch-name' }, '啟用未讀私訊自動應答'),
                  h('div', { className: 'ig-switch-sub' }, '定時輪詢接收私訊並觸發回覆')
                ),
                h(
                  'button',
                  {
                    className: `ig-toggle-btn ${cfg.dmReplyEnabled ? 'on' : ''}`,
                    onClick: () => updateField('dmReplyEnabled', !cfg.dmReplyEnabled),
                  },
                  h('span', { className: 'ig-toggle-thumb' })
                )
              ),

              h(
                'div',
                { className: 'ig-switch-cell' },
                h(
                  'div',
                  { className: 'ig-switch-text' },
                  h('div', { className: 'ig-switch-name' }, '僅回覆白名單用戶 (Whitelist Mode)'),
                  h('div', { className: 'ig-switch-sub' }, '啟用後僅回應名單內指定的 IG 使用者，關閉則回應用戶私訊')
                ),
                h(
                  'button',
                  {
                    className: `ig-toggle-btn ${cfg.dmWhitelistOnly ? 'on' : ''}`,
                    onClick: () => updateField('dmWhitelistOnly', !cfg.dmWhitelistOnly),
                  },
                  h('span', { className: 'ig-toggle-thumb' })
                )
              ),

              h(
                'div',
                { className: 'ig-grid-2' },
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '私訊輪詢間隔 (分鐘)'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.dmIntervalMinutes ?? 3,
                    onChange: (e) => updateField('dmIntervalMinutes', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '檢查未讀 Inbox 的時間頻率')
                ),
                h(
                  'div',
                  { className: 'ig-field' },
                  h('label', { className: 'ig-field-label' }, '單一用戶每日私訊回覆上限'),
                  h('input', {
                    type: 'number',
                    className: 'ig-input-text ig-input-number',
                    value: cfg.dmMaxPerUserPerDay ?? 5,
                    onChange: (e) => updateField('dmMaxPerUserPerDay', Number(e.target.value)),
                  }),
                  h('div', { className: 'ig-field-hint' }, '單一對象當日最多互動次數')
                )
              ),

              h(
                'div',
                { className: 'ig-field' },
                h('label', { className: 'ig-field-label' }, '私訊白名單用戶 (Whitelist)'),
                h('input', {
                  className: 'ig-input-text',
                  value: Array.isArray(cfg.dmWhitelist) ? cfg.dmWhitelist.join(', ') : '',
                  placeholder: 'your_username, vip_friend',
                  onChange: (e) =>
                    updateField(
                      'dmWhitelist',
                      e.target.value.split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean)
                    ),
                }),
                h('div', { className: 'ig-field-hint' }, '多個用戶名請以逗號分隔，無需輸入 @ 符號')
              ),

              h(
                'div',
                { className: 'ig-field' },
                h('label', { className: 'ig-field-label' }, '私訊回覆人設提示詞 (Persona Prompt)'),
                h('textarea', {
                  className: 'ig-textarea-input',
                  value: cleanStr(cfg.dmPersonaPrompt),
                  placeholder: '你正在與用戶進行一對一私訊溝通，回答需親切真誠...',
                  onChange: (e) => updateField('dmPersonaPrompt', e.target.value),
                }),
                h('div', { className: 'ig-field-hint' }, '指導私訊回覆時的情緒氛圍與對話限制')
              )
            )
          : null,

        // ====================================================================
        // TAB 5: 運行與統計 (Status & Metrics)
        // ====================================================================
        tab === 'status'
          ? h(
              'div',
              { className: 'ig-panel' },
              h(
                'div',
                { className: 'ig-section-head' },
                h('div', { className: 'ig-section-title' }, '今日互動數據與排程狀態'),
                h('div', { className: 'ig-section-desc' }, '即時監控今日配額消耗進度與任務排程健康度。')
              ),

              h(
                'div',
                { className: 'ig-kpi-grid' },
                h(
                  'div',
                  { className: 'ig-kpi-card' },
                  h('div', { className: 'ig-kpi-title' }, '今日巡查推坑留言'),
                  h(
                    'div',
                    { className: 'ig-kpi-number' },
                    status?.dailyStats?.patrolComments || 0,
                    h('span', { className: 'ig-kpi-denom' }, `/ ${cleanNum(cfg.maxDailyPatrolComments, 10)}`)
                  ),
                  h(
                    'div',
                    { className: 'ig-progress-bar' },
                    h('div', {
                      className: 'ig-progress-fill',
                      style: {
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((status?.dailyStats?.patrolComments || 0) /
                              cleanNum(cfg.maxDailyPatrolComments, 10)) *
                              100
                          )
                        )}%`,
                      },
                    })
                  )
                ),
                h(
                  'div',
                  { className: 'ig-kpi-card' },
                  h('div', { className: 'ig-kpi-title' }, '今日被 @ 提問應答'),
                  h(
                    'div',
                    { className: 'ig-kpi-number' },
                    status?.dailyStats?.mentionReplies || 0,
                    h('span', { className: 'ig-kpi-denom' }, `/ ${cleanNum(cfg.maxDailyMentionReplies, 20)}`)
                  ),
                  h(
                    'div',
                    { className: 'ig-progress-bar' },
                    h('div', {
                      className: 'ig-progress-fill',
                      style: {
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((status?.dailyStats?.mentionReplies || 0) /
                              cleanNum(cfg.maxDailyMentionReplies, 20)) *
                              100
                          )
                        )}%`,
                      },
                    })
                  )
                ),
                h(
                  'div',
                  { className: 'ig-kpi-card' },
                  h('div', { className: 'ig-kpi-title' }, '今日私訊對話回覆'),
                  h(
                    'div',
                    { className: 'ig-kpi-number' },
                    status?.dailyStats?.dmReplies || 0,
                    h('span', { className: 'ig-kpi-denom' }, `/ ${cleanNum(cfg.dmDailyCap, 30)}`)
                  ),
                  h(
                    'div',
                    { className: 'ig-progress-bar' },
                    h('div', {
                      className: 'ig-progress-fill',
                      style: {
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((status?.dailyStats?.dmReplies || 0) / cleanNum(cfg.dmDailyCap, 30)) * 100
                          )
                        )}%`,
                      },
                    })
                  )
                )
              ),

              h(
                'div',
                { className: 'ig-btn-group', style: { marginTop: '12px' } },
                h(
                  'button',
                  {
                    className: 'ig-button primary',
                    disabled: runningDuty,
                    onClick: runDutiesNowAction,
                  },
                  h(Icon.Play, { size: 12 }),
                  runningDuty ? '正在執行各項任務...' : '立即執行一次完整任務循環'
                ),
                h(
                  'button',
                  {
                    className: 'ig-button',
                    onClick: refreshData,
                  },
                  h(Icon.Refresh, { size: 13 }),
                  '重新整理數據'
                )
              )
            )
          : null,

        // 底部儲存動作欄 (Sticky/Fixed Footer Bar)
        h(
          'div',
          { className: 'ig-footer-bar' },
          h('div', { className: 'ig-footer-hint' }, '參數修改後請點擊儲存，新設定將即時寫入配置檔並生效。'),
          h(
            'button',
            {
              className: 'ig-button primary',
              disabled: saving,
              onClick: saveSettings,
            },
            h(Icon.Save, { size: 14 }),
            saving ? '正在儲存...' : '儲存所有設定'
          )
        )
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 注入專屬 CSS 樣式
        try {
          if (!document.querySelector('style[data-plugin-css="dsh-instagram-plugin"]')) {
            const style = document.createElement('style')
            style.setAttribute('data-plugin-css', 'dsh-instagram-plugin')
            style.textContent = CSS
            document.head.appendChild(style)
            if (typeof ctx?.effect === 'function') {
              ctx.effect(() => () => style.remove(), 'dsh-instagram-plugin: settings style')
            }
          }
        } catch (e) {}

        // 註冊至 DSH 官方設定槽位
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        // 1. 左側一級專屬導航槽位 (settings.section)
        const registerSection = () => {
          try {
            slots.register(
              {
                name: 'settings.section',
                id: 'instagram-plugin',
                order: 35,
                label: 'Instagram 助理',
              },
              () => h(Panel)
            )
          } catch (e) {
            console.error('[@luoyi-dsh/instagram-plugin] 註冊 settings.section 異常:', e)
          }
        }
        if (typeof slots.inject === 'function') {
          slots.inject('settings.section', registerSection)
        } else if (typeof slots.register === 'function') {
          registerSection()
        }

        // 2. 外掛程式頁面頂部頁籤 (settings.plugins.tab)
        const registerTab = () => {
          try {
            slots.register(
              {
                name: 'settings.plugins.tab',
                id: 'instagram-plugin',
                order: 35,
                label: 'Instagram',
              },
              () => h(Panel)
            )
          } catch (e) {
            console.error('[@luoyi-dsh/instagram-plugin] 註冊 settings.plugins.tab 異常:', e)
          }
        }
        if (typeof slots.inject === 'function') {
          slots.inject('settings.plugins.tab', registerTab)
        } else if (typeof slots.register === 'function') {
          registerTab()
        }

        // 3. 外掛程式卡片列表槽位 (plugins.item)
        const registerItem = () => {
          try {
            slots.register(
              {
                name: 'plugins.item',
                id: 'instagram-plugin',
                order: 35,
                label: 'Instagram 社群助理',
              },
              () => h(Panel)
            )
          } catch (e) {
            console.error('[@luoyi-dsh/instagram-plugin] 註冊 plugins.item 異常:', e)
          }
        }
        if (typeof slots.inject === 'function') {
          slots.inject('plugins.item', registerItem)
        } else if (typeof slots.register === 'function') {
          registerItem()
        }
      },
    }
  },
})
