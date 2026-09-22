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

      // Multi-layer check for following state
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
 * Searches React Fiber / Props tree for user relationship or Caret menu actions
 */
export function searchReactTreeForUser(obj, depth = 0, visited = new WeakSet()) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (visited.has(obj)) return null;
  visited.add(obj);

  // 1. Check for User object with relationship_perspectives or legacy
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

  // 2. Check if this is a Caret menu items array or action container
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

  // 3. Recurse into children
  for (const key of Object.keys(obj)) {
    if (key === 'children' && depth > 2) continue;
    if (typeof data_or_val(obj[key])) {
      const found = searchReactTreeForUser(obj[key], depth + 1, visited);
      if (found) return found;
    }
  }
  return null;
}

function data_or_val(v) {
  return typeof v === 'object' && v !== null;
}

/**
 * Extracts username from User-Name links or text
 */
export function extractUsernameFromLinks(links, textContent = '') {
  const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose']);

  for (const href of links) {
    if (!href) continue;
    const path = href.replace(/^https?:\/\/[^\/]+/, '').split('?')[0].split('#')[0];
    const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (match) {
      const candidate = match[1].toLowerCase();
      if (!reserved.has(candidate)) {
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
  // Modern X response where legacy.following is missing/false, but relationship_perspectives.following is true
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
                screen_name: 'elonmusk',
                name: 'Elon Musk'
                // legacy.following is deliberately omitted here to test relationship_perspectives
              }
            }
          }
        }
      }
    }
  };

  const users = extractUsersFromGraphQLResponse(modernResponse);
  assert.equal(users.size, 1);
  const elon = users.get('elonmusk');
  assert.ok(elon);
  assert.equal(elon.following, true);
  assert.equal(elon.restId, '44196397');
});

test('searchReactTreeForUser finds relationship_perspectives and Caret actions', () => {
  // Case 1: React Props containing relationship_perspectives
  const mockProps = {
    tweet: {
      core: {
        user_results: {
          result: {
            rest_id: '12345',
            relationship_perspectives: {
              following: true
            },
            legacy: {
              screen_name: 'sama'
            }
          }
        }
      }
    }
  };

  const found1 = searchReactTreeForUser(mockProps);
  assert.ok(found1);
  assert.equal(found1.username, 'sama');
  assert.equal(found1.following, true);

  // Case 2: Caret dropdown items containing "Unfollow"
  const mockCaretProps = {
    items: [
      { text: 'Not interested in this post' },
      { text: 'Unfollow @elonmusk' }
    ]
  };

  const found2 = searchReactTreeForUser(mockCaretProps);
  assert.ok(found2);
  assert.equal(found2.following, true);
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

  manager.set('elonmusk', { following: true, restId: '44196397' });
  manager.set('sama', { following: false, restId: '12345' });

  assert.equal(receivedUpdates.length, 2);
  assert.equal(receivedUpdates[0].username, 'elonmusk');
  assert.equal(receivedUpdates[0].state.following, true);
  assert.equal(receivedUpdates[1].username, 'sama');
  assert.equal(receivedUpdates[1].state.following, false);

  assert.equal(manager.get('ElonMusk').following, true);
  assert.equal(manager.get('sama').following, false);
  assert.equal(manager.get('nonexistent'), null);

  unsubscribe();
  manager.set('other', { following: true });
  assert.equal(receivedUpdates.length, 2);
});

test('ButtonStateMachine handles Follow flow', async () => {
  const history = [];
  let followActionCalled = false;

  const machine = new ButtonStateMachine({
    username: 'testuser',
    initialFollowing: false,
    onAction: async (action) => {
      if (action === 'FOLLOW') {
        followActionCalled = true;
        return true;
      }
      return false;
    },
    onStateChange: (state) => history.push(state)
  });

  assert.equal(machine.state, 'NOT_FOLLOWING');
  await machine.handleClick();

  assert.ok(followActionCalled);
  assert.deepEqual(history, ['FOLLOWING_IN_PROGRESS', 'FOLLOWING']);
  assert.equal(machine.state, 'FOLLOWING');
});

test('ButtonStateMachine handles Unfollow 2-step confirmation and timeout', async () => {
  const history = [];
  let unfollowActionCalled = false;

  const machine = new ButtonStateMachine({
    username: 'testuser',
    initialFollowing: true,
    onAction: async (action) => {
      if (action === 'UNFOLLOW') {
        unfollowActionCalled = true;
        return true;
      }
      return false;
    },
    onStateChange: (state) => history.push(state)
  });
  machine.confirmTimeoutMs = 50;

  assert.equal(machine.state, 'FOLLOWING');

  // First click: prompts for confirmation
  await machine.handleClick();
  assert.equal(machine.state, 'CONFIRMING_UNFOLLOW');
  assert.equal(unfollowActionCalled, false);

  // Wait for timeout -> should revert to FOLLOWING
  await new Promise(r => setTimeout(r, 70));
  assert.equal(machine.state, 'FOLLOWING');

  // Click again to confirm before timeout
  await machine.handleClick();
  assert.equal(machine.state, 'CONFIRMING_UNFOLLOW');

  // Second click: executes unfollow
  await machine.handleClick();
  assert.ok(unfollowActionCalled);
  assert.equal(machine.state, 'NOT_FOLLOWING');
});

test('ButtonStateMachine handles failure gracefully', async () => {
  const history = [];

  const machine = new ButtonStateMachine({
    username: 'failuser',
    initialFollowing: false,
    onAction: async () => false,
    onStateChange: (state) => history.push(state)
  });

  await machine.handleClick();
  assert.equal(machine.state, 'FAILED');
  await new Promise(r => setTimeout(r, 1550));
  assert.equal(machine.state, 'NOT_FOLLOWING');
});

test('Multiple ButtonStateMachines sync when state manager emits change', () => {
  const manager = new FollowStateManager();
  const machine1States = [];
  const machine2States = [];

  const m1 = new ButtonStateMachine({
    username: 'sync_author',
    initialFollowing: false,
    onAction: async () => true,
    onStateChange: (s) => machine1States.push(s)
  });

  const m2 = new ButtonStateMachine({
    username: 'sync_author',
    initialFollowing: false,
    onAction: async () => true,
    onStateChange: (s) => machine2States.push(s)
  });

  manager.subscribe((user, state) => {
    if (user === 'sync_author') {
      m1.handleExternalStateChange(state.following, state.pending);
      m2.handleExternalStateChange(state.following, state.pending);
    }
  });

  assert.equal(m1.state, 'NOT_FOLLOWING');
  assert.equal(m2.state, 'NOT_FOLLOWING');

  // Follow action dispatched for sync_author
  manager.set('sync_author', { following: true, pending: false });

  assert.equal(m1.state, 'FOLLOWING');
  assert.equal(m2.state, 'FOLLOWING');

  // Unfollow action dispatched
  manager.set('sync_author', { following: false, pending: false });

  assert.equal(m1.state, 'NOT_FOLLOWING');
  assert.equal(m2.state, 'NOT_FOLLOWING');
});
