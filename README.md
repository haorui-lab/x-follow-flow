# X FollowFlow (`x-follow-flow`)

<p align="center">
  <strong>A sleek, lightweight browser userscript that brings seamless inline Follow & Unfollow buttons directly to your X (Twitter) timeline.</strong>
</p>

<p align="center">
  <a href="https://github.com/haorui-lab/x-follow-flow/releases"><img src="https://img.shields.io/badge/version-0.4.0-blue.svg?style=flat-square" alt="Version"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
  <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-supported-black?style=flat-square&logo=tampermonkey" alt="Tampermonkey"></a>
  <a href="https://violentmonkey.github.io/"><img src="https://img.shields.io/badge/Violentmonkey-supported-orange?style=flat-square" alt="Violentmonkey"></a>
  <a href="https://github.com/haorui-lab/x-follow-flow/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README_CN.md"><b>简体中文</b></a>
</p>

---

## 💡 Why X FollowFlow?

Browsing X's **For You** feed is one of the primary ways to discover new creators and ideas. However, managing follow relationships requires either:
1. Hovering and waiting for a sluggish hover card to load, or
2. Clicking into the author's profile, navigating away from your reading position.

**X FollowFlow** solves this single problem with extreme elegance: it seamlessly injects a native-style, borderless icon button **directly to the right of the Share button** on every tweet.

---

## ✨ Features

- 🎯 **Native Look & Feel**: Borderless icon button embedded cleanly in the bottom action bar (`Reply` · `Repost` · `Like` · `Views` · `Bookmark` · `Grok` · `Share` · **`FollowFlow`**).
- ⚡ **Accurate Status Detection**:
  - Deep inspection of X's modern `relationship_perspectives.following` GraphQL schema.
  - Multi-layered React Fiber & Caret menu action tree verification.
  - Real-time HoverCard sync & active feed heuristics.
- 🛡️ **Two-Step Accidental Unfollow Protection**:
  - Clicking a followed user (`✓`) turns the icon into a red confirmation minus (`−`).
  - Automatically reverts after 3 seconds if not clicked again.
  - Second click confirms unfollow.
- 🔄 **Cross-Card State Synchronization**: If an author appears multiple times in your feed, following or unfollowing them on one post instantly synchronizes across all visible cards.
- 👤 **Self-Post Filtering**: Automatically identifies your logged-in handle; buttons are never shown on your own posts.
- 🚀 **High Performance & Virtual Scroll Friendly**: Debounced `MutationObserver` with zero layout shifts, 60fps scrolling, and memory leak prevention.
- 🔒 **100% Client-Side Privacy**: Zero external requests, zero analytics, no tokens or cookies uploaded. All operations run strictly on your machine.

---

## 🎨 Visual States

| State | Icon | Style | Interaction |
| :--- | :---: | :--- | :--- |
| **Not Following** | `+` | Muted neutral gray, blue hover circle | Click to immediately **Follow** |
| **Following** | `✓` | Vibrant Twitter Blue (`#1d9bf0`) | Click to initiate **Unfollow confirmation** |
| **Confirming** | `−` | Warning Red (`#f4212e`) with soft pulse | Click again within 3s to **Unfollow**; auto-reverts |
| **Loading** | ⟳ | Smooth rotating spinner | Action in progress (disabled) |

---

## 📦 Supported Pages

- ✅ `https://x.com/home` (For You & Following timelines)
- ✅ `https://x.com/search?*` (Search results timeline)
- ✅ `https://x.com/[username]` (User profile post feeds)
- ✅ `https://x.com/[username]/status/[id]` (Tweet detail & replies stream)
- ✅ `https://x.com/i/lists/*` (Lists feed)
- ✅ `https://twitter.com/*` (Legacy domain support)

---

## 🚀 Quick Install

### Prerequisites

Install a userscript manager extension in your browser:
- [**Tampermonkey**](https://www.tampermonkey.net/) (Recommended for Chrome, Edge, Safari, Firefox)
- [**Violentmonkey**](https://violentmonkey.github.io/) (Chrome, Firefox)

### Installation

Click the link below to install directly with one click:

👉 **[Install x-follow-flow.user.js](https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js)**

*(If GitHub CDN serves a cached older version, use the [Commit-Specific Link](https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js?v=0.4.0) to bypass edge cache).*

---

## ⚙️ Configuration

You can easily customize timeouts and labels by modifying the `CONFIG` object at the top of the userscript:

```javascript
const CONFIG = {
  confirmTimeoutMs: 3000,   // Unfollow confirmation timeout (ms)
  scanDebounceMs: 50,       // Timeline scroll debouncing interval (ms)
  maxCaretWaitMs: 800       // Native action simulation timeout (ms)
};
```

---

## 🛠️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    X.com Web Application                        │
│                                                                 │
│   ┌──────────────────────┐             ┌─────────────────────┐  │
│   │ Network Interceptor  │             │  MutationObserver   │  │
│   │ (Fetch + XHR Hook)   │             │  (Virtualized Feed) │  │
│   └──────────┬───────────┘             └──────────┬──────────┘  │
│              │ Extract relationship               │ New tweets  │
│              ▼                                    ▼             │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │         FollowStateManager (Single Source of Truth)      │  │
│   └──────────────────────────┬───────────────────────────────┘  │
│                              │ Sync state changes               │
│                              ▼                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │             UI Component (Action Bar Injection)          │  │
│   │       [ + (Follow) ] ⇄ [ ✓ (Following) ] ⇄ [ − (3s) ]    │  │
│   └──────────────────────────┬───────────────────────────────┘  │
│                              │ User click trigger               │
│                              ▼                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                  Action Executor Engine                  │  │
│   │   Primary: Silent native Caret trigger (invisible modal) │  │
│   │   Fallback: Direct session POST /1.1/friendships/*.json  │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

1. **Network Interceptor**: Intercepts `fetch` and `XMLHttpRequest` at `document-start`, extracting user entities from GraphQL queries without generating additional network load.
2. **Target-Bound React Search**: Reads React Fiber and props bound to the target author (`screen_name === author`), eliminating viewer/mention collision bugs.
3. **Action Execution**: Programmatically triggers the tweet's native Caret dropdown menu under silent CSS suppression, ensuring X executes its own signed requests and internal state updates.

---

## 🧪 Development & Testing

The project includes an automated test suite executed with Node.js:

```bash
# Clone the repository
git clone https://github.com/haorui-lab/x-follow-flow.git
cd x-follow-flow

# Run automated tests
npm test
```

Test coverage includes:
- Modern `relationship_perspectives` & legacy GraphQL parsing
- Target-specific React Fiber & Caret action tree resolution
- Handle and username DOM parsing
- State manager pub/sub & multi-component synchronization
- Button state machine (Follow, 2-step Unfollow, timeout rollback)

---

## 🛡️ Security & Privacy Policy

- **No Remote Telemetry**: Zero tracking scripts, zero Google Analytics, zero external servers.
- **Credential Safety**: Does not extract or store your password, auth_token, or private keys.
- **Strictly Manual**: Completely compliant with X's anti-automation rules. Follow / Unfollow actions are only triggered by explicit user clicks.

---

## 📄 License

This project is licensed under the [MIT License](./package.json).
