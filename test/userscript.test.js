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
    const screenName = (legacy.screen_name || data.screen_name || '').toLowerCase();
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
 * Determines whether a URL or path represents a user profile page (https://x.com/${username})
 */
export function isProfilePage(urlOrPath) {
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
 * ButtonStateMachine simulates the button state transitions
 */
export class ButtonStateMachine {
  constructor({ username, initialFollowing = false, initialPending = false, onAction, onStateChange }) {
    this.username = username;
    this.state = initialPending ? 'PENDING' : (initialFollowing ? 'FOLLOWING' : 'NOT_FOLLOWING');
    this.onAction = onAction;
    this.onStateChange = onStateChange;
    this.confirmTimer = null;
    this.confirmTimeoutMs = 3000;
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
      this.setState('CONFIRMING_UNFOLLOW');
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => {
        if (this.state === 'CONFIRMING_UNFOLLOW') {
          this.setState('FOLLOWING');
        }
      }, this.confirmTimeoutMs);
    } else if (this.state === 'CONFIRMING_UNFOLLOW') {
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
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
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    if (pending) {
      this.setState('PENDING');
    } else if (following) {
      this.setState('FOLLOWING');
    } else {
      this.setState('NOT_FOLLOWING');
    }
  }

  destroy() {
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
  }
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

test('ButtonStateMachine handles Follow and Unfollow transitions', async () => {
  let actionCalled = null;

  const machine = new ButtonStateMachine({
    username: 'lxfater',
    initialFollowing: true,
    onAction: async (act) => {
      actionCalled = act;
      return true;
    }
  });
  machine.confirmTimeoutMs = 50;

  assert.equal(machine.state, 'FOLLOWING');

  // Step 1: Click once -> enter confirmation
  await machine.handleClick();
  assert.equal(machine.state, 'CONFIRMING_UNFOLLOW');

  // Step 2: Click again -> unfollow
  await machine.handleClick();
  assert.equal(actionCalled, 'UNFOLLOW');
  assert.equal(machine.state, 'NOT_FOLLOWING');

  // Click on NOT_FOLLOWING -> follow
  await machine.handleClick();
  assert.equal(actionCalled, 'FOLLOW');
  assert.equal(machine.state, 'FOLLOWING');
});

test('isProfilePage correctly identifies user profile pages and excludes others', () => {
  // 1. Profile root pages (should be true)
  assert.equal(isProfilePage('/elonmusk'), true);
  assert.equal(isProfilePage('/elonmusk/'), true);
  assert.equal(isProfilePage('https://x.com/elonmusk'), true);
  assert.equal(isProfilePage('https://x.com/elonmusk/'), true);
  assert.equal(isProfilePage('https://twitter.com/elonmusk'), true);
  assert.equal(isProfilePage('https://x.com/elonmusk?mx=2'), true);
  assert.equal(isProfilePage('/lxfater'), true);
  assert.equal(isProfilePage('/sama'), true);
  assert.equal(isProfilePage('/a_b_c_123'), true);

  // 2. Profile tab pages (should be true)
  assert.equal(isProfilePage('/elonmusk/with_replies'), true);
  assert.equal(isProfilePage('/elonmusk/highlights'), true);
  assert.equal(isProfilePage('/elonmusk/articles'), true);
  assert.equal(isProfilePage('/elonmusk/media'), true);
  assert.equal(isProfilePage('/elonmusk/likes'), true);
  assert.equal(isProfilePage('/elonmusk/superfollows'), true);
  assert.equal(isProfilePage('/elonmusk/followers'), true);
  assert.equal(isProfilePage('/elonmusk/following'), true);
  assert.equal(isProfilePage('https://x.com/elonmusk/with_replies'), true);

  // 3. Tweet status and conversation pages (should be false)
  assert.equal(isProfilePage('/elonmusk/status/18382746182947192'), false);
  assert.equal(isProfilePage('https://x.com/elonmusk/status/18382746182947192'), false);
  assert.equal(isProfilePage('https://twitter.com/elonmusk/status/18382746182947192'), false);
  assert.equal(isProfilePage('/elonmusk/status/18382746182947192/photo/1'), false);
  assert.equal(isProfilePage('/elonmusk/status/18382746182947192/likes'), false);

  // 4. Non-profile timelines & system routes (should be false)
  assert.equal(isProfilePage('/home'), false);
  assert.equal(isProfilePage('/explore'), false);
  assert.equal(isProfilePage('/notifications'), false);
  assert.equal(isProfilePage('/messages'), false);
  assert.equal(isProfilePage('/search?q=test'), false);
  assert.equal(isProfilePage('/settings/account'), false);
  assert.equal(isProfilePage('/i/bookmarks'), false);
  assert.equal(isProfilePage('/i/lists/12345'), false);
  assert.equal(isProfilePage('/i/communities/12345'), false);
  assert.equal(isProfilePage('/i/grok'), false);
  assert.equal(isProfilePage('/'), false);
  assert.equal(isProfilePage(''), false);
  assert.equal(isProfilePage(null), false);
  assert.equal(isProfilePage(undefined), false);
});

