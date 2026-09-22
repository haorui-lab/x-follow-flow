// ==UserScript==
// @name         X FollowFlow
// @name:zh-CN   X FollowFlow - 推荐流关注/取关助手
// @namespace    https://github.com/haorui-lab/x-follow-flow
// @version      0.2.0
// @description  Add lightweight Follow / Unfollow icon button directly next to Grok on X timelines (For You, Following, Search, etc.) with 2-step confirmation and instant state sync.
// @description:zh-CN 在 X (Twitter) 时间线（For You 推荐流、Following 等）Grok 图标旁增加轻量关注/取关 Icon 按钮，支持防误触二次确认与多卡同步。
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

  // SVG Icons (Clean 24x24 paths, rendered at 18.5x18.5)
  const ICONS = {
    // Person with plus (+)
    follow: `
      <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="currentColor">
        <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    `,
    // Person with checkmark (✓)
    following: `
      <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="currentColor">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.59-1.59L17.17 11l-3.59 3.59 1.42 1.41 2.17-2.17 4.18 4.18 1.41-1.41z"/>
      </svg>
    `,
    // Person with minus (-) for unfollow confirmation
    unfollowConfirm: `
      <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="currentColor">
        <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-1h6v2H6zm9 3c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    `,
    // Loading spinner
    loading: `
      <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="none" stroke="currentColor" stroke-width="2.5" class="x-follow-spinner">
        <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
        <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
      </svg>
    `,
    // Error / Failed
    failed: `
      <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
    `,
    // Pending
    pending: `
      <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
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
  // 2. Network Interceptor (GraphQL & REST API)
  // ==========================================
  function extractUsersFromData(data) {
    if (!data || typeof data !== 'object') return;

    const isUserObj = data.__typename === 'User' || (data.rest_id && (data.legacy || data.relationship_perspectives));
    if (isUserObj) {
      const legacy = data.legacy || {};
      const screenName = (legacy.screen_name || data.screen_name || '').toLowerCase();
      if (screenName) {
        const existing = stateManager.get(screenName) || {};

        // Modern GraphQL: check relationship_perspectives, legacy, or root
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

    const originalFetch = win.fetch;
    win.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('/i/api/graphql/') || url.includes('/i/api/1.1/friendships/')) {
          const clone = response.clone();
          clone.json().then(data => {
            if (!data) return;
            if (url.includes('/friendships/create.json')) {
              const screenName = (data.screen_name || '').toLowerCase();
              if (screenName) {
                stateManager.set(screenName, {
                  following: true,
                  pending: Boolean(data.following_requested),
                  restId: String(data.id_str || '')
                });
              }
            } else if (url.includes('/friendships/destroy.json')) {
              const screenName = (data.screen_name || '').toLowerCase();
              if (screenName) {
                stateManager.set(screenName, {
                  following: false,
                  pending: false,
                  restId: String(data.id_str || '')
                });
              }
            } else {
              extractUsersFromData(data);
            }
          }).catch(() => {});
        }
      } catch (err) {}
      return response;
    };
  }

  // ==========================================
  // 3. React Tree & DOM Inspection (Fail-Safe State)
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

  function searchReactTreeForUser(obj, depth = 0, visited = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    if (visited.has(obj)) return null;
    visited.add(obj);

    const legacy = obj.legacy;
    const rel = obj.relationship_perspectives;
    if ((legacy && legacy.screen_name) || obj.screen_name) {
      const screenName = (legacy?.screen_name || obj.screen_name).toLowerCase();
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

    // Check Caret menu actions if stored in props
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === 'object') {
          const text = String(item.text || item.title || item.label || '').toLowerCase();
          if (text.includes('unfollow') || text.includes('取消关注')) {
            return { following: true };
          }
          if (text.includes('follow') || text.includes('关注')) {
            if (!text.includes('unfollow') && !text.includes('取消关注')) {
              return { following: false };
            }
          }
        }
      }
    }

    for (const key of Object.keys(obj)) {
      if (key === 'children' && depth > 2) continue;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const found = searchReactTreeForUser(obj[key], depth + 1, visited);
        if (found) return found;
      }
    }
    return null;
  }

  function inspectFollowState(tweetArticle, author) {
    if (!tweetArticle) return null;

    const caret = tweetArticle.querySelector('button[data-testid="caret"]');
    const userNameEl = tweetArticle.querySelector('div[data-testid="User-Name"]');
    const avatarEl = tweetArticle.querySelector('div[data-testid="Tweet-User-Avatar"]');
    const elements = [caret, userNameEl, avatarEl, tweetArticle].filter(Boolean);

    for (const el of elements) {
      const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (propsKey && el[propsKey]) {
        const found = searchReactTreeForUser(el[propsKey]);
        if (found && (found.username === author || found.following !== undefined)) {
          return found;
        }
      }

      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey && el[fiberKey]) {
        let fiber = el[fiberKey];
        let depth = 0;
        while (fiber && depth < 20) {
          if (fiber.memoizedProps) {
            const found = searchReactTreeForUser(fiber.memoizedProps);
            if (found && (found.username === author || found.following !== undefined)) {
              return found;
            }
          }
          fiber = fiber.return;
          depth++;
        }
      }
    }

    return null;
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
  // 5. UI Component (Icon next to Grok)
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

      /* Container matching X action bar items */
      .x-followflow-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
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

      /* Circular hover background matching native X action buttons */
      .x-followflow-icon-wrapper {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 9999px;
        transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
      }

      /* Hover on NOT_FOLLOWING (+ Follow) */
      .x-followflow-icon-btn.x-state-follow:hover .x-followflow-icon-wrapper {
        background-color: rgba(29, 155, 240, 0.1);
        color: rgb(29, 155, 240);
      }
      .x-followflow-icon-btn.x-state-follow:hover {
        color: rgb(29, 155, 240);
      }

      /* FOLLOWING: Subtle active blue/brand accent */
      .x-followflow-icon-btn.x-state-following {
        color: rgb(29, 155, 240);
      }
      .x-followflow-icon-btn.x-state-following:hover {
        color: rgb(244, 33, 46);
      }
      .x-followflow-icon-btn.x-state-following:hover .x-followflow-icon-wrapper {
        background-color: rgba(244, 33, 46, 0.1);
      }

      /* CONFIRMING UNFOLLOW: Red warning pulse */
      .x-followflow-icon-btn.x-state-confirm {
        color: rgb(244, 33, 46);
      }
      .x-followflow-icon-btn.x-state-confirm .x-followflow-icon-wrapper {
        background-color: rgba(244, 33, 46, 0.15);
        transform: scale(1.08);
      }

      /* LOADING SPINNER */
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

      /* FAILED */
      .x-followflow-icon-btn.x-state-failed {
        color: rgb(244, 33, 46);
      }
      .x-followflow-icon-btn.x-state-failed .x-followflow-icon-wrapper {
        background-color: rgba(244, 33, 46, 0.15);
      }

      /* PENDING */
      .x-followflow-icon-btn.x-state-pending {
        color: #71767b;
        cursor: default;
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
        btn.title = `Follow @${username}`;
      } else if (currentState === 'FOLLOWING') {
        btn.classList.add('x-state-following');
        wrapper.innerHTML = ICONS.following;
        btn.title = `Following @${username} (Click to unfollow)`;
      } else if (currentState === 'CONFIRMING_UNFOLLOW') {
        btn.classList.add('x-state-confirm');
        wrapper.innerHTML = ICONS.unfollowConfirm;
        btn.title = `Click again to confirm unfollow @${username}`;
      } else if (currentState === 'LOADING') {
        btn.classList.add('x-state-loading');
        wrapper.innerHTML = ICONS.loading;
        btn.title = 'Processing...';
      } else if (currentState === 'FAILED') {
        btn.classList.add('x-state-failed');
        wrapper.innerHTML = ICONS.failed;
        btn.title = 'Action failed';
      } else if (currentState === 'PENDING') {
        btn.classList.add('x-state-pending');
        wrapper.innerHTML = ICONS.pending;
        btn.title = 'Follow request pending';
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
    // 1. Primary: Locate Grok button in tweet
    const grokBtn = tweetArticle.querySelector('button[aria-label*="grok" i], [data-testid*="grok" i]');
    if (grokBtn) {
      let grokWrapper = grokBtn;
      if (grokBtn.parentElement && grokBtn.parentElement.getAttribute('role') !== 'group') {
        grokWrapper = grokBtn.parentElement;
      }
      if (grokWrapper.parentElement) {
        // Place right beside Grok
        grokWrapper.parentElement.insertBefore(buttonContainer, grokWrapper);
        return;
      }
    }

    // 2. Secondary: Locate action bar (div[role="group"])
    const actionBar = tweetArticle.querySelector('div[role="group"]');
    if (actionBar) {
      // Place next to Bookmark
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

      // Or right before Share
      const share = actionBar.querySelector('button[data-testid="share"], [aria-label*="share" i]');
      if (share) {
        let sWrapper = share;
        if (share.parentElement && share.parentElement !== actionBar) {
          sWrapper = share.parentElement;
        }
        actionBar.insertBefore(buttonContainer, sWrapper);
        return;
      }

      actionBar.appendChild(buttonContainer);
      return;
    }

    // 3. Fallback to User-Name area if action bar not yet mounted
    const userNameEl = tweetArticle.querySelector('div[data-testid="User-Name"]');
    if (userNameEl) {
      const caret = userNameEl.querySelector('button[data-testid="caret"]');
      if (caret) {
        let caretContainer = caret;
        while (caretContainer && caretContainer.parentElement !== userNameEl) {
          caretContainer = caretContainer.parentElement;
        }
        if (caretContainer && caretContainer.parentElement === userNameEl) {
          userNameEl.insertBefore(buttonContainer, caretContainer);
          return;
        }
      }
      const firstRow = userNameEl.firstElementChild || userNameEl;
      firstRow.appendChild(buttonContainer);
    }
  }

  function processTweet(tweetArticle) {
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
        return; // Already present
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

    // B. Check React Tree / Fiber
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

    // If unresolved, schedule a micro-check after React finishes mounting subcomponents
    if (!resolved) {
      setTimeout(() => {
        if (!tweetArticle.isConnected) return;
        const recheck = stateManager.get(author) || inspectFollowState(tweetArticle, author);
        if (recheck && recheck.following !== undefined) {
          stateManager.set(author, recheck);
          if (buttonContainer._updateState) {
            buttonContainer._updateState(recheck.following, recheck.pending);
          }
        }
      }, 250);
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
