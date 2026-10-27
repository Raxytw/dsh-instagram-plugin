# DSH Instagram Business & Automation Duties Plugin (`@luoyi-dsh/instagram-plugin`)

<div align="center">

![DSH Instagram Plugin Banner](assets/banner.png)

**[English](README.md) | [繁體中文](README.zh-Hant.md)**

</div>

> Relies on `@luoyi-dsh/instagram-mcp` for FastMCP connectivity and authentication credentials.  
> This plugin provides two core operational capabilities:  
> 1. **Safe Read-Only Browsing & Exploration**: Browse creator posts, Reels short videos, explore timeline feeds, and search users/tags without liking, posting, or triggering account risk.  
> 2. **Automated Social Duties**: Background hashtag patrol with smart recommendation comments, @mention reasoning and answer assistant, and unread Direct Message (DM) management.  
>
> Fully inherits session state from `@luoyi-dsh/instagram-mcp` with zero duplicated credentials. The web management console is available via `client.js`.

---

## 🚀 Installation

Install via DSH Plugin CLI:

```bash
dsh plugin --profile web add @luoyi-dsh/instagram-plugin
```

Or via standard npm:

```bash
npm install @luoyi-dsh/instagram-plugin
```

---

## 🔍 Read-Only Browsing & Exploration API (Pure Read, No Footprint)

### 1. Retrieve Creator Posts (User Posts)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/user?username=wired&limit=5"
```

**Response Format:**
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

### 2. Browse Reels Short Videos (Reels Feed)
- **Explore Recommended Reels**:
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/reels?limit=6"
  ```
- **Reels from Specific Creator**:
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/reels?username=wired&limit=6"
  ```

### 3. Explore Timeline (Explore Feed)
```bash
curl "http://127.0.0.1:3080/api/instagram/browse/explore?limit=6"
```

### 4. Search Users & Hashtags
- **Search Users**:
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/search?q=verge&type=users"
  ```
- **Search Hashtags**:
  ```bash
  curl "http://127.0.0.1:3080/api/instagram/browse/search?q=technology&type=tags"
  ```

---

## ⚡ Business & Automation REST API

### 1. Check Status & Active Account
```bash
curl http://127.0.0.1:3080/api/instagram/status
```
Key response fields:
- `loginStatus.ok`: Whether logged in.
- `loginStatus.username`: Active authenticated Instagram handle.
- `loginStatus.message`: Description of session source and state.
- `inheritedSession`: Indicates credentials are automatically inherited from `@luoyi-dsh/instagram-mcp`.

### 2. Synchronize Inherited Session
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/login \
  -H "Content-Type: application/json" \
  -d "{}"
```

### 3. Trigger Automation Duty Round Manually
```bash
curl -X POST http://127.0.0.1:3080/api/instagram/run \
  -H "Content-Type: application/json" \
  -d "{}"
```

---

## 🛠️ Provided DSH Tools

| Tool Name | Type | Description | Key Parameters |
| :--- | :--- | :--- | :--- |
| `ig_browse_user_posts` | **Read-Only** | Read latest posts by creator with full author bio and collaborative partners. | `username` (required), `limit` |
| `ig_browse_reels` | **Read-Only** | Browse Reels short videos (explore or creator-specific). | `username` (optional), `limit` |
| `ig_browse_timeline` | **Read-Only** | Explore top posts from timeline discovery feed. | `limit` |
| `ig_search_users` | **Read-Only** | Search Instagram users (returns follower count and verified badge). | `query` (required), `limit` |
| `ig_search_tags` | **Read-Only** | Search Instagram hashtags (returns media count). | `query` (required), `limit` |
| `ig_check_status` | Status | Get connection status, active username, and quota ledger. | None |
| `ig_search_hashtag` | Query | Query latest posts under a hashtag. | `hashtag` (required), `limit` |
| `ig_get_post_context` | Read-Only | Fetch post full caption and comments list. | `media_pk` (required), `comment_limit` |
| `ig_manual_patrol` | Duty | Perform hashtag patrol immediately (leaves recommendation comments if threshold met). | `hashtag` (optional) |
| `ig_manual_reply_post` | Duty | Publish a comment or reply to an existing comment. | `media_pk`, `text`, `reply_to_comment_pk` |
| `ig_manual_send_dm` | Duty | Send message to a direct message thread. | `thread_id`, `text` |
| `ig_run_duties_now` | Duty | Run a complete round of patrol, mentions, and DMs. | None |

---

## 🎨 Web Control Panel (`client.js`)

The web UI provides six dedicated sections:
1. **Identity & MCP Session**: Live status inherited from `@luoyi-dsh/instagram-mcp`, target user configuration, and bot identity.
2. **Browse & Explore**:
   - **Reels**: Video covers, view links, and metadata.
   - **Creator Profiles**: Profile bios, follower counts, verified badges, and collaborative tags.
   - **Explore Feed**: One-click exploration stream.
   - **Search**: Interactive user and hashtag search with direct profile navigation.
3. **Hashtag Patrol**: Topic tags, LLM persona prompts, and recommendation templates.
4. **Mention Reply**: Automatic answer rules and whitelists/blacklists for @mentions.
5. **Direct Messages**: Unread DM assistance.
6. **Execution & Metrics**: KPI cards with daily quotas and manual duty triggers.

---

## 📁 Directory Structure

```text
dsh-instagram-plugin/
├── client.js              # Web UI dashboard
├── cordis.patch.yml       # DSH Cordis bundle patch
├── package.json           # Module definitions
├── tsconfig.json          # TypeScript compiler configuration
├── CHANGELOG.md           # Version release notes
├── README.md              # English documentation (This file)
├── README.zh-Hant.md      # Traditional Chinese documentation
├── assets/
│   ├── banner.png         # Promotional banner
│   └── zh-Hant.md         # Localized documentation
├── src/                   # TypeScript source code
└── data/                  # [Runtime generated, ignored in Git]
    ├── config.json        # Plugin persistent configuration
    └── ledger.json        # Deduplication and quota ledger
```

---

## 📜 Releases & Changelog

For detailed release history and changes, please refer to [CHANGELOG.md](CHANGELOG.md).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
