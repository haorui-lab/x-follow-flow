import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cookie parsing utility
 */
export function getCookie(cookieString, name) {
  const match = cookieString.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

/**
 * Recursively extracts user relationship data from X GraphQL / REST API JSON responses.
 * Supports legacy attributes, modern relationship_perspectives, and root user fields.
 */
export function extractUsersFromGraphQLResponse(data, results = new Map()) {
  if (!data || typeof data !== 'object') {
    return results;
  }

  // Check if current node is a User object
  const isUserObj = data.__typename === 'User' || (data.rest_id && (data.legacy || data.relationship_perspectives));
  if (isUserObj) {
    const legacy = data.legacy || {};
    const core = data.core || {};
    const screenName = (core.screen_name || legacy.screen_name || data.screen_name || '').toLowerCase();
    if (screenName) {
      const existing = results.get(screenName) || {};

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

      results.set(screenName, {
        ...existing,
        username: screenName,
        restId: String(data.rest_id || legacy.id_str || existing.restId || ''),
        following: followingState !== undefined ? Boolean(followingState) : false,
        pending: pendingState !== undefined ? Boolean(pendingState) : false,
        followedBy: legacy.followed_by !== undefined ? Boolean(legacy.followed_by) : (existing.followedBy || false),
        name: legacy.name || existing.name || ''
      });
    }
  } else if (data.__typename === 'UserWithVisibilityResults' && data.user) {
    extractUsersFromGraphQLResponse(data.user, results);
  }

  // Recurse into arrays and objects
  if (Array.isArray(data)) {
    for (const item of data) {
      extractUsersFromGraphQLResponse(item, results);
    }
  } else {
    for (const key of Object.keys(data)) {
      if (typeof data[key] === 'object' && data[key] !== null) {
        extractUsersFromGraphQLResponse(data[key], results);
      }
    }
  }

  return results;
}

/**
 * Searches React Fiber / Props tree specifically for targetAuthor
 */
export function searchReactTreeForUser(obj, targetAuthor, depth = 0, visited = new WeakSet()) {
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  if (visited.has(obj)) return null;
  visited.add(obj);

  const target = (targetAuthor || '').toLowerCase();
  const legacy = obj.legacy;
  const rel = obj.relationship_perspectives;
  const core = obj.core;
  const screenName = (core?.screen_name || legacy?.screen_name || obj.screen_name || '').toLowerCase();

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

  // Recurse into children
  for (const key of Object.keys(obj)) {
    if (key === 'children' && depth > 3) continue;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const found = searchReactTreeForUser(obj[key], target, depth + 1, visited);
      if (found) return found;
    }
  }
  return null;
}

export function usernameFromHref(href) {
  if (!href) return null;
  const path = String(href).replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0];
  const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
  if (!match) return null;
  const candidate = match[1].toLowerCase();
  if (RESERVED_ROUTES.has(candidate)) return null;
  return candidate;
}

export function usernameFromAlt(alt) {
  const match = String(alt || '').trim().match(/^@([A-Za-z0-9_]{1,15})$/);
  if (!match) return null;
  const candidate = match[1].toLowerCase();
  if (RESERVED_ROUTES.has(candidate)) return null;
  return candidate;
}

/**
 * Mirrors the userscript's post-author resolution order:
 * avatar alt, avatar href, header profile link, @handle text.
 */
export function resolvePostAuthor({ avatarAlt = '', avatarHref = '', headerLinks = [], headerText = '' } = {}) {
  return usernameFromAlt(avatarAlt)
    || usernameFromHref(avatarHref)
    || extractUsernameFromLinks(headerLinks, headerText);
}

export function isTimelinePost(article) {
  if (!article || typeof article.querySelector !== 'function') return false;
  if (typeof article.matches === 'function' && article.matches('article[data-testid="tweet"]')) return true;
  const own = (selector) => {
    if (typeof article.querySelectorAll !== 'function') return article.querySelector(selector);
    const nodes = article.querySelectorAll(selector);
    for (const el of nodes) {
      const owner = typeof el.closest === 'function' ? el.closest('article') : null;
      if (owner && typeof article.matches === 'function' && article.matches('article') && owner !== article) continue;
      return el;
    }
    return null;
  };
  if (own('[data-engagement-action="share"], [data-engagement-action="reply"], [data-testid="reply"], [data-testid="like"], [data-testid="share"]')) {
    return true;
  }
  if (own('[data-post-avatar], div[data-testid="User-Name"]')) return true;
  return false;
}

export const RESERVED_ROUTES = new Set([
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

/**
 * Determines whether a URL or path represents the home timeline (/home)
 */
export function isHomePage(urlOrPath) {
  const path = (urlOrPath || (typeof window !== 'undefined' ? window.location.pathname : ''))
    .replace(/^https?:\/\/[^\/]+/, '')
    .split('?')[0]
    .split('#')[0];

  const segments = path.split('/').filter(Boolean);
  return segments.length === 1 && segments[0].toLowerCase() === 'home';
}

/**
 * Extracts username from User-Name links or text
 */
export function extractUsernameFromLinks(links, textContent = '') {
  for (const href of links) {
    if (!href) continue;
    const path = href.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].split('#')[0];
    const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (match) {
      const candidate = match[1].toLowerCase();
      if (!RESERVED_ROUTES.has(candidate)) {
        return candidate;
      }
    }
  }

  const handleMatch = textContent.match(/@([A-Za-z0-9_]{1,15})/);
  if (handleMatch) {
    return handleMatch[1].toLowerCase();
  }

  return null;
}

/**
 * FollowStateManager manages global follow states and notifications
 */
export class FollowStateManager {
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
        console.error('Error in state listener:', err);
      }
    }
  }
}

/**
 * Detect retweet / social-context wrappers on a tweet article stub.
 */
export function hasTweetSocialContext(tweetArticle) {
  if (!tweetArticle || typeof tweetArticle.querySelector !== 'function') return false;
  if (tweetArticle.querySelector('[data-testid="socialContext"]')) return true;

  if (typeof tweetArticle.querySelectorAll === 'function') {
    const icons = tweetArticle.querySelectorAll('svg[data-icon="icon-repost"], svg[data-icon="icon-heart"]');
    for (const icon of icons) {
      if (typeof icon.closest === 'function' && icon.closest('[role="group"], [data-engagement-action]')) continue;
      return true;
    }
  }

  const userName = tweetArticle.querySelector('[data-testid="User-Name"]')
    || (typeof tweetArticle.querySelector === 'function' ? tweetArticle.querySelector('.x-middot-group') : null);
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
 * Following-tab hint must never apply to social-context tweets.
 */
export function shouldApplyFollowingTabHint(tweetArticle, followingTabActive) {
  return Boolean(followingTabActive) && !hasTweetSocialContext(tweetArticle);
}

/**
 * Resolve follow state from HoverCard DOM-like structure.
 * Must ignore whole-card stats text ("Following" / "正在关注" counts).
 */
export function resolveHoverCardFollowState(hoverCard) {
  if (!hoverCard || typeof hoverCard.querySelector !== 'function') return null;

  const unfollowBtn = hoverCard.querySelector('[data-testid$="-unfollow"]');
  if (unfollowBtn) return true;

  if (typeof hoverCard.querySelectorAll === 'function') {
    const followBtns = hoverCard.querySelectorAll('[data-testid]');
    for (const el of followBtns) {
      const id = (el.getAttribute && el.getAttribute('data-testid')) || el.dataset?.testid || '';
      if (id.endsWith('-follow') && !id.endsWith('-unfollow')) {
        return false;
      }
    }

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
  }

  return null;
}

/**
 * ButtonStateMachine simulates the button state transitions.
 * Unfollow is one-click: hover reveals −, click executes immediately.
 */
export class ButtonStateMachine {
  constructor({ username, initialFollowing = false, initialPending = false, onAction, onStateChange }) {
    this.username = username;
    this.state = initialPending ? 'PENDING' : (initialFollowing ? 'FOLLOWING' : 'NOT_FOLLOWING');
    this.onAction = onAction;
    this.onStateChange = onStateChange;
  }

  setState(newState) {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }

  async handleClick() {
    if (this.state === 'NOT_FOLLOWING') {
      this.setState('FOLLOWING_IN_PROGRESS');
      const success = await this.onAction('FOLLOW');
      if (success) {
        this.setState('FOLLOWING');
      } else {
        this.setState('FAILED');
        setTimeout(() => this.setState('NOT_FOLLOWING'), 1500);
      }
    } else if (this.state === 'FOLLOWING') {
      this.setState('UNFOLLOWING_IN_PROGRESS');
      const success = await this.onAction('UNFOLLOW');
      if (success) {
        this.setState('NOT_FOLLOWING');
      } else {
        this.setState('FAILED');
        setTimeout(() => this.setState('FOLLOWING'), 1500);
      }
    }
  }

  handleExternalStateChange(following, pending) {
    if (this.state === 'FOLLOWING_IN_PROGRESS' || this.state === 'UNFOLLOWING_IN_PROGRESS') {
      return;
    }
    if (pending) {
      this.setState('PENDING');
    } else if (following) {
      this.setState('FOLLOWING');
    } else {
      this.setState('NOT_FOLLOWING');
    }
  }

  destroy() {}
}

// ==================== Tests ====================

test('getCookie extracts cookie values correctly', () => {
  const cookieStr = 'guest_id=123; ct0=a1b2c3d4e5f6; twid=u%3D98765; auth_token=secret';
  assert.equal(getCookie(cookieStr, 'ct0'), 'a1b2c3d4e5f6');
  assert.equal(getCookie(cookieStr, 'twid'), 'u=98765');
  assert.equal(getCookie(cookieStr, 'nonexistent'), null);
});

test('extractUsersFromGraphQLResponse parses relationship_perspectives correctly', () => {
  const modernResponse = {
    data: {
      tweet: {
        core: {
          user_results: {
            result: {
              __typename: 'User',
              rest_id: '44196397',
              relationship_perspectives: {
                following: true,
                followed_by: false
              },
              legacy: {
                screen_name: 'lxfater',
                name: '铁锤人'
              }
            }
          }
        }
      }
    }
  };

  const users = extractUsersFromGraphQLResponse(modernResponse);
  assert.equal(users.size, 1);
  const user = users.get('lxfater');
  assert.ok(user);
  assert.equal(user.following, true);
  assert.equal(user.restId, '44196397');
});

test('searchReactTreeForUser specifically targets author and ignores other users', () => {
  // Tree containing current viewer (not following self) AND author lxfater (followed)
  const mockTree = {
    viewer: {
      legacy: { screen_name: 'current_user', following: false }
    },
    tweet: {
      author: {
        legacy: { screen_name: 'lxfater' },
        relationship_perspectives: { following: true }
      }
    }
  };

  // Searching for lxfater should find following: true, NOT viewer's following: false
  const found = searchReactTreeForUser(mockTree, 'lxfater');
  assert.ok(found);
  assert.equal(found.username, 'lxfater');
  assert.equal(found.following, true);

  // Caret items for lxfater
  const caretTree = {
    items: [
      { text: 'Unfollow @lxfater' }
    ]
  };
  const foundCaret = searchReactTreeForUser(caretTree, 'lxfater');
  assert.ok(foundCaret);
  assert.equal(foundCaret.following, true);
});

test('extractUsernameFromLinks resolves authors accurately', () => {
  const links1 = ['/elonmusk', '/elonmusk', '/elonmusk/status/18382746182947192'];
  assert.equal(extractUsernameFromLinks(links1), 'elonmusk');

  const links2 = ['/home', '/notifications', '/satyanadella'];
  assert.equal(extractUsernameFromLinks(links2), 'satyanadella');

  const links3 = [];
  const text3 = 'OpenAI @OpenAI · 2h';
  assert.equal(extractUsernameFromLinks(links3, text3), 'openai');
});

test('FollowStateManager syncs updates to multiple subscribers', () => {
  const manager = new FollowStateManager();
  const receivedUpdates = [];

  const unsubscribe = manager.subscribe((username, state) => {
    receivedUpdates.push({ username, state });
  });

  manager.set('lxfater', { following: true, restId: '44196397' });
  manager.set('sama', { following: false, restId: '12345' });

  assert.equal(receivedUpdates.length, 2);
  assert.equal(receivedUpdates[0].username, 'lxfater');
  assert.equal(receivedUpdates[0].state.following, true);
  assert.equal(receivedUpdates[1].username, 'sama');
  assert.equal(receivedUpdates[1].state.following, false);

  assert.equal(manager.get('lxfater').following, true);
  assert.equal(manager.get('sama').following, false);

  unsubscribe();
});

test('ButtonStateMachine unfollows on a single click from FOLLOWING', async () => {
  let actionCalled = null;

  const machine = new ButtonStateMachine({
    username: 'lxfater',
    initialFollowing: true,
    onAction: async (act) => {
      actionCalled = act;
      return true;
    }
  });

  assert.equal(machine.state, 'FOLLOWING');

  // One click on FOLLOWING (hover already shows −) -> unfollow immediately
  await machine.handleClick();
  assert.equal(actionCalled, 'UNFOLLOW');
  assert.equal(machine.state, 'NOT_FOLLOWING');

  // Click on NOT_FOLLOWING -> follow
  await machine.handleClick();
  assert.equal(actionCalled, 'FOLLOW');
  assert.equal(machine.state, 'FOLLOWING');
});

test('Following-tab hint skips retweets and never treats social context as followed', () => {
  function makeTweet({ hasSocialContextTestId = false, headerText = '' }) {
    const userName = {
      textContent: 'Author @b',
      parentElement: {
        parentElement: { textContent: headerText }
      }
    };
    return {
      querySelector(sel) {
        if (sel === '[data-testid="socialContext"]') {
          return hasSocialContextTestId ? { textContent: 'A reposted' } : null;
        }
        if (sel === '[data-testid="User-Name"]') return userName;
        return null;
      }
    };
  }

  const original = makeTweet({ headerText: 'Author @b · 2h' });
  const retweetByTestId = makeTweet({
    hasSocialContextTestId: true,
    headerText: 'Friend reposted Author @b'
  });
  const retweetByCopy = makeTweet({ headerText: '好友 转推了 Author @b' });

  assert.equal(hasTweetSocialContext(original), false);
  assert.equal(hasTweetSocialContext(retweetByTestId), true);
  assert.equal(hasTweetSocialContext(retweetByCopy), true);

  // On Following tab: original may use weak hint; retweet must not
  assert.equal(shouldApplyFollowingTabHint(original, true), true);
  assert.equal(shouldApplyFollowingTabHint(retweetByTestId, true), false);
  assert.equal(shouldApplyFollowingTabHint(retweetByCopy, true), false);

  // Off Following tab: never hint
  assert.equal(shouldApplyFollowingTabHint(original, false), false);
  assert.equal(shouldApplyFollowingTabHint(retweetByTestId, false), false);
});

test('resolveHoverCardFollowState uses buttons, ignores stats labels', () => {
  function makeHoverCard({ testIds = [], buttonTexts = [], bodyText = '' }) {
    const testIdEls = testIds.map((id) => ({
      getAttribute: (name) => (name === 'data-testid' ? id : null),
      dataset: { testid: id },
      textContent: ''
    }));
    const buttonEls = buttonTexts.map((text) => ({
      getAttribute: () => null,
      textContent: text
    }));

    return {
      textContent: bodyText,
      querySelector(sel) {
        if (sel === '[data-testid$="-unfollow"]') {
          return testIdEls.find((el) => el.getAttribute('data-testid').endsWith('-unfollow')) || null;
        }
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '[data-testid]') return testIdEls;
        if (sel === '[role="button"], button') return buttonEls;
        return [];
      }
    };
  }

  // Bug repro: "关注" button + stats "正在关注 12" must NOT be treated as following
  assert.equal(
    resolveHoverCardFollowState(
      makeHoverCard({
        testIds: ['12345-follow'],
        bodyText: 'kodo @tarik06784901 关注者 3 正在关注 12 关注'
      })
    ),
    false
  );

  assert.equal(
    resolveHoverCardFollowState(
      makeHoverCard({
        testIds: ['12345-unfollow'],
        bodyText: 'Someone 关注者 10 正在关注 5 正在关注'
      })
    ),
    true
  );

  // Fallback: exact button label only
  assert.equal(
    resolveHoverCardFollowState(
      makeHoverCard({
        buttonTexts: ['关注'],
        bodyText: '关注者 1 正在关注 2'
      })
    ),
    false
  );

  // Stats text alone must not decide
  assert.equal(
    resolveHoverCardFollowState(
      makeHoverCard({
        buttonTexts: [],
        bodyText: '关注者 1 正在关注 2 Following 3'
      })
    ),
    null
  );
});

test('isHomePage matches only /home and excludes search, status, profile, and other routes', () => {
  // Home timeline (should be true)
  assert.equal(isHomePage('/home'), true);
  assert.equal(isHomePage('/home/'), true);
  assert.equal(isHomePage('/HOME'), true);
  assert.equal(isHomePage('https://x.com/home'), true);
  assert.equal(isHomePage('https://x.com/home/'), true);
  assert.equal(isHomePage('https://twitter.com/home?tab=following'), true);
  assert.equal(isHomePage('https://x.com/home#top'), true);

  // Non-home routes (should be false)
  assert.equal(isHomePage('/search?q=test'), false);
  assert.equal(isHomePage('https://x.com/search?q=home&src=typed_query'), false);
  assert.equal(isHomePage('/elonmusk/status/18382746182947192'), false);
  assert.equal(isHomePage('/elonmusk/article/18382746182947192'), false);
  assert.equal(isHomePage('/i/web/status/18382746182947192'), false);
  assert.equal(isHomePage('/elonmusk'), false);
  assert.equal(isHomePage('/elonmusk/with_replies'), false);
  assert.equal(isHomePage('/explore'), false);
  assert.equal(isHomePage('/notifications'), false);
  assert.equal(isHomePage('/messages'), false);
  assert.equal(isHomePage('/i/bookmarks'), false);
  assert.equal(isHomePage('/i/lists/12345'), false);
  assert.equal(isHomePage('/i/communities/12345'), false);
  assert.equal(isHomePage('/home/extra'), false);
  assert.equal(isHomePage('/'), false);
  assert.equal(isHomePage(''), false);
  assert.equal(isHomePage(null), false);
  assert.equal(isHomePage(undefined), false);
});

test('extractUsersFromGraphQLResponse reads core.screen_name when legacy has no handle', () => {
  const rebuiltUser = {
    data: {
      user_result_by_screen_name: {
        result: {
          __typename: 'User',
          core: { screen_name: 'GitLab' },
          legacy: { withheld_scope: '' },
          relationship_perspectives: { following: false, muting: false },
          rest_id: '390167291'
        }
      }
    }
  };

  const users = extractUsersFromGraphQLResponse(rebuiltUser);
  const user = users.get('gitlab');
  assert.ok(user);
  assert.equal(user.following, false);
  assert.equal(user.restId, '390167291');
});

test('searchReactTreeForUser matches core.screen_name on the rebuilt user object', () => {
  const tree = {
    post: {
      author: {
        __typename: 'User',
        core: { screen_name: 'gitlab' },
        relationship_perspectives: { following: true },
        rest_id: '390167291'
      },
      viewer: {
        core: { screen_name: 'me' },
        relationship_perspectives: { following: false }
      }
    }
  };

  const found = searchReactTreeForUser(tree, 'gitlab');
  assert.ok(found);
  assert.equal(found.username, 'gitlab');
  assert.equal(found.following, true);
  assert.equal(found.restId, '390167291');
});

test('resolvePostAuthor prefers the new avatar alt over status links', () => {
  assert.equal(resolvePostAuthor({
    avatarAlt: '@gitlab',
    avatarHref: '/gitlab',
    headerLinks: ['/gitlab/status/2124961463211032736'],
    headerText: 'GitLab @gitlab'
  }), 'gitlab');

  assert.equal(resolvePostAuthor({
    headerLinks: ['/home', '/pandaoist'],
    headerText: ''
  }), 'pandaoist');

  assert.equal(usernameFromHref('/gitlab/status/1'), null);
  assert.equal(usernameFromAlt('GitLab'), null);
});

test('isTimelinePost accepts rebuilt articles and still accepts legacy tweets', () => {
  function makeArticle({ legacy = false, selectors = {}, nested = false }) {
    const self = {
      matches(sel) {
        if (sel === 'article[data-testid="tweet"]') return legacy;
        if (sel === 'article') return true;
        return false;
      },
      querySelector() { return null; },
      querySelectorAll(sel) {
        for (const [key, value] of Object.entries(selectors)) {
          if (!value) continue;
          if (sel.includes(key)) {
            const el = nested
              ? { closest: () => ({}) }
              : { closest: () => self };
            return [el];
          }
        }
        return [];
      }
    };
    return self;
  }

  assert.equal(isTimelinePost(makeArticle({ legacy: true })), true);
  assert.equal(isTimelinePost(makeArticle({
    selectors: { '[data-engagement-action="share"]': true }
  })), true);
  assert.equal(isTimelinePost(makeArticle({
    selectors: { '[data-post-avatar]': true }
  })), true);
  assert.equal(isTimelinePost(makeArticle({
    selectors: { '[data-engagement-action="share"]': true },
    nested: true
  })), false);
  assert.equal(isTimelinePost({ querySelector() { return null; }, querySelectorAll() { return []; }, matches() { return false; } }), false);
});

test('hasTweetSocialContext ignores action-bar repost icons on the rebuilt post', () => {
  const actionIcon = { closest: (sel) => (sel.includes('role="group"') ? {} : null) };
  const contextIcon = { closest: () => null };
  const post = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel.includes('icon-repost')) return [actionIcon];
      return [];
    }
  };
  const repost = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel.includes('icon-repost')) return [contextIcon];
      return [];
    }
  };

  assert.equal(hasTweetSocialContext(post), false);
  assert.equal(hasTweetSocialContext(repost), true);
});

const NOT_INTERESTED_PHRASES = [
  ['对此帖子不感兴趣', 5],
  ['对此帖文不感兴趣', 5],
  ['not interested in this post', 5],
  ['不感兴趣', 3],
  ['not interested', 3],
  ['no me interesa', 3]
];

export function notInterestedScore(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized || normalized.length > 80) return 0;
  let best = 0;
  for (const [phrase, score] of NOT_INTERESTED_PHRASES) {
    if (normalized.includes(phrase.toLowerCase())) best = Math.max(best, score);
  }
  return best;
}

function engagementControl(root) {
  if (!root || typeof root.querySelector !== 'function') return null;
  return root.querySelector('[data-engagement-action], [data-testid="reply"], [data-testid="like"], [data-testid="share"]');
}

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

function makeNode({ role = null, engagement = false, children = [] } = {}) {
  const node = {
    parentElement: null,
    children,
    getAttribute(name) { return name === 'role' ? role : null; },
    querySelector(sel) {
      if (engagement && String(sel).includes('data-engagement-action')) return node.control;
      for (const child of children) {
        const found = child.querySelector(sel);
        if (found) return found;
      }
      return null;
    },
    closest(sel) {
      if (sel === '[role="group"]' && role === 'group') return node;
      return node.parentElement ? node.parentElement.closest(sel) : null;
    }
  };
  node.control = { closest: (sel) => node.closest(sel) };
  for (const child of children) child.parentElement = node;
  return node;
}

test('caretIsInActionBar ignores a post-level group and matches the engagement row', () => {
  const more = makeNode();
  const action = makeNode({ role: 'group', engagement: true, children: [makeNode()] });
  makeNode({ role: 'group', children: [makeNode({ children: [more] }), action] });

  assert.equal(caretIsInActionBar(more), false);
  assert.equal(caretIsInActionBar(action.children[0]), true);
  assert.equal(caretIsInActionBar(makeNode()), false);
});

test('notInterestedScore prefers the exact post action and ignores positive interest', () => {
  assert.equal(notInterestedScore('对此帖子不感兴趣'), 5);
  assert.equal(notInterestedScore('Not interested in this post'), 5);
  assert.equal(notInterestedScore('不感兴趣'), 3);
  assert.equal(notInterestedScore('感兴趣'), 0);
  assert.equal(notInterestedScore('Follow @gitlab'), 0);
  assert.ok(notInterestedScore('对此帖子不感兴趣') > notInterestedScore('不感兴趣'));
});

