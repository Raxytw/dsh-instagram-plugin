# DSH Instagram Business & Automation Duties Plugin (`@luoyi-dsh/instagram-plugin`)

<div align="center">

![DSH Instagram Plugin Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md) | [Agent & Operational Guide](AGENTS.md)**

</div>

> Relies on `@luoyi-dsh/instagram-mcp` for FastMCP connectivity and centralized account credentials (`username` & `masterUsername`).  
> This plugin provides two core operational capabilities:  
> 1. **Safe Read-Only Browsing & Exploration**: Browse creator posts, Reels short videos, explore timeline feeds, and search users/tags without liking, posting, or triggering account risk.  
> 2. **AI-Driven Social Duties**: Background fuzzy topic patrol with smart recommendation comments, grounded @mention (RM) multimodal reasoning on Posts & Reels, and AI Direct Message (DM) responses powered by DSH Platform Subscriptions (`dsh-plugin-subscriptions`) or custom LLM APIs.

> [!CAUTION]
> ### ⚠️ CRITICAL WARNING & DISCLAIMER
> 1. **Violation of Instagram Terms of Service & Community Guidelines**:
>    This plugin interacts with Instagram via unofficial reverse-engineered APIs, which **expressly violates Instagram / Meta's Terms of Use and Community Guidelines**.
> 2. **DO NOT USE YOUR PERSONAL / PRIMARY ACCOUNT**:
>    **Never use your personal, primary, or business-critical Instagram account!** Running automated scripts carries an extreme risk of **Action Blocks, Challenge Checkpoints, temporary lockouts, and PERMANENT ACCOUNT SUSPENSION / BANNING**.
> 3. **Disclaimer**:
>    This project is provided strictly for educational and technical research purposes. Use entirely at your own risk!

---

## 🌟 Key Features

1. **Zero-Config Account Inheritance**:
   - Automatically inherits both the Bot account (`username`) and Master account (`masterUsername`) from `@luoyi-dsh/instagram-mcp`.
2. **External Subscription Quota & Multi-Tier LLM Engine**:
   - Reads authorized quotas from `dsh-plugin-subscriptions` (Google Antigravity, OpenAI Codex, xAI Grok, GitHub Copilot) and supports custom OpenAI / DeepSeek APIs with automatic HTTP 402 failover.
3. **Grounded Post & Reel Mention Replies (RM)**:
   - Reads the full Post or Reel context (caption, title, accessibility visual description, Reel audio metadata, video subtitles, multimodal image inspection, and parent comments) before replying to `@mentions`—never hallucinating or using canned responses.
4. **Strict Anti-AIGC Filtering**:
   - Automatically filters out AI-generated videos, animations, artwork, and content-farm articles during search and patrol.
5. **Safe Read-Only Browsing & Multi-Tier Anti-Risk Safeguards**:
   - Enforces per-run caps, hourly/daily quotas, humanized jitter, and automatic 30-minute circuit breaker cooldowns.

---

## 🚀 Installation

```bash
# Via DSH Plugin CLI
dsh plugin --profile web add @luoyi-dsh/instagram-plugin

# Or via npm
npm install @luoyi-dsh/instagram-plugin
```

---

## 📖 Operational Guide & Tool Reference

For complete DSH tool definitions, read-only browsing & automation REST APIs, LLM configuration, and usage examples, please refer to **[AGENTS.md](AGENTS.md)**.

---

## 📁 Directory Structure

```text
dsh-instagram-plugin/
├── client.js              # Web UI dashboard
├── cordis.patch.yml       # DSH Cordis bundle patch
├── package.json           # Module definitions
├── tsconfig.json          # TypeScript compiler configuration
├── AGENTS.md              # Operational & Agent Tool Guide
├── CHANGELOG.md           # Version release notes
├── README.md              # English overview (This file)
├── README.zh-Hant.md      # Traditional Chinese overview
└── src/                   # TypeScript source code (LLM engine, patrol, mentionReply, dmReply, tools)
```

---

## 📜 Releases & License

- See [CHANGELOG.md](CHANGELOG.md) for release notes.
- Licensed under the [MIT License](LICENSE).
