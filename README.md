# X FollowFlow (x-follow-flow)

> 面向 **x.com** (Twitter) 的轻量级浏览器用户脚本（Userscript），在时间线中直接显示作者关注状态并就地 Follow / Unfollow，无感丝滑、防误触。  
> 优先支持 **Tampermonkey** 与 **Violentmonkey**。

---

## 🌟 核心功能

在 X 的时间线（推荐流 For You、关注流 Following、搜索流、详情页等）中：
* **实时显示关注状态**：每条推文作者栏直接显示当前关注状态（`+ Follow` / `✓ Following`）。
* **一键关注 (Follow)**：未关注时点击 `+ Follow` 立即关注，瞬间变为 `✓ Following`，无需刷新或跳转个人主页。
* **防误触取消关注 (Unfollow)**：
  * 第一次点击：`✓ Following` 变为红框警示的 `Unfollow?`，启动 3 秒防误触倒计时；
  * 第二次点击：在 `Unfollow?` 状态下再次点击方才执行取关，避免手滑误触；
  * 超时恢复：3 秒内未二次点击，自动恢复为 `✓ Following`。
* **多卡片实时状态同步**：页面中若出现同一作者的多条推文，操作其中任意一条，其余推文的关注按钮将实时联动同步更新。
* **智能过滤本人**：自动识别当前登录账号，当前登录用户自己的推文不会显示按钮。
* **原生视觉风格与主题自适应**：
  * 紧凑药丸按钮（Pill Button），放置于推文作者栏头部（`@username · 时间戳` 旁）；
  * 完美适配 X 的 **深色模式 (Dark)**、**暗灰模式 (Dim)** 与 **浅色模式 (Light)**；
  * 阻止点击事件冒泡，绝不触发跳转推文详情页。
* **极致性能与无感加载**：
  * **网络层响应解析**：启动时自动监听 X 本身的 Timeline GraphQL 接口，在推文渲染前即可取得关系数据，零额外请求、零界面闪烁；
  * **React Fiber 兜底**：直接读取推文 DOM 的 Fiber 节点状态，应对页面缓存；
  * **虚拟滚动防重**：防抖监听 DOM Mutation，滚动流畅，自动适应 DOM 回收机制。
* **优先复用 X 原生行为**：
  * 默认通过无感触发原生推文 Caret 菜单完成操作，X 原生逻辑自行发起签名请求；
  * 自带 X 会话接口降级机制，极端情况下自动补全请求。
* **100% 安全与隐私合规**：
  * 纯本地运行，不上传任何 Cookie、Token、用户数据，不访问任何第三方服务器；
  * 严格遵循用户手动触发原则，无任何批量或自动化脚本行为。

---

## 📦 支持页面

- ✅ `https://x.com/home` (For You 推荐流 / Following 关注流)
- ✅ `https://x.com/search?*` (搜索结果时间线)
- ✅ `https://x.com/[username]` (用户主页 Posts 时间线)
- ✅ `https://x.com/[username]/status/[id]` (单条推文详情页与回复流)
- ✅ `https://x.com/i/lists/*` (Lists 时间线)
- ✅ `https://twitter.com/*` (所有对应旧域名页面)

---

## 🚀 安装步骤

### 前置条件
确保您的浏览器已安装以下任意一款用户脚本管理器：
- **Tampermonkey (篡改猴)**：[Chrome 网上应用店](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Firefox 附加组件](https://addons.mozilla.org/firefox/addon/tampermonkey/) / [Edge 扩展](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- **Violentmonkey (暴力猴)**：[Chrome 网上应用店](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) / [Firefox 附加组件](https://addons.mozilla.org/firefox/addon/violentmonkey/)

---

### 方法一：一键在线安装（推荐）

点击下方 Raw 脚本链接，脚本管理器将自动弹出安装确认窗口：

👉 **[点击直接安装 x-follow-flow.user.js](https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js)**

---

### 方法二：手动导入安装

1. 打开用户脚本管理器（如 Tampermonkey）的管理面板。
2. 点击 **“实用工具” (Utilities)** 或 **“+” (添加新脚本)**。
3. 复制本项目中的 [`x-follow-flow.user.js`](./x-follow-flow.user.js) 全部代码并粘贴保存。
4. 打开或刷新 [https://x.com/home](https://x.com/home) 即可生效。

---

## ⚙️ 个性化配置

脚本顶部提供了直观的 `CONFIG` 配置项，若您希望使用中文界面或调整超时时间，只需在脚本前段修改：

```javascript
const CONFIG = {
  labels: {
    follow: '+ 关注',               // 默认: '+ Follow'
    following: '✓ 已关注',           // 默认: '✓ Following'
    followingHover: '取消关注',      // 默认: 'Unfollow'
    unfollowConfirm: '取消关注？',    // 默认: 'Unfollow?'
    loadingFollow: '关注中...',      // 默认: 'Following...'
    loadingUnfollow: '取关中...',    // 默认: 'Unfollowing...'
    failed: '失败',                 // 默认: 'Failed'
    pending: '等待确认'              // 默认: 'Pending'
  },
  confirmTimeoutMs: 3000,           // 防误触倒计时（毫秒）
  scanDebounceMs: 50,               // 滚动防抖间隔（毫秒）
  maxCaretWaitMs: 800               // 原生菜单等待超时
};
```

---

## 🛠️ 技术原理与架构

```
┌──────────────────────────────────────────────────────────┐
│                   X Web 页面运行时                       │
│                                                          │
│   ┌─────────────────────┐      ┌─────────────────────┐   │
│   │   fetch() Intercept │      │  MutationObserver   │   │
│   │  (Timeline GraphQL) │      │  (Virtualized DOM)  │   │
│   └──────────┬──────────┘      └──────────┬──────────┘   │
│              │ 解析用户信息               │ 发现新推文   │
│              ▼                            ▼              │
│   ┌──────────────────────────────────────────────────┐   │
│   │       FollowStateManager (状态缓存与广播中枢)    │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ 驱动更新                      │
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │         UI Component (推文作者栏按钮注入)        │   │
│   │  [+ Follow] ⇄ [✓ Following] ⇄ [Unfollow?] (3s)  │   │
│   └──────────────────────┬───────────────────────────┘   │
│                          │ 用户点击触发                  │
│                          ▼                               │
│   ┌──────────────────────────────────────────────────┐   │
│   │              Action Executor 策略执行器          │   │
│   │  首选: 无感原生 Caret 菜单触发                       │   │
│   │  备选: 当前会话接口 POST /friendships/*.json        │   │
│   └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

1. **响应劫持**：在 `@run-at document-start` 时介入，轻量 clone `fetch` 响应，解构 GraphQL 数据中的 `user_results`，无感知预热状态。
2. **状态中枢**：采用观察者模式（Observer Pattern），单个用户的状态变更会瞬时广播给视图层所有对应卡片。
3. **安全操作**：操作时短暂对 body 施加无感遮罩样式，触发原生三点菜单完成点击与确认，既不破坏用户视觉，又让 X 原生请求校验完整生效。

---

## 🧪 自动化测试

项目内置了单元测试套件，可直接使用 Node.js 运行：

```bash
npm test
```

测试覆盖：
- GraphQL 响应树递归查找与用户实体抽取
- User-Name 链接解析与 Handle 提取算法
- FollowStateManager 跨组件订阅与广播同步
- ButtonStateMachine 关注、二次确认倒计时、超时回滚与失败降级

---

## 📄 许可证

[MIT License](./package.json)
