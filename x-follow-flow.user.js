// ==UserScript==
// @name         X FollowFlow
// @name:zh-CN   X FollowFlow - 推荐流关注/取关助手
// @namespace    https://github.com/haorui-lab/x-follow-flow
// @version      0.1.0
// @description  Add lightweight Follow / Unfollow buttons directly to X timelines (For You, Following, Search, etc.) with 2-step confirmation and instant state sync.
// @description:zh-CN 在 X (Twitter) 时间线（For You 推荐流、Following 等）每条推文作者栏直接显示关注状态并支持一键 Follow / Unfollow（防误触确认与多卡同步）。
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
    labels: {
      follow: '+ Follow',
      following: '✓ Following',
      followingHover: 'Unfollow',
      unfollowConfirm: 'Unfollow?',
      loadingFollow: 'Following...',
      loadingUnfollow: 'Unfollowing...',
      failed: 'Failed',
      pending: 'Pending'
    },
    confirmTimeoutMs: 3000,
    scanDebounceMs: 50,
    maxCaretWaitMs: 800
  };

  // ==========================================
  // 1. Follow State Manager (Single Source of Truth)
  // ==========================================
  class FollowStateManager {
    constructor() {
      // Map<username, { following: boolean, pending: boolean, restId: string, updatedAt: number }>
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
          console.warn('[X-Follow-Helper] Error in state listener:', err);
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

    if (data.__typename === 'User' || (data.rest_id && data.legacy && typeof data.legacy === 'object')) {
      const legacy = data.legacy || {};
      const screenName = (legacy.screen_name || data.screen_name || '').toLowerCase();
      if (screenName) {
        stateManager.set(screenName, {
          following: Boolean(legacy.following),
          pending: Boolean(legacy.following_requested),
          restId: String(data.rest_id || legacy.id_str || ''),
          followedBy: Boolean(legacy.followed_by)
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
      } catch (err) {
        // Silently ignore network inspection errors
      }
      return response;
    };
  }

  // ==========================================
  // 3. User & DOM Utilities
  // ==========================================
  let cachedCurrentUser = null;

  function getCurrentUser() {
    if (cachedCurrentUser) return cachedCurrentUser;

    // Check bottom/sidebar navigation profile link
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

    // Check account switcher button
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

  function extractUsernameFromElement(userNameEl) {
    if (!userNameEl) return null;

    // 1. Try finding link with href="/<username>" that is not status/hashtag
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

    // 2. Fallback to @handle text regex
    const text = userNameEl.textContent || '';
    const handleMatch = text.match(/@([A-Za-z0-9_]{1,15})/);
    if (handleMatch) {
      return handleMatch[1].toLowerCase();
    }

    return null;
  }

  function getAuthorFromReactFiber(tweetElement) {
    if (!tweetElement) return null;
    const fiberKey = Object.keys(tweetElement).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (!fiberKey) return null;

    let fiber = tweetElement[fiberKey];
    let depth = 0;
    while (fiber && depth < 30) {
      const props = fiber.memoizedProps;
      if (props) {
        const tweet = props.tweet || props.tweetResult?.result || props.item?.content?.tweet_results?.result;
        if (tweet) {
          const userResult = tweet.core?.user_results?.result;
          const user = userResult?.legacy || userResult?.user?.legacy;
          if (user && user.screen_name) {
            return {
              username: user.screen_name.toLowerCase(),
              restId: String(userResult.rest_id || user.id_str || ''),
              following: Boolean(user.following),
              pending: Boolean(user.following_requested),
              name: user.name || ''
            };
          }
        }
      }
      fiber = fiber.return;
      depth++;
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

    // Suppress visual popups during automated interaction
    document.body.classList.add('x-follow-silent-mode');

    try {
      triggerClick(caret);

      // Wait for menu dropdown
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

      // Find matching menu item
      const menuItems = Array.from(menu.querySelectorAll('[role="menuitem"], div[tabindex="0"]'));
      let targetItem = null;

      for (const item of menuItems) {
        const text = (item.textContent || '').toLowerCase();
        const containsHandle = text.includes(`@${username}`);

        if (isFollow) {
          // Look for follow action
          const isFollowText = text.includes('follow') || text.includes('关注') || text.includes('seguir') || text.includes('suivre') || text.includes('フォロー');
          const isExcluded = text.includes('unfollow') || text.includes('取消关注') || text.includes('mute') || text.includes('block') || text.includes('静音') || text.includes('屏蔽') || text.includes('list');
          if ((containsHandle && isFollowText && !isExcluded) || (isFollowText && !isExcluded)) {
            targetItem = item;
            break;
          }
        } else {
          // Look for unfollow action
          const isUnfollowText = text.includes('unfollow') || text.includes('取消关注') || text.includes('dejar de seguir') || text.includes('ne plus suivre') || text.includes('フォロー解除');
          if (isUnfollowText) {
            targetItem = item;
            break;
          }
        }
      }

      if (!targetItem) {
        triggerClick(caret); // Close menu
        document.body.classList.remove('x-follow-silent-mode');
        return false;
      }

      triggerClick(targetItem);

      // For unfollow: confirm modal may appear
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

      if (response.ok) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function executeFollowToggle(tweetElement, username, targetFollowState) {
    const isFollow = targetFollowState === true;
    const cached = stateManager.get(username);
    const restId = cached?.restId || '';

    // 1. Try Native Caret simulation first
    const caretSuccess = await executeActionViaCaret(tweetElement, username, isFollow);
    if (caretSuccess) {
      stateManager.set(username, { following: isFollow, pending: false });
      return true;
    }

    // 2. Fallback to direct Session API
    const apiSuccess = await executeActionViaAPI(username, isFollow, restId);
    if (apiSuccess) {
      stateManager.set(username, { following: isFollow, pending: false });
      return true;
    }

    return false;
  }

  // ==========================================
  // 5. UI Component & Style Injection
  // ==========================================
  function injectStyles() {
    if (document.getElementById('x-timeline-follow-styles')) return;

    const style = document.createElement('style');
    style.id = 'x-timeline-follow-styles';
    style.textContent = `
      /* Silent mode for invisible native menu interaction */
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
      .x-timeline-follow-container {
        display: inline-flex;
        align-items: center;
        margin-left: 6px;
        vertical-align: middle;
        flex-shrink: 0;
      }

      /* Button Base */
      .x-timeline-follow-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 700;
        line-height: 16px;
        min-width: 68px;
        height: 26px;
        padding: 0 10px;
        border-radius: 9999px;
        cursor: pointer;
        transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
        outline: none;
        box-sizing: border-box;
        white-space: nowrap;
        user-select: none;
      }

      /* State: Follow (+ Follow) */
      .x-timeline-follow-btn.x-state-follow {
        background-color: #0f1419;
        color: #ffffff;
        border: 1px solid rgba(0, 0, 0, 0);
      }
      .x-timeline-follow-btn.x-state-follow:hover {
        background-color: #272c30;
      }

      /* State: Following (✓ Following) */
      .x-timeline-follow-btn.x-state-following {
        background-color: transparent;
        color: #536471;
        border: 1px solid #cfd9de;
      }
      .x-timeline-follow-btn.x-state-following:hover {
        border-color: #fdc9ce;
        color: #f4212e;
        background-color: rgba(244, 33, 46, 0.06);
      }
      .x-timeline-follow-btn.x-state-following:hover .x-btn-label-following {
        display: none;
      }
      .x-timeline-follow-btn.x-state-following:hover .x-btn-label-hover {
        display: inline;
      }
      .x-timeline-follow-btn.x-state-following .x-btn-label-hover {
        display: none;
      }

      /* State: Confirming Unfollow (Unfollow?) */
      .x-timeline-follow-btn.x-state-confirm {
        background-color: rgba(244, 33, 46, 0.12);
        color: #f4212e;
        border: 1px solid #f4212e;
      }
      .x-timeline-follow-btn.x-state-confirm:hover {
        background-color: rgba(244, 33, 46, 0.22);
      }

      /* State: Loading */
      .x-timeline-follow-btn.x-state-loading {
        opacity: 0.6;
        cursor: wait;
        pointer-events: none;
      }

      /* State: Failed */
      .x-timeline-follow-btn.x-state-failed {
        background-color: rgba(244, 33, 46, 0.15);
        color: #f4212e;
        border: 1px solid #f4212e;
        cursor: default;
      }

      /* State: Pending */
      .x-timeline-follow-btn.x-state-pending {
        background-color: transparent;
        color: #71767b;
        border: 1px solid #71767b;
        cursor: default;
      }

      /* Dark / Dim mode responsive styles */
      @media (prefers-color-scheme: dark) {
        .x-timeline-follow-btn.x-state-follow {
          background-color: #eff3f4;
          color: #0f1419;
        }
        .x-timeline-follow-btn.x-state-follow:hover {
          background-color: #d7dbdc;
        }
        .x-timeline-follow-btn.x-state-following {
          color: #71767b;
          border: 1px solid #536471;
        }
      }

      body[style*="background-color: rgb(0, 0, 0)"] .x-timeline-follow-btn.x-state-follow,
      body[style*="background-color: rgb(21, 32, 43)"] .x-timeline-follow-btn.x-state-follow,
      html.dark .x-timeline-follow-btn.x-state-follow {
        background-color: #eff3f4;
        color: #0f1419;
      }
      body[style*="background-color: rgb(0, 0, 0)"] .x-timeline-follow-btn.x-state-follow:hover,
      body[style*="background-color: rgb(21, 32, 43)"] .x-timeline-follow-btn.x-state-follow:hover,
      html.dark .x-timeline-follow-btn.x-state-follow:hover {
        background-color: #d7dbdc;
      }
      body[style*="background-color: rgb(0, 0, 0)"] .x-timeline-follow-btn.x-state-following,
      body[style*="background-color: rgb(21, 32, 43)"] .x-timeline-follow-btn.x-state-following,
      html.dark .x-timeline-follow-btn.x-state-following {
        color: #71767b;
        border: 1px solid #536471;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function insertButtonIntoUserName(userNameEl, buttonContainer) {
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

  function createFollowButton(tweetElement, username, initialFollowing, initialPending) {
    const container = document.createElement('div');
    container.className = 'x-timeline-follow-container';
    container.setAttribute('data-x-author', username);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-timeline-follow-btn';
    container.appendChild(btn);

    let currentState = initialPending ? 'PENDING' : (initialFollowing ? 'FOLLOWING' : 'NOT_FOLLOWING');
    let confirmTimer = null;

    function renderUI() {
      btn.className = 'x-timeline-follow-btn';
      btn.innerHTML = '';

      if (currentState === 'NOT_FOLLOWING') {
        btn.classList.add('x-state-follow');
        btn.textContent = CONFIG.labels.follow;
        btn.title = `Follow @${username}`;
      } else if (currentState === 'FOLLOWING') {
        btn.classList.add('x-state-following');
        btn.title = `Following @${username}`;

        const normalSpan = document.createElement('span');
        normalSpan.className = 'x-btn-label-following';
        normalSpan.textContent = CONFIG.labels.following;

        const hoverSpan = document.createElement('span');
        hoverSpan.className = 'x-btn-label-hover';
        hoverSpan.textContent = CONFIG.labels.followingHover;

        btn.appendChild(normalSpan);
        btn.appendChild(hoverSpan);
      } else if (currentState === 'CONFIRMING_UNFOLLOW') {
        btn.classList.add('x-state-confirm');
        btn.textContent = CONFIG.labels.unfollowConfirm;
        btn.title = `Click again to unfollow @${username}`;
      } else if (currentState === 'LOADING_FOLLOW') {
        btn.classList.add('x-state-loading');
        btn.textContent = CONFIG.labels.loadingFollow;
      } else if (currentState === 'LOADING_UNFOLLOW') {
        btn.classList.add('x-state-loading');
        btn.textContent = CONFIG.labels.loadingUnfollow;
      } else if (currentState === 'FAILED') {
        btn.classList.add('x-state-failed');
        btn.textContent = CONFIG.labels.failed;
      } else if (currentState === 'PENDING') {
        btn.classList.add('x-state-pending');
        btn.textContent = CONFIG.labels.pending;
      }
    }

    renderUI();

    // Prevent clicking from bubbling to tweet card navigation
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (currentState === 'NOT_FOLLOWING') {
        currentState = 'LOADING_FOLLOW';
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
        // Step 1: Request confirmation
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
        // Step 2: Confirmed unfollow
        if (confirmTimer) clearTimeout(confirmTimer);
        currentState = 'LOADING_UNFOLLOW';
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

    // Subscribe to global state changes for this author
    const unsubscribe = stateManager.subscribe((changedUsername, state) => {
      if (changedUsername !== username) return;
      if (currentState === 'LOADING_FOLLOW' || currentState === 'LOADING_UNFOLLOW') return;

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

    // Cleanup subscription if container is removed
    container._unsubscribe = unsubscribe;
    return container;
  }

  // ==========================================
  // 6. Injection & Mutation Observer
  // ==========================================
  function processTweet(tweetArticle) {
    if (!tweetArticle || !tweetArticle.isConnected) return;

    const userNameEls = tweetArticle.querySelectorAll('div[data-testid="User-Name"]');
    if (!userNameEls.length) return;

    const currentUser = getCurrentUser();

    for (const userNameEl of userNameEls) {
      const existingContainer = userNameEl.querySelector('.x-timeline-follow-container');
      const author = extractUsernameFromElement(userNameEl);

      if (!author) continue;

      // Ignore current logged-in user
      if (currentUser && author === currentUser) {
        if (existingContainer) existingContainer.remove();
        continue;
      }

      // Check if button already belongs to this author
      if (existingContainer) {
        if (existingContainer.getAttribute('data-x-author') === author) {
          continue; // Already correctly injected
        }
        // Author recycled in virtual list, remove stale container
        if (existingContainer._unsubscribe) existingContainer._unsubscribe();
        existingContainer.remove();
      }

      // Determine initial follow state
      let following = false;
      let pending = false;
      const cached = stateManager.get(author);

      if (cached) {
        following = cached.following;
        pending = cached.pending;
      } else {
        // Fallback to React Fiber inspection
        const fiberData = getAuthorFromReactFiber(tweetArticle);
        if (fiberData && fiberData.username === author) {
          following = fiberData.following;
          pending = fiberData.pending;
          stateManager.set(author, fiberData);
        }
      }

      const buttonContainer = createFollowButton(tweetArticle, author, following, pending);
      insertButtonIntoUserName(userNameEl, buttonContainer);
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
      cachedCurrentUser = null; // Re-evaluate in case of account switch
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
