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
 * Recursively extracts user relationship data from X GraphQL / REST API JSON responses
 */
export function extractUsersFromGraphQLResponse(data, results = new Map()) {
  if (!data || typeof data !== 'object') {
    return results;
  }

  // Check if current node is a User object with legacy attributes
  if (data.__typename === 'User' || (data.rest_id && data.legacy && typeof data.legacy === 'object')) {
    const legacy = data.legacy || {};
    const screenName = (legacy.screen_name || data.screen_name || '').toLowerCase();
    if (screenName) {
      const existing = results.get(screenName) || {};
      results.set(screenName, {
        ...existing,
        username: screenName,
        restId: String(data.rest_id || legacy.id_str || existing.restId || ''),
        following: legacy.following !== undefined ? Boolean(legacy.following) : (existing.following || false),
        pending: legacy.following_requested !== undefined ? Boolean(legacy.following_requested) : (existing.pending || false),
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

test('extractUsersFromGraphQLResponse parses nested timeline response correctly', () => {
  const mockGraphQL = {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                {
                  entryId: 'tweet-1800000000',
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: '1800000000',
                          core: {
                            user_results: {
                              result: {
                                __typename: 'User',
                                rest_id: '44196397',
                                legacy: {
                                  screen_name: 'elonmusk',
                                  name: 'Elon Musk',
                                  following: false,
                                  followed_by: false,
                                  following_requested: false
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                {
                  entryId: 'tweet-1800000001',
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: '1800000001',
                          core: {
                            user_results: {
                              result: {
                                __typename: 'UserWithVisibilityResults',
                                user: {
                                  __typename: 'User',
                                  rest_id: '12345678',
                                  legacy: {
                                    screen_name: 'sama',
                                    name: 'Sam Altman',
                                    following: true,
                                    followed_by: true,
                                    following_requested: false
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                {
                  entryId: 'tweet-1800000002',
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: '1800000002',
                          core: {
                            user_results: {
                              result: {
                                __typename: 'User',
                                rest_id: '999999',
                                legacy: {
                                  screen_name: 'private_user',
                                  name: 'Private Account',
                                  following: false,
                                  following_requested: true
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              ]
            }
          ]
        }
      }
    }
  };

  const users = extractUsersFromGraphQLResponse(mockGraphQL);
  assert.equal(users.size, 3);

  const elon = users.get('elonmusk');
  assert.ok(elon);
  assert.equal(elon.restId, '44196397');
  assert.equal(elon.following, false);
  assert.equal(elon.pending, false);

  const sama = users.get('sama');
  assert.ok(sama);
  assert.equal(sama.restId, '12345678');
  assert.equal(sama.following, true);

  const priv = users.get('private_user');
  assert.ok(priv);
  assert.equal(priv.pending, true);
  assert.equal(priv.following, false);
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
