// ==UserScript==
// @name         X FollowFlow
// @name:zh-CN   X FollowFlow - 推荐流关注/取关助手
// @namespace    https://github.com/haorui-lab/x-follow-flow
// @version      0.3.0
// @description  Add high-recognition Follow / Unfollow icon button directly next to Grok on X timelines (For You, Following, Search, etc.) with 2-step confirmation and instant state sync.
// @description:zh-CN 在 X (Twitter) 时间线 Grok 图标旁增加高辨识度关注/取关 (+ / ✓) 按钮，支持防误触二次确认与多卡同步。
// @author       haorui
// @homepageURL  https://github.com/haorui-lab/x-follow-flow
// @supportURL   https://github.com/haorui-lab/x-follow-flow/issues
// @downloadURL  https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js
// @updateURL    https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // Configuration
  // ==========================================
  const CONFIG = {
    confirmTimeoutMs: 3000,
    scanDebounceMs: 50,
    maxCaretWaitMs: 800
  };

  // High-Recognition Crisp SVG Icons (+ / ✓ / −)
  const ICONS = {
    // Sharp Bold Plus (+): Unfollowed state
    follow: `
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `,
    // Sharp Bold Checkmark (✓): Followed state
    following: `
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `,
    // Sharp Bold Minus (−): Unfollow confirmation state
    unfollowConfirm: `
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `,
    // Loading spinner
    loading: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" class="x-follow-spinner">
        <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
        <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
      </svg>
    `,
    // Failed indicator
    failed: `
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `,
    // Pending clock
    pending: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <circle cx="12" cy="12" r="9"/>
        <polyline points="12 7 12 12 15 15"/>
      </svg>
    `
  };

  // ==========================================
  // 1. Follow State Manager (Single Source of Truth)
  // ==========================================
  class FollowStateManager {
    constructor() {
      this.cache = new Map();
      this.listeners = new Set();
    }

    get(username) {
      if (!username) return null;
      return this.cache.get(username.toLowerCase()) || null;
    }

    set(username, state) {
      if (!username) return;
      const lower = username.toLowerCase();
      const prev = this.cache.get(lower) || {};
      const updated = {
        ...prev,
        ...state,
        username: lower,
        updatedAt: Date.now()
      };
      this.cache.set(lower, updated);
      this.notify(lower, updated);
      return updated;
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    notify(username, state) {
      for (const listener of this.listeners) {
        try {
          listener(username, state);
        } catch (err) {
          console.warn('[X-FollowFlow] Error in listener:', err);
        }
      }
    }
  }

  const stateManager = new FollowStateManager();

  // ==========================================
  // 2. Comprehensive Network Interceptor (Fetch + XHR)
  // ==========================================
  function extractUsersFromData(data) {
    if (!data || typeof data !== 'object') return;

    const isUserObj = data.__typename === 'User' || (data.rest_id && (data.legacy || data.relationship_perspectives));
    if (isUserObj) {
      const legacy = data.legacy || {};
      const screenName = (legacy.screen_name || data.screen_name || '').toLowerCase();
      if (screenName) {
        const existing = stateManager.get(screenName) || {};

        let followingState = existing.following;
        if (data.relationship_perspectives && data.relationship_perspectives.following !== undefined) {
          followingState = Boolean(data.relationship_perspectives.following);
        } else if (legacy.following !== undefined) {
          followingState = Boolean(legacy.following);
        } else if (data.following !== undefined) {
          followingState = Boolean(data.following);
        } else if (data.is_following !== undefined) {
          followingState = Boolean(data.is_following);
        }

        let pendingState = existing.pending;
        if (data.relationship_perspectives && data.relationship_perspectives.following_requested !== undefined) {
          pendingState = Boolean(data.relationship_perspectives.following_requested);
        } else if (legacy.following_requested !== undefined) {
          pendingState = Boolean(legacy.following_requested);
        } else if (data.following_requested !== undefined) {
          pendingState = Boolean(data.following_requested);
        }

        stateManager.set(screenName, {
          username: screenName,
          restId: String(data.rest_id || legacy.id_str || existing.restId || ''),
          following: followingState !== undefined ? Boolean(followingState) : false,
          pending: pendingState !== undefined ? Boolean(pendingState) : false,
          followedBy: legacy.followed_by !== undefined ? Boolean(legacy.followed_by) : (existing.followedBy || false)
        });
      }
    } else if (data.__typename === 'UserWithVisibilityResults' && data.user) {
      extractUsersFromData(data.user);
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        extractUsersFromData(item);
      }
    } else {
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'object' && data[key] !== null) {
          extractUsersFromData(data[key]);
        }
      }
    }
  }

  function initNetworkInterceptor() {
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (!win || win.__x_follow_network_hooked) return;
    win.__x_follow_network_hooked = true;

    // Check window.__INITIAL_STATE__
    if (win.__INITIAL_STATE__) {
      try {
        extractUsersFromData(win.__INITIAL_STATE__);
      } catch (e) {}
    }

    // 1. Hook Fetch
    const originalFetch = win.fetch;
    if (originalFetch) {
      win.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const url = String(args[0]?.url || args[0] || '');
          if (url.includes('/graphql') || url.includes('/friendships') || url.includes('/i/api/')) {
            const clone = response.clone();
            clone.json().then(data => {
              if (data) extractUsersFromData(data);
            }).catch(() => {});
          }
        } catch (err) {}
        return response;
      };
    }

    // 2. Hook XMLHttpRequest
    const originalOpen = win.XMLHttpRequest?.prototype?.open;
    const originalSend = win.XMLHttpRequest?.prototype?.send;
    if (originalOpen && originalSend) {
      win.XMLHttpRequest.prototype.open = function (...args) {
        this._x_url = String(args[1] || '');
        return originalOpen.apply(this, args);
      };

      win.XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
          try {
            if (this._x_url && (this._x_url.includes('/graphql') || this._x_url.includes('/friendships') || this._x_url.includes('/i/api/'))) {
              const data = JSON.parse(this.responseText);
              if (data) extractUsersFromData(data);
            }
          } catch (e) {}
        });
        return originalSend.apply(this, args);
      };
    }
  }

  // ==========================================
  // 3. React Tree & DOM Inspection (Target-Specific)
  // ==========================================
  let cachedCurrentUser = null;

  function getCurrentUser() {
    if (cachedCurrentUser) return cachedCurrentUser;

    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href && href.startsWith('/')) {
        const user = href.slice(1).split('/')[0].split('?')[0].toLowerCase();
        if (user && user !== 'profile') {
          cachedCurrentUser = user;
          return user;
        }
      }
    }

    const switcher = document.querySelector('div[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const text = switcher.textContent || '';
      const match = text.match(/@([A-Za-z0-9_]{1,15})/);
      if (match) {
        cachedCurrentUser = match[1].toLowerCase();
        return cachedCurrentUser;
      }
    }

    return null;
  }

  function isFollowingTabActive() {
    const activeTab = document.querySelector('div[role="tablist"] [role="tab"][aria-selected="true"]');
    if (activeTab) {
      const text = activeTab.textContent.trim().toLowerCase();
      if (text.includes('following') || text.includes('正在关注')) {
        return true;
      }
    }
    return false;
  }

  function extractUsernameFromTweet(tweetArticle) {
    const userNameEl = tweetArticle.querySelector('div[data-testid="User-Name"]');
    if (!userNameEl) return null;

    const links = userNameEl.querySelectorAll('a[role="link"][href^="/"]');
    const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose']);

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const path = href.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].split('#')[0];
      const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (match) {
        const candidate = match[1].toLowerCase();
        if (!reserved.has(candidate)) {
          return candidate;
        }
      }
    }

    const text = userNameEl.textContent || '';
    const handleMatch = text.match(/@([A-Za-z0-9_]{1,15})/);
    if (handleMatch) {
      return handleMatch[1].toLowerCase();
    }

    return null;
  }

  // Searches React Props & State specifically matching targetAuthor
  function searchReactTreeForUser(obj, targetAuthor, depth = 0, visited = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    if (visited.has(obj)) return null;
    visited.add(obj);

    const target = (targetAuthor || '').toLowerCase();
    const legacy = obj.legacy;
    const rel = obj.relationship_perspectives;
    const screenName = (legacy?.screen_name || obj.screen_name || '').toLowerCase();

    // ONLY match if screenName matches targetAuthor
    if (screenName && screenName === target) {
      let following = undefined;
      if (rel && rel.following !== undefined) {
        following = Boolean(rel.following);
      } else if (legacy && legacy.following !== undefined) {
        following = Boolean(legacy.following);
      } else if (obj.following !== undefined) {
        following = Boolean(obj.following);
      } else if (obj.is_following !== undefined) {
        following = Boolean(obj.is_following);
      }

      if (following !== undefined) {
        return {
          username: screenName,
          following,
          pending: Boolean(rel?.following_requested || legacy?.following_requested || obj.following_requested),
          restId: String(obj.rest_id || legacy?.id_str || '')
        };
      }
    }

    // Check Caret menu actions specifically for targetAuthor
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === 'object') {
          const text = String(item.text || item.title || item.label || '').toLowerCase();
          if (text.includes(`@${target}`)) {
            if (text.includes('unfollow') || text.includes('取消关注')) {
              return { username: target, following: true };
            }
            if (text.includes('follow') || text.includes('关注')) {
              return { username: target, following: false };
            }
          }
        }
      }
    }

    for (const key of Object.keys(obj)) {
      if (key === 'children' && depth > 3) continue;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const found = searchReactTreeForUser(obj[key], target, depth + 1, visited);
        if (found) return found;
      }
    }
    return null;
  }

  function inspectFollowState(tweetArticle, author) {
    if (!tweetArticle || !author) return null;

    // 1. Inspect elements specifically bound to author
    const authorLinks = tweetArticle.querySelectorAll(`a[href="/${author}" i], a[href^="/${author}?" i]`);
    const caret = tweetArticle.querySelector('button[data-testid="caret"]');
    const avatarEl = tweetArticle.querySelector('div[data-testid="Tweet-User-Avatar"]');
    const userNameEl = tweetArticle.querySelector('div[data-testid="User-Name"]');
    const elements = [...authorLinks, caret, avatarEl, userNameEl, tweetArticle].filter(Boolean);

    for (const el of elements) {
      const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (propsKey && el[propsKey]) {
        const found = searchReactTreeForUser(el[propsKey], author);
        if (found) return found;
      }

      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey && el[fiberKey]) {
        let fiber = el[fiberKey];
        let depth = 0;
        while (fiber && depth < 25) {
          if (fiber.memoizedProps) {
            const found = searchReactTreeForUser(fiber.memoizedProps, author);
            if (found) return found;
          }
          if (fiber.memoizedState) {
            const found = searchReactTreeForUser(fiber.memoizedState, author);
            if (found) return found;
          }
          fiber = fiber.return;
          depth++;
        }
      }
    }

    return null;
  }

  // 4. HoverCard Observer: Auto-captures ground truth when hovercard opens
  function initHoverCardObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const hoverCard = node.matches && (node.matches('[data-testid="HoverCard"]') ? node : node.querySelector('[data-testid="HoverCard"]'));
            if (hoverCard) {
              const userLink = hoverCard.querySelector('a[href^="/"][role="link"]');
              const href = userLink?.getAttribute('href') || '';
              const match = href.match(/^\/([A-Za-z0-9_]{1,15})/);
              if (match) {
                const username = match[1].toLowerCase();
                const isUnfollowBtn = hoverCard.querySelector('[data-testid$="-unfollow"]');
                const isFollowBtn = hoverCard.querySelector('[data-testid$="-follow"]');
                const text = hoverCard.textContent || '';
                const isFollowing = Boolean(isUnfollowBtn) || text.includes('正在关注') || text.includes('Following');
                const isNotFollowing = Boolean(isFollowBtn) || (text.includes('关注') && !text.includes('正在关注'));

                if (isFollowing) {
                  stateManager.set(username, { following: true, pending: false });
                } else if (isNotFollowing) {
                  stateManager.set(username, { following: false, pending: false });
                }
              }
            }
          }
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // Fast silent Caret inspection fallback
  async function peekCaretFollowState(tweetElement, username) {
    const caret = tweetElement.querySelector('button[data-testid="caret"]');
    if (!caret) return null;

    document.body.classList.add('x-follow-silent-mode');
    try {
      triggerClick(caret);
      let menu = null;
      const start = Date.now();
      while (Date.now() - start < 200) {
        menu = document.querySelector('div[role="menu"], div[data-testid="Dropdown"]');
        if (menu) break;
        await sleep(20);
      }

      let result = null;
      if (menu) {
        const text = (menu.textContent || '').toLowerCase();
        if (text.includes(`@${username}`)) {
          if (text.includes('unfollow') || text.includes('取消关注')) {
            result = true;
          } else if (text.includes('follow') || text.includes('关注')) {
            result = false;
          }
        }
        triggerClick(caret); // Close menu
      }
      document.body.classList.remove('x-follow-silent-mode');
      return result;
    } catch (e) {
      document.body.classList.remove('x-follow-silent-mode');
      return null;
    }
  }

  // ==========================================
  // 4. Action Executor (Native Caret + API Fallback)
  // ==========================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
    return match ? decodeURIComponent(match[3]) : null;
  }

  function triggerClick(element) {
    if (!element) return;
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.click();
  }

  async function executeActionViaCaret(tweetElement, username, isFollow) {
    const caret = tweetElement.querySelector('button[data-testid="caret"]');
    if (!caret) return false;

    document.body.classList.add('x-follow-silent-mode');

    try {
      triggerClick(caret);

      let menu = null;
      const start = Date.now();
      while (Date.now() - start < CONFIG.maxCaretWaitMs) {
        menu = document.querySelector('div[role="menu"], div[data-testid="Dropdown"]');
        if (menu) break;
        await sleep(40);
      }

      if (!menu) {
        document.body.classList.remove('x-follow-silent-mode');
        return false;
      }

      const menuItems = Array.from(menu.querySelectorAll('[role="menuitem"], div[tabindex="0"]'));
      let targetItem = null;

      for (const item of menuItems) {
        const text = (item.textContent || '').toLowerCase();
        const containsHandle = text.includes(`@${username}`);

        if (isFollow) {
          const isFollowText = text.includes('follow') || text.includes('关注') || text.includes('seguir') || text.includes('suivre') || text.includes('フォロー');
          const isExcluded = text.includes('unfollow') || text.includes('取消关注') || text.includes('mute') || text.includes('block') || text.includes('静音') || text.includes('屏蔽') || text.includes('list');
          if ((containsHandle && isFollowText && !isExcluded) || (isFollowText && !isExcluded)) {
            targetItem = item;
            break;
          }
        } else {
          const isUnfollowText = text.includes('unfollow') || text.includes('取消关注') || text.includes('dejar de seguir') || text.includes('ne plus suivre') || text.includes('フォロー解除');
          if (isUnfollowText) {
            targetItem = item;
            break;
          }
        }
      }

      if (!targetItem) {
        triggerClick(caret);
        document.body.classList.remove('x-follow-silent-mode');
        return false;
      }

      triggerClick(targetItem);

      if (!isFollow) {
        const confirmStart = Date.now();
        while (Date.now() - confirmStart < CONFIG.maxCaretWaitMs) {
          const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (confirmBtn) {
            triggerClick(confirmBtn);
            break;
          }
          await sleep(40);
        }
      }

      await sleep(100);
      document.body.classList.remove('x-follow-silent-mode');
      return true;
    } catch (err) {
      document.body.classList.remove('x-follow-silent-mode');
      return false;
    }
  }

  async function executeActionViaAPI(username, isFollow, restId) {
    const ct0 = getCookie('ct0');
    if (!ct0) return false;

    const endpoint = isFollow
      ? 'https://x.com/i/api/1.1/friendships/create.json'
      : 'https://x.com/i/api/1.1/friendships/destroy.json';

    const params = new URLSearchParams();
    if (restId) {
      params.append('user_id', restId);
    }
    params.append('screen_name', username);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-csrf-token': ct0,
          'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session'
        },
        body: params.toString(),
        credentials: 'include'
      });

      return response.ok;
    } catch (e) {
      return false;
    }
  }

  async function executeFollowToggle(tweetElement, username, targetFollowState) {
    const isFollow = targetFollowState === true;
    const cached = stateManager.get(username);
    const restId = cached?.restId || '';

    const caretSuccess = await executeActionViaCaret(tweetElement, username, isFollow);
    if (caretSuccess) {
      stateManager.set(username, { following: isFollow, pending: false });
      return true;
    }

    const apiSuccess = await executeActionViaAPI(username, isFollow, restId);
    if (apiSuccess) {
      stateManager.set(username, { following: isFollow, pending: false });
      return true;
    }

    return false;
  }

  // ==========================================
  // 5. UI Component (High-Recognition Icons)
  // ==========================================
  function injectStyles() {
    if (document.getElementById('x-followflow-styles')) return;

    const style = document.createElement('style');
    style.id = 'x-followflow-styles';
    style.textContent = `
      body.x-follow-silent-mode div[role="menu"],
      body.x-follow-silent-mode div[data-testid="Dropdown"],
      body.x-follow-silent-mode div[data-testid="confirmationSheetDialog"],
      body.x-follow-silent-mode div[data-testid="sheetDialog"],
      body.x-follow-silent-mode div[data-testid="mask"] {
        opacity: 0 !important;
        pointer-events: auto !important;
        transition: none !important;
      }

      /* Container */
      .x-followflow-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin: 0 4px;
        flex-shrink: 0;
        vertical-align: middle;
      }

      /* Base Icon Button */
      .x-followflow-icon-btn {
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        outline: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #71767b;
        transition: color 0.15s ease;
        position: relative;
      }

      /* Circular Badge Frame: Clean 30x30px with subtle border */
      .x-followflow-icon-wrapper {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: 9999px;
        transition: all 0.2s ease;
        border: 1px solid transparent;
      }

      /* Unfollowed (+): Subtle muted frame, blue hover */
      .x-followflow-icon-btn.x-state-follow .x-followflow-icon-wrapper {
        color: #71767b;
        border-color: rgba(113, 118, 123, 0.3);
        background-color: transparent;
      }
      .x-followflow-icon-btn.x-state-follow:hover .x-followflow-icon-wrapper {
        color: #1d9bf0;
        border-color: #1d9bf0;
        background-color: rgba(29, 155, 240, 0.12);
        transform: scale(1.08);
      }

      /* Followed (✓): Distinctive High-Recognition Verified/Checkmark Green/Blue */
      .x-followflow-icon-btn.x-state-following .x-followflow-icon-wrapper {
        color: #00ba7c;
        border-color: rgba(0, 186, 124, 0.4);
        background-color: rgba(0, 186, 124, 0.08);
      }
      .x-followflow-icon-btn.x-state-following:hover .x-followflow-icon-wrapper {
        color: #f4212e;
        border-color: #f4212e;
        background-color: rgba(244, 33, 46, 0.12);
        transform: scale(1.08);
      }

      /* Confirming Unfollow (−): Bold Red Alert */
      .x-followflow-icon-btn.x-state-confirm .x-followflow-icon-wrapper {
        color: #ffffff;
        border-color: #f4212e;
        background-color: #f4212e;
        transform: scale(1.12);
        box-shadow: 0 0 8px rgba(244, 33, 46, 0.4);
      }

      /* Loading */
      .x-followflow-icon-btn.x-state-loading {
        cursor: wait;
        opacity: 0.7;
        pointer-events: none;
      }
      .x-follow-spinner {
        animation: x-spin 0.85s linear infinite;
      }
      @keyframes x-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* Failed */
      .x-followflow-icon-btn.x-state-failed .x-followflow-icon-wrapper {
        color: #f4212e;
        border-color: #f4212e;
        background-color: rgba(244, 33, 46, 0.15);
      }

      /* Pending */
      .x-followflow-icon-btn.x-state-pending .x-followflow-icon-wrapper {
        color: #71767b;
        border-color: #71767b;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createFollowIconButton(tweetElement, username, initialFollowing, initialPending) {
    const container = document.createElement('div');
    container.className = 'x-followflow-container';
    container.setAttribute('data-x-author', username);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-followflow-icon-btn';

    const wrapper = document.createElement('div');
    wrapper.className = 'x-followflow-icon-wrapper';
    btn.appendChild(wrapper);
    container.appendChild(btn);

    let currentState = initialPending ? 'PENDING' : (initialFollowing ? 'FOLLOWING' : 'NOT_FOLLOWING');
    let confirmTimer = null;

    function renderUI() {
      btn.className = 'x-followflow-icon-btn';

      if (currentState === 'NOT_FOLLOWING') {
        btn.classList.add('x-state-follow');
        wrapper.innerHTML = ICONS.follow;
        btn.title = `+ 关注 @${username}`;
      } else if (currentState === 'FOLLOWING') {
        btn.classList.add('x-state-following');
        wrapper.innerHTML = ICONS.following;
        btn.title = `✓ 正在关注 @${username} (点击可取消关注)`;
      } else if (currentState === 'CONFIRMING_UNFOLLOW') {
        btn.classList.add('x-state-confirm');
        wrapper.innerHTML = ICONS.unfollowConfirm;
        btn.title = `再次点击确认取消关注 @${username}`;
      } else if (currentState === 'LOADING') {
        btn.classList.add('x-state-loading');
        wrapper.innerHTML = ICONS.loading;
        btn.title = '处理中...';
      } else if (currentState === 'FAILED') {
        btn.classList.add('x-state-failed');
        wrapper.innerHTML = ICONS.failed;
        btn.title = '操作失败';
      } else if (currentState === 'PENDING') {
        btn.classList.add('x-state-pending');
        wrapper.innerHTML = ICONS.pending;
        btn.title = '已发送关注请求 (等待通过)';
      }
    }

    renderUI();

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (currentState === 'NOT_FOLLOWING') {
        currentState = 'LOADING';
        renderUI();
        const success = await executeFollowToggle(tweetElement, username, true);
        if (success) {
          currentState = 'FOLLOWING';
        } else {
          currentState = 'FAILED';
          renderUI();
          setTimeout(() => {
            if (currentState === 'FAILED') {
              currentState = 'NOT_FOLLOWING';
              renderUI();
            }
          }, 1500);
          return;
        }
        renderUI();
      } else if (currentState === 'FOLLOWING') {
        currentState = 'CONFIRMING_UNFOLLOW';
        renderUI();
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          if (currentState === 'CONFIRMING_UNFOLLOW') {
            currentState = 'FOLLOWING';
            renderUI();
          }
        }, CONFIG.confirmTimeoutMs);
      } else if (currentState === 'CONFIRMING_UNFOLLOW') {
        if (confirmTimer) clearTimeout(confirmTimer);
        currentState = 'LOADING';
        renderUI();
        const success = await executeFollowToggle(tweetElement, username, false);
        if (success) {
          currentState = 'NOT_FOLLOWING';
        } else {
          currentState = 'FAILED';
          renderUI();
          setTimeout(() => {
            if (currentState === 'FAILED') {
              currentState = 'FOLLOWING';
              renderUI();
            }
          }, 1500);
          return;
        }
        renderUI();
      }
    });

    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('mouseup', (e) => e.stopPropagation());

    const unsubscribe = stateManager.subscribe((changedUsername, state) => {
      if (changedUsername !== username) return;
      if (currentState === 'LOADING') return;

      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }

      if (state.pending) {
        currentState = 'PENDING';
      } else if (state.following) {
        currentState = 'FOLLOWING';
      } else {
        currentState = 'NOT_FOLLOWING';
      }
      renderUI();
    });

    container._unsubscribe = unsubscribe;
    container._updateState = (following, pending) => {
      if (currentState === 'LOADING') return;
      if (pending) currentState = 'PENDING';
      else if (following) currentState = 'FOLLOWING';
      else currentState = 'NOT_FOLLOWING';
      renderUI();
    };

    return container;
  }

  // ==========================================
  // 6. Placement & Mutation Observer
  // ==========================================
  function insertFollowIcon(tweetArticle, buttonContainer) {
    // 1. Look for Grok button in tweet header or action bar
    const grokBtn = tweetArticle.querySelector('button[aria-label*="grok" i], [data-testid*="grok" i]');
    if (grokBtn) {
      let grokWrapper = grokBtn;
      while (grokWrapper.parentElement && !grokWrapper.parentElement.matches('div[role="group"], div[data-testid="User-Name"]')) {
        grokWrapper = grokWrapper.parentElement;
      }
      if (grokWrapper.parentElement) {
        grokWrapper.parentElement.insertBefore(buttonContainer, grokWrapper);
        return;
      }
    }

    // 2. Look for Header Caret button (top-right next to ...)
    const caret = tweetArticle.querySelector('button[data-testid="caret"]');
    if (caret) {
      let caretWrapper = caret;
      const userNameEl = tweetArticle.querySelector('div[data-testid="User-Name"]');
      if (userNameEl) {
        while (caretWrapper.parentElement && caretWrapper.parentElement !== userNameEl) {
          caretWrapper = caretWrapper.parentElement;
        }
        if (caretWrapper.parentElement === userNameEl) {
          userNameEl.insertBefore(buttonContainer, caretWrapper);
          return;
        }
      }
    }

    // 3. Fallback: Action bar (div[role="group"])
    const actionBar = tweetArticle.querySelector('div[role="group"]');
    if (actionBar) {
      const bookmark = actionBar.querySelector('[data-testid="bookmark"], [data-testid="removeBookmark"]');
      if (bookmark) {
        let bWrapper = bookmark;
        if (bookmark.parentElement && bookmark.parentElement !== actionBar) {
          bWrapper = bookmark.parentElement;
        }
        if (bWrapper.nextSibling) {
          actionBar.insertBefore(buttonContainer, bWrapper.nextSibling);
        } else {
          actionBar.appendChild(buttonContainer);
        }
        return;
      }
      actionBar.appendChild(buttonContainer);
      return;
    }

    // 4. Default: User-Name container
    const userNameEl = tweetArticle.querySelector('div[data-testid="User-Name"]');
    if (userNameEl) {
      userNameEl.appendChild(buttonContainer);
    }
  }

  async function processTweet(tweetArticle) {
    if (!tweetArticle || !tweetArticle.isConnected) return;

    const author = extractUsernameFromTweet(tweetArticle);
    if (!author) return;

    const currentUser = getCurrentUser();
    if (currentUser && author === currentUser) {
      const existing = tweetArticle.querySelector('.x-followflow-container');
      if (existing) existing.remove();
      return;
    }

    const existingContainer = tweetArticle.querySelector('.x-followflow-container');
    if (existingContainer) {
      if (existingContainer.getAttribute('data-x-author') === author) {
        return;
      }
      if (existingContainer._unsubscribe) existingContainer._unsubscribe();
      existingContainer.remove();
    }

    // Follow state detection hierarchy
    let following = false;
    let pending = false;
    let resolved = false;

    // A. Check State Manager cache
    const cached = stateManager.get(author);
    if (cached) {
      following = cached.following;
      pending = cached.pending;
      resolved = true;
    }

    // B. Check React Tree / Fiber for this exact author
    if (!resolved) {
      const inspected = inspectFollowState(tweetArticle, author);
      if (inspected && inspected.following !== undefined) {
        following = inspected.following;
        pending = inspected.pending;
        resolved = true;
        stateManager.set(author, { following, pending, restId: inspected.restId });
      }
    }

    // C. Check Active Tab: in Following tab, default is true
    if (!resolved && isFollowingTabActive()) {
      following = true;
      resolved = true;
      stateManager.set(author, { following: true, pending: false });
    }

    const buttonContainer = createFollowIconButton(tweetArticle, author, following, pending);
    insertFollowIcon(tweetArticle, buttonContainer);

    // D. If still not resolved with 100% confidence, run silent peek
    if (!resolved) {
      setTimeout(async () => {
        if (!tweetArticle.isConnected) return;
        let finalState = stateManager.get(author);
        if (!finalState) {
          const recheck = inspectFollowState(tweetArticle, author);
          if (recheck && recheck.following !== undefined) {
            finalState = recheck;
          } else {
            // Run silent Caret peek ground truth check
            const peeked = await peekCaretFollowState(tweetArticle, author);
            if (peeked !== null) {
              finalState = { following: peeked, pending: false };
            }
          }
        }

        if (finalState && finalState.following !== undefined) {
          stateManager.set(author, finalState);
          if (buttonContainer._updateState) {
            buttonContainer._updateState(finalState.following, finalState.pending);
          }
        }
      }, 100);
    }
  }

  let scanScheduled = false;

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      const tweets = document.querySelectorAll('article[data-testid="tweet"]');
      for (const tweet of tweets) {
        processTweet(tweet);
      }
    }, CONFIG.scanDebounceMs);
  }

  function initObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches && (node.matches('article[data-testid="tweet"]') || node.querySelector('article[data-testid="tweet"]'))) {
                shouldScan = true;
                break;
              }
            }
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        scheduleScan();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // ==========================================
  // 7. SPA Navigation Support
  // ==========================================
  function initSPAHandler() {
    const handleUrlChange = () => {
      cachedCurrentUser = null;
      scheduleScan();
    };

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const res = originalPushState.apply(this, args);
      handleUrlChange();
      return res;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const res = originalReplaceState.apply(this, args);
      handleUrlChange();
      return res;
    };

    window.addEventListener('popstate', handleUrlChange);
  }

  // ==========================================
  // 8. Bootstrap
  // ==========================================
  function bootstrap() {
    initNetworkInterceptor();
    initSPAHandler();

    const startDOM = () => {
      injectStyles();
      initHoverCardObserver();
      initObserver();
      scheduleScan();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startDOM);
    } else {
      startDOM();
    }
  }

  bootstrap();
})();
