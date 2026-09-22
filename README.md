# X FollowFlow (x-follow-flow)

> 面向 **x.com** (Twitter) 的极简、轻量浏览器用户脚本（Userscript）。  
> 在推文操作栏 **Grok 图标旁** 内联显示关注/取关 Icon 按钮，无需跳转作者主页，丝滑就地操作，自带防误触二次确认。  
> 优先支持 **Tampermonkey** 与 **Violentmonkey**。

---

## 🌟 核心功能

在 X 的时间线（推荐流 For You、关注流 Following、搜索流、详情页等）中：
* **原生 Grok 旁 Icon 位置**：以极简的圆形 Icon 按钮形式呈现在推文操作栏（Reply / Repost / Like / Views / Bookmark / **FollowFlow** / Grok / Share），完全融入 X 原生 UI，不占用作者栏空间，不高突显眼。
* **精准识别关注状态**：
  * 支持 X 现代 GraphQL `relationship_perspectives.following` 深度解析；
  * 具备 React Props/Fiber 与原生 Caret 菜单动作树深度穿透校验；
  * 准确区分已关注与未关注，绝不误标。
* **一键关注 (Follow)**：
  * 未关注时显示添加关注 Icon（`person_add`）；
  * 点击立即关注，即刻切换为高亮已关注状态，无需刷新页面。
* **防误触取消关注 (Unfollow)**：
  * 已关注时显示已关注 Icon（`person_check`）；
  * 第一次点击：Icon 变为红色警示的取关 Icon（`person_remove`），启动 3 秒防误触倒计时；
  * 第二次点击：倒计时内再次点击方才真正取消关注，彻底避免误触；
  * 超时恢复：3 秒内未二次点击自动恢复为已关注状态。
* **全屏多卡片实时同步**：页面中若出现同一作者的多条推文，操作其中任意一条，其余所有推文中的关注 Icon 将同步更新。
* **智能过滤本人**：自动识别当前登录账号，当前登录用户自己的推文不会显示按钮。
* **极致性能与无感加载**：
  * 启动阶段监听 X 原生 Timeline 响应，在推文渲染前即可取得关系数据，零额外请求；
  * 采用防抖 MutationObserver，高效支持 SPA 动态路由与虚拟无限滚动。
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

脚本顶部提供了直观的 `CONFIG` 配置项：

```javascript
const CONFIG = {
  confirmTimeoutMs: 3000,           // 取消关注防误触倒计时（毫秒）
  scanDebounceMs: 50,               // 滚动防抖扫描间隔（毫秒）
  maxCaretWaitMs: 800               // 原生菜单等待超时（毫秒）
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
│   │       UI Component (Grok 图标旁 Icon 注入)       │   │
│   │     [Person+] ⇄ [Person✓] ⇄ [Person- 确认]       │   │
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

1. **多层状态解析**：解析 `relationship_perspectives.following`、`legacy.following`，结合推文 React Fiber 深度递归查找，消除由于 X 接口版本演进导致的状态误判。
2. **状态中枢**：采用观察者模式（Observer Pattern），单个用户的状态变更会瞬时广播给视图层所有对应卡片。
3. **安全操作**：操作时短暂对 body 施加无感遮罩样式，触发原生三点菜单完成点击与确认，既不破坏用户视觉，又让 X 原生请求校验完整生效。

---

## 🧪 自动化测试

项目内置了单元测试套件，可直接使用 Node.js 运行：

```bash
npm test
```

测试覆盖：
- `relationship_perspectives` 现代结构与传统 `legacy` 兼容解析
- React Props / Caret 动作树深度匹配算法
- User-Name 链接解析与 Handle 提取算法
- FollowStateManager 跨组件订阅与广播同步
- ButtonStateMachine 关注、二次确认倒计时、超时回滚与失败降级

---

## 📄 许可证

[MIT License](./package.json)
