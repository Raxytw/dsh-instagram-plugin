# Changelog

All notable changes to `@luoyi-dsh/instagram-plugin` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.2] - 2026-10-28

### Added
- **Seamless Session Inheritance from `@luoyi-dsh/instagram-mcp`**:
  - Completely decoupled authentication from the business plugin. All session credentials, 2FA status, and proxy settings are automatically inherited from `@luoyi-dsh/instagram-mcp`.
  - Removed duplicate credential inputs in the configuration schema and UI.
- **Immediate Client Mounting**:
  - Added `client.immediately = true` to `package.json` for instant tab rendering in DSH Web.
- **Output Render Schema in Tools**:
  - Registered clean text rendering formatters for all DSH business tools.
- **Multi-language Documentation**:
  - Full English and Traditional Chinese README documentation.

### Changed
- Standardized Cordis bundle patch to `@luoyi-dsh/instagram-plugin`.
- Streamlined `config.ts` by removing deprecated standalone login credentials and prioritizing `botUsername` and duty rules.

---

## [1.0.1] - 2026-10-27

### Added
- Read-only browsing suite: User posts, Reels short videos, Explore timeline, and user/tag search.
- Collaborative post resolution (`@author × @coauthor`).
- Banner images and dynamic data initialization architecture.

---

## [1.0.0] - 2026-10-26

### Initial Release
- **Automation Duties**: Background hashtag patrol & recommendations, @mention reasoning and answering, unread DM assistant.
- **Web UI Panel**: 6-tab frontend dashboard in `client.js` with KPI cards and manual duty triggers.
