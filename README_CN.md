# X FollowFlow (`x-follow-flow`)

<p align="center">
  <strong>面向 X (Twitter) 的极简轻量级浏览器用户脚本，在推文流中直接内联 Follow / Unfollow，无缝原生、丝滑防误触。</strong>
</p>

<p align="center">
  <a href="https://github.com/haorui-lab/x-follow-flow/releases"><img src="https://img.shields.io/badge/version-0.5.2-blue.svg?style=flat-square" alt="Version"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
  <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-支持-black?style=flat-square&logo=tampermonkey" alt="Tampermonkey"></a>
  <a href="https://violentmonkey.github.io/"><img src="https://img.shields.io/badge/Violentmonkey-支持-orange?style=flat-square" alt="Violentmonkey"></a>
  <a href="https://github.com/haorui-lab/x-follow-flow/pulls"><img src="https://img.shields.io/badge/PRs-欢迎提交-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README_CN.md"><b>简体中文</b></a>
</p>

---

## 💡 为什么需要 X FollowFlow？

浏览 X 的 **For You (推荐流)** 是发掘优质创作者最核心的途径。然而原生的关注交互十分繁琐：
1. 必须将鼠标悬停在头像上等待慢吞吞的浮层（HoverCard）加载；或者
2. 必须点击进入作者的主页，打断原有的信息流阅读位置。

**X FollowFlow** 专注于以极致克制和原生的方式解决这一痛点：在每条推文底部的操作栏中，**紧邻分享（Share）按钮右侧** 无缝嵌入无边框原生图标按钮。

---

## ✨ 核心特性

- 🎯 **与原生 UI 浑然一体**：采用无边框设计，精准安放于推文底部操作条（`回复` · `转推` · `点赞` · `阅读量` · `书签` · `Grok` · `分享` · **`FollowFlow`**）。
- ⚡ **精准穿透的状态识别**：
  - 深度支持 X 现代 GraphQL `relationship_perspectives.following` 关系结构；
  - 严格限定作者 Handle 校验 React Fiber，彻底杜绝当前登录账号与 Mention 账户串扰误报；
  - 接入 HoverCard 浮层实时同步与 Following 标签页上下文智能感知。
- 🛡️ **防误触两步取关确认**：
  - 点击已关注作者（`✓`）后，图标变为红色告警减号（`−`），启动 3 秒安全倒计时；
  - 3 秒内未再次点击自动恢复；
  - 再次点击方才执行取关操作，彻底避免手滑误取关。
- 🔄 **全屏多卡片实时联动**：信息流中同一作者若有多条推文，在任一推文上操作，全屏所有该作者的卡片状态瞬间同步。
- 👤 **本人与主页推文自动过滤**：自动识别登录账号（本人推文不显示按钮），并自动在个人主页（`https://x.com/[username]`）屏蔽按钮（主页顶部已自带显眼的原生关注/已关注按钮）。
- 🚀 **极致性能与虚拟滚动优化**：防抖 MutationObserver 监听，平滑支撑 SPA 无限滚动，零布局抖动，零内存泄漏。
- 🔒 **100% 本地隐私安全**：纯客户端运行，绝无任何第三方远程统计、上报或私有 API Key。

---

## 🎨 视觉状态一览

| 状态 | 图标符号 | 视觉表现 | 交互行为 |
| :--- | :---: | :--- | :--- |
| **未关注** | `+` | 中性灰色加号，悬浮显示 Twitter 经典蓝圈 | 点击立即 **关注** |
| **已关注** | `✓` | 中性灰色对勾（与原生图标一致，悬浮变红色 `−` 提示） | 点击启动 **防误触确认** |
| **确认中** | `−` | 告警红色（`#f4212e`）减号，伴随微呼吸动画 | 3秒内再次点击 **取关**；超时自动复原 |
| **处理中** | ⟳ | 原生平滑旋转 Spinner | 禁用防连击 |

---

## 📦 支持页面

- ✅ `https://x.com/home` (For You 推荐流 / Following 关注流)
- ✅ `https://x.com/search?*` (搜索结果时间线)
- ✅ `https://x.com/[username]/status/[id]` (单条推文详情页与回复流)
- ✅ `https://x.com/i/lists/*` (Lists 时间线)
- ✅ `https://x.com/i/bookmarks` (书签时间线)
- ✅ `https://twitter.com/*` (所有旧域名对应页面)
- ⚪ `https://x.com/[username]` (按设计已排除：个人主页自带原生关注按钮)

---

## 🚀 快速安装

### 前置条件

确保浏览器中安装了用户脚本管理器：
- [**Tampermonkey (篡改猴)**](https://www.tampermonkey.net/)（推荐：Chrome、Edge、Safari、Firefox）
- [**Violentmonkey (暴力猴)**](https://violentmonkey.github.io/)（Chrome、Firefox）

### 一键安装

点击下方链接即可调出脚本管理器的一键安装窗口：

👉 **[点击一键在线安装 x-follow-flow.user.js](https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js)**

*(若 GitHub CDN 节点存在数分钟缓存，可使用带版本戳链接：[最新直链](https://raw.githubusercontent.com/haorui-lab/x-follow-flow/main/x-follow-flow.user.js?v=0.5.2))*。

---

## ⚙️ 个性化配置

脚本顶部提供了直观的配置对象 `CONFIG`，可自由微调超时与防抖：

```javascript
const CONFIG = {
  confirmTimeoutMs: 3000,   // 取关二次确认倒计时（毫秒）
  scanDebounceMs: 50,       // 时间线滚动防抖扫描间隔（毫秒）
  maxCaretWaitMs: 800       // 原生操作等待超时（毫秒）
};
```

---

## 🛠️ 技术原理与架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    X.com Web 页面运行环境                       │
│                                                                 │
│   ┌──────────────────────┐             ┌─────────────────────┐  │
│   │ 全协议网络拦截器     │             │  MutationObserver   │  │
│   │ (Fetch + XHR 劫持)   │             │  (虚拟滚动信息流)   │  │
│   └──────────┬───────────┘             └──────────┬──────────┘  │
│              │ 解析关注关系                       │ 捕获新推文  │
│              ▼                                    ▼             │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │       FollowStateManager (全局状态缓存与发布订阅中枢)    │  │
│   └──────────────────────────┬───────────────────────────────┘  │
│                              │ 广播状态变更                     │
│                              ▼                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │           UI Component (分享按钮右侧原生图标注入)        │  │
│   │       [ + (未关注) ] ⇄ [ ✓ (已关注) ] ⇄ [ − (3秒确认) ]  │  │
│   └──────────────────────────┬───────────────────────────────┘  │
│                              │ 用户点击触发                     │
│                              ▼                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                  Action Executor 策略执行器              │  │
│   │   首选: 无感知触发推文 Caret 菜单（视觉遮蔽弹窗）        │  │
│   │   备选: 页面现有会话 POST /1.1/friendships/*.json        │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

1. **全协议网络拦截**：在 `@run-at document-start` 阶段同时拦截 `fetch` 与 `XMLHttpRequest`，零额外开销获取 GraphQL 关系数据。
2. **目标绑定 Fiber 遍历**：严格匹配 `screen_name === author`，消除当前登录用户（Viewer）自评数据的串扰。
3. **原生 Caret 模拟**：在静默 CSS 遮罩下程序化触发三点菜单，X 原生逻辑自行完成所有请求与校验。

---

## 🧪 单元测试

项目内置 Node.js 原生自动化单元测试套件：

```bash
# 克隆仓库
git clone https://github.com/haorui-lab/x-follow-flow.git
cd x-follow-flow

# 运行测试
npm test
```

测试覆盖：
- `relationship_perspectives` 现代字段与传统 legacy 解析
- 目标绑定型 React Fiber 与 Caret 动作树深度解析
- Handle 与用户名解析
- FollowStateManager 订阅与多组件广播同步
- ButtonStateMachine 关注、两步取关与超时回滚

---

## 🛡️ 安全与隐私规范

- **零数据外流**：绝不连接第三方服务器，零 Telemetry / Analytics。
- **凭据零泄露**：不保存、不上报您的密码、Cookie 或 Token。
- **纯手动合规**：所有操作均由用户显式点击触发，严格遵守 X 平台反自动化规范。

---

## 📄 开源许可证

本项目基于 [MIT License](./package.json) 开源。
