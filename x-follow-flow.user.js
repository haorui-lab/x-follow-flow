// ==UserScript==
// @name         X FollowFlow
// @name:zh-CN   X FollowFlow - 推荐流关注/取关助手
// @namespace    https://github.com/haorui-lab/x-follow-flow
// @version      0.5.12
// @description  Add a native-style Follow / Unfollow icon beside Share, plus a header shortcut that triggers "Not interested in this post".
// @description:zh-CN 在 X 时间线分享按钮右侧增加关注/取关按钮，并在帖子右上角「···」左侧增加「对此帖子不感兴趣」快捷入口。
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
    scanDebounceMs: 50,
    maxCaretWaitMs: 800,
  // frown | thumb | funnel | eye
  notInterestedIcon: 'funnel'
  };

  const RESERVED_ROUTES = new Set([
    'home',
    'explore',
    'notifications',
    'messages',
    'i',
    'settings',
    'search',
    'compose',
    'login',
    'logout',
    'signup',
    'tos',
    'privacy',
    'about',
    'jobs',
    'download',
    'hashtag',
    'intent',
    'share',
    'account',
    'oauth',
    'welcome',
    'who_to_follow',
    'connect_people',
    'topics',
    'trends',
    'x',
    'help',
    'support',
    'developer',
    'live',
    'lists',
    'communities',
    'spaces',
    'premium',
    'verified',
    'verified-choose',
    'creator'
  ]);

  function isProfilePage(urlOrPath) {
    const path = (urlOrPath || (typeof window !== 'undefined' ? window.location.pathname : ''))
      .replace(/^https?:\/\/[^\/]+/, '')
      .split('?')[0]
      .split('#')[0];

    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return false;

    const firstSegment = segments[0].toLowerCase();
    if (RESERVED_ROUTES.has(firstSegment)) return false;

    // Twitter username format: 1-15 characters, alphanumeric + underscore
    if (!/^[a-z0-9_]{1,15}$/.test(firstSegment)) return false;

    // A user profile page is /${username} or /${username}/${profileTab}
    // E.g., /elonmusk, /elonmusk/with_replies, /elonmusk/highlights, /elonmusk/media, etc.
    // Tweet status pages (/status/...) or deeper paths are excluded.
    if (segments.length === 1) {
      return true;
    }
    if (segments.length === 2 && segments[1].toLowerCase() !== 'status') {
      return true;
    }

    return false;
  }

  const PROFILE_LABELS = new Set([
    'profile',
    '个人资料',
    '個人資料',
    'プロフィール',
    'perfil',
    'profil',
    'profilo',
    '프로필',
    'profiel',
    'profilim',
    'hồ sơ',
    'профиль'
  ]);

  const MORE_LABELS = new Set([
    'more',
    '更多',
    '更多选项',
    '更多選項',
    'その他',
    'más',
    'mas',
    'mehr',
    'plus',
    'altro',
    'meer',
    'mais',
    '더보기',
    'ещё',
    'еще',
    'więcej'
  ]);

  const UNFOLLOW_CONFIRM_LABELS = [
    'unfollow',
    '取消关注',
    '取消關注',
    'dejar de seguir',
    'ne plus suivre',
    'フォロー解除',
    '언팔로우',
    'entfolgen',
    'smetti di seguire',
    'deixar de seguir',
    'parar de seguir',
    'berhenti mengikuti',
    'отписаться'
  ];

  function usernameFromHref(href) {
    if (!href) return null;
    const path = String(href).replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0];
    const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (!match) return null;
    const candidate = match[1].toLowerCase();
    if (RESERVED_ROUTES.has(candidate)) return null;
    return candidate;
  }

  function usernameFromAlt(alt) {
    const match = String(alt || '').trim().match(/^@([A-Za-z0-9_]{1,15})$/);
    if (!match) return null;
    const candidate = match[1].toLowerCase();
    if (RESERVED_ROUTES.has(candidate)) return null;
    return candidate;
  }

  function readScreenName(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const legacy = obj.legacy || {};
    const core = obj.core || {};
    return String(core.screen_name || legacy.screen_name || obj.screen_name || '').toLowerCase();
  }

  /**
   * First match that belongs to this article, not a quoted article nested inside it.
   */
  function queryOwn(root, selector) {
    if (!root || typeof root.querySelector !== 'function') return null;
    if (typeof root.querySelectorAll !== 'function') return root.querySelector(selector);

    const nodes = root.querySelectorAll(selector);
    for (const el of nodes) {
      const owner = typeof el.closest === 'function' ? el.closest('article') : null;
      if (owner && typeof root.matches === 'function' && root.matches('article') && owner !== root) continue;
      return el;
    }
    return null;
  }

  function isTimelinePost(article) {
    if (!article || typeof article.querySelector !== 'function') return false;
    if (typeof article.matches === 'function' && article.matches('article[data-testid="tweet"]')) return true;
    if (queryOwn(article, '[data-engagement-action="share"], [data-engagement-action="reply"], [data-testid="reply"], [data-testid="like"], [data-testid="share"]')) {
      return true;
    }
    if (queryOwn(article, '[data-post-avatar], div[data-testid="User-Name"]')) return true;
    return false;
  }

  function collectTimelinePosts(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const posts = [];
    const articles = scope.querySelectorAll('article');
    for (const article of articles) {
      if (isTimelinePost(article)) posts.push(article);
    }
    return posts;
  }

  function isMoreLabel(label) {
    const text = String(label || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return false;
    if (/show more|显示更多|顯示更多|もっと見る|ver más|mehr anzeigen|voir plus|see more/.test(text)) return false;
    return MORE_LABELS.has(text);
  }

  function engagementControl(root) {
    if (!root || typeof root.querySelector !== 'function') return null;
    return root.querySelector('[data-engagement-action], [data-testid="reply"], [data-testid="like"], [data-testid="share"]');
  }

  // The whole post can sit inside role="group" on the rebuilt timeline.
  // Only the engagement row (reply / repost / like / share) is the action bar.
  function caretIsInActionBar(btn) {
    if (!btn || typeof btn.closest !== 'function') return false;
    let group = btn.closest('[role="group"]');
    while (group) {
      const control = engagementControl(group);
      if (control && typeof control.closest === 'function' && control.closest('[role="group"]') === group) {
        return true;
      }
      const parent = group.parentElement;
      group = parent && typeof parent.closest === 'function' ? parent.closest('[role="group"]') : null;
    }
    return false;
  }

  function findCaretButton(root) {
    if (!root || typeof root.querySelector !== 'function') return null;
    const legacy = root.querySelector('button[data-testid="caret"]');
    if (legacy && !caretIsInActionBar(legacy)) return legacy;

    try {
      const iconButtons = root.querySelectorAll('button:has(use[href="#icon-more-dots-hor"]), button:has(use[href*="icon-more-dots"])');
      for (const icon of iconButtons) {
        if (caretIsInActionBar(icon)) continue;
        return icon;
      }
    } catch (e) {}

    const buttons = root.querySelectorAll('button[aria-label], button[aria-haspopup="menu"], button[data-slot="xds-menu-trigger"]');
    let fallback = null;
    for (const btn of buttons) {
      if (caretIsInActionBar(btn)) continue;
      if (btn.closest && btn.closest('[data-engagement-action], .whitespace-pre-wrap')) continue;
      if (isMoreLabel(btn.getAttribute('aria-label'))) return btn;
      if (!fallback && (btn.getAttribute('aria-haspopup') === 'menu' || btn.getAttribute('data-slot') === 'xds-menu-trigger')) {
        fallback = btn;
      }
    }
    return fallback;
  }

  function findOpenMenu() {
    return document.querySelector('div[role="menu"], [role="menu"], div[data-testid="Dropdown"]');
  }

  function findConfirmButton() {
    const legacy = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (legacy) return legacy;

    const modals = document.querySelectorAll('[data-slot="xds-modal-surface"], [role="dialog"], [role="alertdialog"]');
    for (const modal of modals) {
      const modalText = (modal.textContent || '').toLowerCase();
      const talksAboutUnfollow = UNFOLLOW_CONFIRM_LABELS.some((item) => modalText.includes(item.toLowerCase()));
      if (!talksAboutUnfollow) continue;

      const buttons = modal.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const label = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!label) continue;
        if (UNFOLLOW_CONFIRM_LABELS.some((item) => label === item.toLowerCase() || label.includes(item.toLowerCase()))) {
          return btn;
        }
      }

      const footerButtons = modal.querySelectorAll('[data-slot="xds-modal-footer-actions"] button, [data-slot="xds-modal-footer"] button');
      if (footerButtons.length) return footerButtons[footerButtons.length - 1];
    }
    return null;
  }

  function removeAllFollowIcons() {
    const containers = document.querySelectorAll('.x-followflow-container');
    for (const container of containers) {
      if (container._unsubscribe) {
        try {
          container._unsubscribe();
        } catch (e) {}
      }
      container.remove();
    }
  }

  function removeAllNotInterestedIcons() {
    document.querySelectorAll('.x-not-interested-container').forEach((el) => el.remove());
  }

  // High-Recognition Crisp SVG Icons (+ / • / −) without outer borders
  const ICONS = {
    // Pure, sleek Plus (+) for Follow
    follow: `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `,
    // Subtle, minimalist micro-dot (•) for Following (soft and low-distraction)
    following: `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <circle cx="12" cy="12" r="2.0" fill="currentColor"/>
      </svg>
    `,
    // Pure, sleek Minus (−) for Confirming Unfollow
    unfollowConfirm: `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `,
    // Native-like Spinner
    loading: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" class="x-follow-spinner">
        <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
        <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
      </svg>
    `,
    // Error indicator
    failed: `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `,
    // Negative feedback icons. Shapes that are not already on a post. Switch with CONFIG.notInterestedIcon.
    frown: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="8"></circle>
        <circle cx="9" cy="10.2" r="0.9" fill="currentColor" stroke="none"></circle>
        <circle cx="15" cy="10.2" r="0.9" fill="currentColor" stroke="none"></circle>
        <path d="M8.7 15.4c.9-1.2 2-1.8 3.3-1.8s2.4.6 3.3 1.8"></path>
      </svg>
    `,
    thumb: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 10v12"></path>
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"></path>
        <path d="M7 10H4.33A2.31 2.31 0 0 0 2 12.31v7.38A2.31 2.31 0 0 0 4.33 22H7"></path>
      </svg>
    `,
    funnel: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4.5h16l-6 7.1v6.4l-4 1.5v-7.9L4 4.5z"></path>
      </svg>
    `,
    eye: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5z"></path>
        <circle cx="12" cy="12" r="2"></circle>
        <path d="M5 19 19 5"></path>
      </svg>
    `,
    done: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12.5 9.2 17 19 7"></path>
      </svg>
    `,
    // Pending clock
    pending: `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
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
      const screenName = readScreenName(data);
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
      const user = usernameFromHref(href) || (href && href.startsWith('/') ? href.slice(1).split('/')[0].split('?')[0].toLowerCase() : '');
      if (user && user !== 'profile' && !RESERVED_ROUTES.has(user)) {
        cachedCurrentUser = user;
        return user;
      }
    }

    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const text = switcher.textContent || '';
      const match = text.match(/@([A-Za-z0-9_]{1,15})/);
      if (match) {
        cachedCurrentUser = match[1].toLowerCase();
        return cachedCurrentUser;
      }
    }

    // Rebuilt X web: the profile nav item is a normal link labeled "Profile" / "个人资料".
    const scopes = [];
    const dock = document.querySelector('[data-slot="xds-dock"]');
    if (dock) scopes.push(dock);
    document.querySelectorAll('nav, header, [role="banner"]').forEach((el) => scopes.push(el));
    if (!scopes.length) scopes.push(document.body);

    for (const scope of scopes) {
      if (!scope || typeof scope.querySelectorAll !== 'function') continue;
      const anchors = scope.querySelectorAll('a[href^="/"]');
      for (const anchor of anchors) {
        const label = (anchor.getAttribute('aria-label') || anchor.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!PROFILE_LABELS.has(label)) continue;
        const user = usernameFromHref(anchor.getAttribute('href'));
        if (user) {
          cachedCurrentUser = user;
          return user;
        }
      }
    }

    const accountScope = dock || document.querySelector('header');
    if (accountScope) {
      const match = (accountScope.innerText || accountScope.textContent || '').match(/@([A-Za-z0-9_]{1,15})/);
      if (match && !RESERVED_ROUTES.has(match[1].toLowerCase())) {
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

  /**
   * Retweets / liked / followed-you contexts surface another user's tweet.
   * The timeline author is NOT necessarily someone you follow — even on Following tab.
   */
  function hasTweetSocialContext(tweetArticle) {
    if (!tweetArticle || typeof tweetArticle.querySelector !== 'function') return false;
    if (tweetArticle.querySelector('[data-testid="socialContext"]')) return true;

    // New app: a repost/like context icon sits above the author, outside the action bar.
    if (typeof tweetArticle.querySelectorAll === 'function') {
      const icons = tweetArticle.querySelectorAll('svg[data-icon="icon-repost"], svg[data-icon="icon-heart"]');
      for (const icon of icons) {
        if (typeof icon.closest === 'function' && icon.closest('[role="group"], [data-engagement-action]')) continue;
        return true;
      }
    }

    // Fallback when testid is missing: scan near the author header only (avoid post body)
    const userName = tweetArticle.querySelector('[data-testid="User-Name"]')
      || tweetArticle.querySelector('.x-middot-group');
    const scanRoot = userName?.parentElement?.parentElement || userName?.parentElement;
    if (!scanRoot) return false;
    const text = (scanRoot.textContent || '').toLowerCase();
    const markers = [
      'reposted', 'retweeted', 'liked',
      '转推了', '已转帖', '转帖了', '喜欢了',
      'reposteado', 'a retweeté', 'がリポスト'
    ];
    return markers.some((m) => text.includes(m));
  }

  /**
   * Following-tab heuristic is UI-only and never authoritative.
   * Skip entirely for social-context tweets (repost of unfollowed author, etc.).
   */
  function shouldApplyFollowingTabHint(tweetArticle, followingTabActive) {
    const onFollowingTab =
      typeof followingTabActive === 'boolean' ? followingTabActive : isFollowingTabActive();
    return onFollowingTab && !hasTweetSocialContext(tweetArticle);
  }

  function extractUsernameFromTweet(tweetArticle) {
    if (!tweetArticle || typeof tweetArticle.querySelector !== 'function') return null;

    const avatarImg = queryOwn(tweetArticle, '[data-post-avatar] img[alt^="@"]');
    const fromAlt = usernameFromAlt(avatarImg?.getAttribute?.('alt') || avatarImg?.alt);
    if (fromAlt) return fromAlt;

    const avatarLink = queryOwn(tweetArticle, '[data-post-avatar] a[href]');
    const fromAvatar = usernameFromHref(avatarLink?.getAttribute?.('href') || '');
    if (fromAvatar) return fromAvatar;

    const userNameEl = queryOwn(tweetArticle, 'div[data-testid="User-Name"]')
      || queryOwn(tweetArticle, '.x-middot-group');
    if (!userNameEl || typeof userNameEl.querySelectorAll !== 'function') return null;

    const links = userNameEl.querySelectorAll('a[href]');
    for (const link of links) {
      const user = usernameFromHref(link.getAttribute('href') || '');
      if (user) return user;
    }

    const text = userNameEl.textContent || '';
    const handleMatch = text.match(/@([A-Za-z0-9_]{1,15})/);
    if (handleMatch && !RESERVED_ROUTES.has(handleMatch[1].toLowerCase())) {
      return handleMatch[1].toLowerCase();
    }

    return null;
  }

  function searchReactTreeForUser(obj, targetAuthor, depth = 0, visited = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    if (visited.has(obj)) return null;
    visited.add(obj);

    const target = (targetAuthor || '').toLowerCase();
    const legacy = obj.legacy;
    const rel = obj.relationship_perspectives;
    const screenName = readScreenName(obj);

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

  /**
   * Resolve follow state from a HoverCard.
   * Prefer data-testid buttons. Never use whole-card text — labels like
   * "Following" / "正在关注" (follower stats) caused false "already following".
   */
  function resolveHoverCardFollowState(hoverCard) {
    if (!hoverCard) return null;

    const unfollowBtn = hoverCard.querySelector('[data-testid$="-unfollow"]');
    if (unfollowBtn) return true;

    // "-follow" does not match "-unfollow" (suffix check), but guard anyway
    const followBtns = hoverCard.querySelectorAll('[data-testid]');
    for (const el of followBtns) {
      const id = el.getAttribute('data-testid') || '';
      if (id.endsWith('-follow') && !id.endsWith('-unfollow')) {
        return false;
      }
    }

    // Fallback: exact button label only (not stats links / whole card text)
    const FOLLOWING_LABELS = new Set([
      'following', '正在关注', 'unfollow', '取消关注',
      'seguindo', 'abonné', 'フォロー中'
    ]);
    const NOT_FOLLOWING_LABELS = new Set([
      'follow', '关注', 'follow back', '回关',
      'seguir', 'suivre', 'フォロー'
    ]);

    const buttons = hoverCard.querySelectorAll('[role="button"], button');
    for (const btn of buttons) {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!label) continue;
      if (FOLLOWING_LABELS.has(label)) return true;
      if (NOT_FOLLOWING_LABELS.has(label)) return false;
    }

    return null;
  }

  function findHoverCardRoot(node) {
    if (!node || node.nodeType !== 1 || typeof node.matches !== 'function') return null;
    if (node.matches('[data-testid="HoverCard"]')) return node;
    const legacy = typeof node.querySelector === 'function' ? node.querySelector('[data-testid="HoverCard"]') : null;
    if (legacy) return legacy;

    const candidates = [];
    if (node.matches('[data-base-ui-portal], [role="presentation"][data-side]')) candidates.push(node);
    if (typeof node.querySelectorAll === 'function') {
      node.querySelectorAll('[data-base-ui-portal], [role="presentation"][data-side]').forEach((el) => candidates.push(el));
    }
    for (const card of candidates) {
      if (card.querySelector && card.querySelector('img[alt^="@"], a[href^="/"]')) return card;
    }
    return null;
  }

  function usernameFromHoverCard(hoverCard) {
    const img = hoverCard.querySelector && hoverCard.querySelector('img[alt^="@"]');
    const fromAlt = usernameFromAlt(img?.getAttribute?.('alt') || img?.alt);
    if (fromAlt) return fromAlt;

    const links = hoverCard.querySelectorAll ? hoverCard.querySelectorAll('a[href^="/"]') : [];
    for (const link of links) {
      const exact = usernameFromHref(link.getAttribute('href') || '');
      if (exact) return exact;
    }
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
      if (!match) continue;
      const candidate = match[1].toLowerCase();
      if (!RESERVED_ROUTES.has(candidate)) return candidate;
    }
    return null;
  }

  function initHoverCardObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const hoverCard = findHoverCardRoot(node);
            if (hoverCard) {
              const username = usernameFromHoverCard(hoverCard);
              if (username) {
                const following = resolveHoverCardFollowState(hoverCard);
                if (following !== null) {
                  stateManager.set(username, { following, pending: false });
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

  async function peekCaretFollowState(tweetElement, username) {
    const caret = findCaretButton(tweetElement);
    if (!caret) return null;

    document.body.classList.add('x-follow-silent-mode');
    try {
      triggerClick(caret);
      let menu = null;
      const start = Date.now();
      while (Date.now() - start < 200) {
        menu = findOpenMenu();
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
        triggerClick(caret);
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
    const opts = { bubbles: true, cancelable: true, view: window };
    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerdown', opts));
      element.dispatchEvent(new PointerEvent('pointerup', opts));
    }
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.click();
  }

  async function executeActionViaCaret(tweetElement, username, isFollow) {
    const caret = findCaretButton(tweetElement);
    if (!caret) return false;

    document.body.classList.add('x-follow-silent-mode');

    try {
      triggerClick(caret);

      let menu = null;
      const start = Date.now();
      while (Date.now() - start < CONFIG.maxCaretWaitMs) {
        menu = findOpenMenu();
        if (menu) break;
        await sleep(40);
      }

      if (!menu) {
        document.body.classList.remove('x-follow-silent-mode');
        return false;
      }

      const menuItems = Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, a, div[tabindex="0"]'));
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
          const confirmBtn = findConfirmButton();
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

    const path = isFollow ? 'friendships/create.json' : 'friendships/destroy.json';
    // Legacy web posts to x.com/i/api. The rebuilt client posts to api.x.com/1.1.
    const endpoints = [
      `https://x.com/i/api/1.1/${path}`,
      `https://api.x.com/1.1/${path}`,
      `https://twitter.com/i/api/1.1/${path}`
    ];

    const params = new URLSearchParams();
    if (restId) {
      params.append('user_id', restId);
    }
    params.append('screen_name', username);

    for (const endpoint of endpoints) {
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
        if (response.ok) return true;
      } catch (e) {}
    }
    return false;
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

  const NOT_INTERESTED_PHRASES = [
    ['对此帖子不感兴趣', 5],
    ['对此帖文不感兴趣', 5],
    ['对此帖不感兴趣', 5],
    ['not interested in this post', 5],
    ['not interested in this', 4],
    ['不感兴趣', 3],
    ['not interested', 3],
    ['no me interesa', 3],
    ['pas intéressé', 3],
    ['興味がない', 3],
    ['興味ありません', 3],
    ['nicht interessiert', 3],
    ['non mi interessa', 3],
    ['não tenho interesse', 3],
    ['관심 없음', 3],
    ['не интересно', 3],
    ['tidak tertarik', 3]
  ];

  function notInterestedScore(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized || normalized.length > 80) return 0;
    let best = 0;
    for (const [phrase, score] of NOT_INTERESTED_PHRASES) {
      if (normalized.includes(phrase.toLowerCase())) best = Math.max(best, score);
    }
    return best;
  }

  function menuItemText(el) {
    return (el?.getAttribute?.('aria-label') || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function pickNotInterestedItem(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    const nodes = root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, [role="button"]');
    let best = null;
    let bestScore = 0;
    let bestLen = Infinity;
    for (const el of nodes) {
      if (el.closest && el.closest('.x-not-interested-container, .x-followflow-container')) continue;
      const text = menuItemText(el);
      const score = notInterestedScore(text);
      if (score > bestScore || (score === bestScore && score > 0 && text.length < bestLen)) {
        best = el;
        bestScore = score;
        bestLen = text.length;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function findTransientUiRoot() {
    return findOpenMenu()
      || document.querySelector('[data-slot="xds-modal-surface"], [role="dialog"], [role="alertdialog"]');
  }

  async function executeNotInterested(tweetElement) {
    const caret = findCaretButton(tweetElement);
    if (!caret) return false;

    document.body.classList.add('x-follow-silent-mode');
    const seen = new Set();
    let clicks = 0;

    try {
      triggerClick(caret);
      const start = Date.now();
      while (Date.now() - start < CONFIG.maxCaretWaitMs && clicks < 2) {
        const root = findTransientUiRoot();
        const item = root && pickNotInterestedItem(root);
        if (item && !seen.has(item)) {
          seen.add(item);
          triggerClick(item);
          clicks += 1;
          await sleep(160);
          continue;
        }
        if (clicks > 0) break;
        await sleep(40);
      }

      if (!clicks) triggerClick(caret);
      await sleep(80);
      document.body.classList.remove('x-follow-silent-mode');
      return clicks > 0;
    } catch (err) {
      document.body.classList.remove('x-follow-silent-mode');
      return false;
    }
  }

  // ==========================================
  // 5. UI Component (Border-Free Native Icon Style)
  // ==========================================
  function injectStyles() {
    if (document.getElementById('x-followflow-styles')) return;

    const style = document.createElement('style');
    style.id = 'x-followflow-styles';
    style.textContent = `
      body.x-follow-silent-mode div[role="menu"],
      body.x-follow-silent-mode [role="menu"],
      body.x-follow-silent-mode div[data-testid="Dropdown"],
      body.x-follow-silent-mode div[data-testid="confirmationSheetDialog"],
      body.x-follow-silent-mode div[data-testid="sheetDialog"],
      body.x-follow-silent-mode div[data-testid="mask"],
      body.x-follow-silent-mode [role="dialog"],
      body.x-follow-silent-mode [role="alertdialog"],
      body.x-follow-silent-mode [data-slot="xds-modal-surface"],
      body.x-follow-silent-mode [data-slot="xds-modal-backdrop"] {
        opacity: 0 !important;
        pointer-events: auto !important;
        transition: none !important;
      }

      /* Header shortcut, sitting in the flex cluster immediately left of ··· */
      .x-not-interested-container {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto !important;
        width: 32px;
        min-width: 32px;
        height: 32px;
        overflow: visible;
        position: relative;
        z-index: 3;
      }
      .x-not-interested-container svg {
        width: 18px;
        height: 18px;
        display: block;
      }
      .x-not-interested-btn {
        width: 32px;
        height: 32px;
        border: none;
        padding: 0;
        margin: 0;
        background: transparent;
        color: #71767b;
        border-radius: 9999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      .x-not-interested-btn:hover {
        background: rgba(244, 33, 46, 0.1);
        color: #f4212e;
      }
      .x-not-interested-btn.x-state-loading {
        cursor: wait;
        opacity: 0.65;
        pointer-events: none;
      }
      .x-not-interested-btn.x-state-done {
        color: #71767b;
        pointer-events: none;
      }
      .x-not-interested-btn.x-state-failed {
        color: #f4212e;
        background: rgba(244, 33, 46, 0.12);
      }

      /* Container inside X action bar (div[role="group"]) */
      .x-followflow-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        user-select: none;
        position: relative;
        z-index: 2;
      }

      /* Base Icon Button: Exactly matching native action bar button (no outer border) */
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

      /* Circular hover background matches Twitter's 34x34px round hover button */
      .x-followflow-icon-wrapper {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 9999px;
        background: transparent;
        border: none;
        transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
      }
      .x-followflow-icon-wrapper svg {
        display: block;
      }

      /* NOT_FOLLOWING (+): Neutral gray icon, Twitter blue hover circle */
      .x-followflow-icon-btn.x-state-follow {
        color: #71767b;
      }
      .x-followflow-icon-btn.x-state-follow:hover .x-followflow-icon-wrapper {
        background-color: rgba(29, 155, 240, 0.1);
        color: #1d9bf0;
      }
      .x-followflow-icon-btn.x-state-follow:hover {
        color: #1d9bf0;
      }

      /* FOLLOWING (•): Soft, low-contrast dot that gracefully recedes into the background */
      .x-followflow-icon-btn.x-state-following {
        color: #71767b;
      }
      .x-followflow-icon-btn.x-state-following .x-icon-normal {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
        opacity: 0.5;
        transition: opacity 0.15s ease;
      }
      .x-followflow-icon-btn.x-state-following .x-icon-hover {
        display: none;
        align-items: center;
        justify-content: center;
        line-height: 0;
      }
      .x-followflow-icon-btn.x-state-following:hover .x-icon-normal {
        display: none;
      }
      .x-followflow-icon-btn.x-state-following:hover .x-icon-hover {
        display: inline-flex;
      }
      .x-followflow-icon-btn.x-state-following:hover .x-followflow-icon-wrapper {
        background-color: rgba(244, 33, 46, 0.1);
        color: #f4212e;
      }
      .x-followflow-icon-btn.x-state-following:hover {
        color: #f4212e;
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
        color: #f4212e;
      }
      .x-followflow-icon-btn.x-state-failed .x-followflow-icon-wrapper {
        background-color: rgba(244, 33, 46, 0.15);
      }

      /* PENDING */
      .x-followflow-icon-btn.x-state-pending {
        color: #71767b;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createFollowIconButton(tweetElement, username, initialFollowing, initialPending) {
    const container = document.createElement('div');
    container.className = 'x-followflow-container';
    container.setAttribute('data-x-author', username);
    container.setAttribute('data-navigation-stop', '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-followflow-icon-btn';

    const wrapper = document.createElement('div');
    wrapper.className = 'x-followflow-icon-wrapper';
    btn.appendChild(wrapper);
    container.appendChild(btn);

    let currentState = initialPending ? 'PENDING' : (initialFollowing ? 'FOLLOWING' : 'NOT_FOLLOWING');

    function renderUI() {
      btn.className = 'x-followflow-icon-btn';
      wrapper.innerHTML = '';

      if (currentState === 'NOT_FOLLOWING') {
        btn.classList.add('x-state-follow');
        wrapper.innerHTML = ICONS.follow;
        btn.title = `+ 关注 @${username}`;
      } else if (currentState === 'FOLLOWING') {
        btn.classList.add('x-state-following');
        // Normal: Micro-dot (•); Hover: Minus (−). Click while hovered (−) unfollows immediately.
        const normalSpan = document.createElement('span');
        normalSpan.className = 'x-icon-normal';
        normalSpan.innerHTML = ICONS.following;

        const hoverSpan = document.createElement('span');
        hoverSpan.className = 'x-icon-hover';
        hoverSpan.innerHTML = ICONS.unfollowConfirm;

        wrapper.appendChild(normalSpan);
        wrapper.appendChild(hoverSpan);
        btn.title = `● 已关注 @${username}（悬停显示 −，点击取消关注）`;
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
        // Hover already reveals − as the affordance; one click unfollows immediately.
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
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('pointerup', (e) => e.stopPropagation());
    container.addEventListener('click', (e) => e.stopPropagation());
    container.addEventListener('pointerdown', (e) => e.stopPropagation());

    const unsubscribe = stateManager.subscribe((changedUsername, state) => {
      if (changedUsername !== username) return;
      if (currentState === 'LOADING') return;

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

  function notInterestedIconSvg() {
    return ICONS[CONFIG.notInterestedIcon] || ICONS.funnel;
  }

  function createNotInterestedButton(tweetElement) {
    const container = document.createElement('div');
    container.className = 'x-not-interested-container';
    container.setAttribute('data-navigation-stop', '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-not-interested-btn';
    btn.title = '对此帖子不感兴趣';
    btn.setAttribute('aria-label', '对此帖子不感兴趣');
    btn.innerHTML = notInterestedIconSvg();
    container.appendChild(btn);

    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    container.addEventListener('click', stop);
    container.addEventListener('pointerdown', (event) => event.stopPropagation());
    btn.addEventListener('pointerdown', (event) => event.stopPropagation());
    btn.addEventListener('mousedown', (event) => event.stopPropagation());

    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.classList.contains('x-state-loading') || btn.classList.contains('x-state-done')) return;
      btn.classList.add('x-state-loading');
      btn.innerHTML = ICONS.loading;
      const ok = await executeNotInterested(tweetElement);
      btn.classList.remove('x-state-loading');
      if (ok) {
        btn.classList.add('x-state-done');
        btn.innerHTML = ICONS.done;
        btn.title = '已标记为不感兴趣';
      } else {
        btn.classList.add('x-state-failed');
        btn.innerHTML = ICONS.failed;
        btn.title = '操作失败';
        setTimeout(() => {
          if (!btn.isConnected) return;
          btn.classList.remove('x-state-failed');
          btn.innerHTML = notInterestedIconSvg();
          btn.title = '对此帖子不感兴趣';
        }, 1500);
      }
    });

    return container;
  }

  function processNotInterested(tweetArticle) {
    if (!tweetArticle || !tweetArticle.isConnected) return;
    if (isProfilePage()) return;

    const author = extractUsernameFromTweet(tweetArticle);
    const currentUser = getCurrentUser();
    const existing = queryOwn(tweetArticle, '.x-not-interested-container');
    if (currentUser && author && author === currentUser) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const caret = findCaretButton(tweetArticle);
    if (!caret || !caret.parentElement) return;
    if (caretIsInActionBar(caret)) return;

    caret.parentElement.insertBefore(createNotInterestedButton(tweetArticle), caret);
  }

  // ==========================================
  // 6. Placement (Directly to the RIGHT of Share)
  // ==========================================
  function findActionBar(tweetArticle) {
    const bars = [];
    if (typeof tweetArticle.querySelectorAll === 'function') {
      for (const el of tweetArticle.querySelectorAll('[role="group"]')) {
        const owner = typeof el.closest === 'function' ? el.closest('article') : null;
        if (owner && owner !== tweetArticle) continue;
        bars.push(el);
      }
    } else {
      const el = tweetArticle.querySelector?.('[role="group"]');
      if (el) bars.push(el);
    }
    return bars.find((bar) => bar.querySelector?.('[data-engagement-action], [data-testid="reply"], [data-testid="like"], [data-testid="share"]')) || bars[0] || null;
  }

  function findControl(root, selectors) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function insertBeside(actionBar, anchor, buttonContainer) {
    // New app keeps Share inside the trailing flex cluster (next to Bookmark).
    // Drop the icon immediately after that Share control.
    const engagement = typeof anchor.closest === 'function' ? anchor.closest('[data-engagement-action]') : null;
    const cluster = engagement && engagement.parentElement;
    if (cluster && cluster.parentElement === actionBar && cluster.classList && cluster.classList.contains('flex')) {
      if (engagement.nextSibling) cluster.insertBefore(buttonContainer, engagement.nextSibling);
      else cluster.appendChild(buttonContainer);
      return true;
    }

    let wrapper = anchor;
    while (wrapper.parentElement && wrapper.parentElement !== actionBar) {
      wrapper = wrapper.parentElement;
    }
    if (wrapper.parentElement === actionBar) {
      if (wrapper.nextSibling) actionBar.insertBefore(buttonContainer, wrapper.nextSibling);
      else actionBar.appendChild(buttonContainer);
      return true;
    }
    return false;
  }

  function insertFollowIcon(tweetArticle, buttonContainer) {
    // 1. Primary target: action bar, directly to the RIGHT of Share
    const actionBar = findActionBar(tweetArticle);
    if (actionBar) {
      const share = findControl(actionBar, [
        '[data-engagement-action="share"]',
        'button[data-testid="share"]',
        'button[data-testid*="share" i]',
        '[aria-label*="share" i]',
        '[aria-label*="分享" i]',
        '[aria-label*="共有" i]'
      ]);
      if (share && insertBeside(actionBar, share, buttonContainer)) return;

      const bookmark = findControl(actionBar, [
        '[data-engagement-action="bookmark"]',
        'button[data-testid="bookmark"]',
        'button[data-testid="removeBookmark"]',
        '[aria-label*="bookmark" i]',
        '[aria-label*="书签" i]',
        '[aria-label*="書籤" i]'
      ]);
      if (bookmark && insertBeside(actionBar, bookmark, buttonContainer)) return;

      const grokBtn = findControl(actionBar, [
        'button[aria-label*="grok" i]',
        '[data-testid*="grok" i]'
      ]);
      if (grokBtn && insertBeside(actionBar, grokBtn, buttonContainer)) return;

      actionBar.appendChild(buttonContainer);
      return;
    }

    // 2. Fallback to the author header if the action bar is not mounted yet
    const userNameEl = queryOwn(tweetArticle, 'div[data-testid="User-Name"]')
      || queryOwn(tweetArticle, '.x-middot-group');
    if (userNameEl) {
      const caret = findCaretButton(userNameEl) || findCaretButton(tweetArticle);
      if (caret && userNameEl.contains(caret)) {
        let caretWrapper = caret;
        while (caretWrapper.parentElement && caretWrapper.parentElement !== userNameEl) {
          caretWrapper = caretWrapper.parentElement;
        }
        if (caretWrapper.parentElement === userNameEl) {
          userNameEl.insertBefore(buttonContainer, caretWrapper);
          return;
        }
      }
      userNameEl.appendChild(buttonContainer);
    }
  }

  async function processTweet(tweetArticle) {
    if (!tweetArticle || !tweetArticle.isConnected) return;

    if (isProfilePage()) {
      const existing = queryOwn(tweetArticle, '.x-followflow-container');
      if (existing) {
        if (existing._unsubscribe) {
          try { existing._unsubscribe(); } catch (e) {}
        }
        existing.remove();
      }
      return;
    }

    const author = extractUsernameFromTweet(tweetArticle);
    if (!author) return;

    const currentUser = getCurrentUser();
    if (currentUser && author === currentUser) {
      const existing = queryOwn(tweetArticle, '.x-followflow-container');
      if (existing) existing.remove();
      return;
    }

    const existingContainer = queryOwn(tweetArticle, '.x-followflow-container');
    if (existingContainer) {
      if (existingContainer.getAttribute('data-x-author') === author) {
        const bar = findActionBar(tweetArticle);
        if (bar && !bar.contains(existingContainer)) {
          insertFollowIcon(tweetArticle, existingContainer);
        }
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

    // C. Following tab: weak UI hint ONLY — never mark resolved, never write cache.
    // Retweets/social context must not assume the embedded author is followed.
    if (!resolved && shouldApplyFollowingTabHint(tweetArticle)) {
      following = true;
    }

    const buttonContainer = createFollowIconButton(tweetArticle, author, following, pending);
    insertFollowIcon(tweetArticle, buttonContainer);

    // D. If still not resolved with 100% confidence, run silent peek / re-inspect
    if (!resolved) {
      setTimeout(async () => {
        if (!tweetArticle.isConnected) return;
        let finalState = stateManager.get(author);
        if (!finalState) {
          const recheck = inspectFollowState(tweetArticle, author);
          if (recheck && recheck.following !== undefined) {
            finalState = recheck;
          } else {
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
      if (isProfilePage()) {
        removeAllFollowIcons();
        removeAllNotInterestedIcons();
      }
      const tweets = collectTimelinePosts(document);
      for (const tweet of tweets) {
        if (isProfilePage()) continue;
        processTweet(tweet);
        processNotInterested(tweet);
      }
    }, CONFIG.scanDebounceMs);
  }

  function subtreeHas(node, selector) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches && node.matches(selector)) return true;
    return !!(node.querySelector && node.querySelector(selector));
  }

  function initObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        // The header cluster is redrawn after hydration and drops foreign nodes.
        // Putting the shortcut back is what keeps the eye visible.
        const added = mutation.addedNodes;
        const removed = mutation.removedNodes;
        for (let i = 0; i < added.length; i++) {
          if (subtreeHas(added[i], 'article, button[aria-label], use[href="#icon-more-dots-hor"], use[href*="icon-more-dots"]')) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) break;
        for (let i = 0; i < removed.length; i++) {
          if (subtreeHas(removed[i], '.x-not-interested-container, article')) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) scheduleScan();
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
      if (isProfilePage()) {
        removeAllFollowIcons();
        removeAllNotInterestedIcons();
      }
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
      // Hydration redraws the header once, after the first scan.
      setTimeout(scheduleScan, 700);
      setTimeout(scheduleScan, 2000);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startDOM);
    } else {
      startDOM();
    }
  }

  bootstrap();
})();
