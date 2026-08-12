# Smart CS Agent

一个基于 LangGraph 工作流 + 统一 LLM Provider 抽象层的智能客服 Web 应用，同时支持通用对话。

## 特性

- 💬 **流式对话** - 实时显示 AI 回复（SSE）
- 🤖 **智能客服 Agent** - 意图识别 + FAQ 匹配 + 工单升级（`cs-agent` 模型）
- 🔀 **统一 LLM Provider** - 通过环境变量自动切换 MiniMax / 任意 OpenAI 兼容 API
- 📝 **会话管理** - 多会话切换、模型切换、Agent 绑定、历史持久化
- 🎨 **主题切换** - 支持深色 / 浅色主题
- 🤖 **自定义 Agent** - 创建和管理多个 Agent 配置（含系统提示词）
- ⭐ **满意度评分** - 会话结束后收集用户反馈
- 🔐 **鉴权与会话控制** - JWT 登录 + 管理员后台

## 技术栈

- **后端**: Node.js + Express + TypeScript + LangGraph（状态图引擎）+ LangChain（ChatOpenAI / OpenAIEmbeddings）
- **前端**: React 18 + TypeScript + Vite
- **UI**: TDesign React 组件库 + Tailwind CSS
- **图表**: ECharts（管理后台仪表盘）
- **AI 编排**: LangGraph（CS Agent 工作流）
- **AI 调用**: 统一 LLM Provider（OpenAI 兼容协议）
- **数据库**: SQLite (better-sqlite3)
- **鉴权**: JWT (jsonwebtoken) + bcryptjs

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 LLM API Key（二选一）

编辑 `.env` 文件，配置以下之一：

```bash
# 方案 A: MiniMax API（推荐）
MINIMAX_API_KEY=your_minimax_api_key
# MINIMAX_BASE_URL=https://api.minimax.chat/v1
# MINIMAX_MODEL=MiniMax-M1

# 方案 B: 任意 OpenAI 兼容 API（DeepSeek / Qwen / SiliconFlow / Groq 等）
# OPENAI_API_KEY=your_api_key
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o-mini
```

> 未配置任何 Key 时，进入演示模式（`cs-agent` 模型走 LangGraph 离线工作流，无 Key 也能跑）。

### 3. 启动开发服务器

```bash
npm run dev
```

这会同时启动前端（端口 5173）和后端（端口 3000）。

### 4. 访问应用

打开浏览器访问 http://localhost:5173

默认管理员账号：`admin` / `admin123`（首次启动自动初始化）。

## 项目结构

```
Agent_demo/
├── server/                      # 后端服务
│   ├── index.ts                # Express 服务器（API 路由）
│   ├── db.ts                   # SQLite 数据库操作（7 张表）
│   ├── auth.ts                 # JWT 鉴权
│   ├── admin/                  # 管理后台路由
│   │   └── routes.ts
│   ├── agents/                 # LangGraph 工作流节点
│   │   ├── graph.ts            # CS Agent 状态图
│   │   ├── agent.ts            # 通用对话节点
│   │   ├── intent.ts           # 意图识别
│   │   ├── rag.ts              # FAQ 检索
│   │   ├── escalation.ts       # 工单升级
│   │   ├── types.ts            # 工作流状态定义
│   │   └── llm-provider.ts     # 统一 LLM Provider 抽象层
│   └── rag/                    # 知识库加载与向量检索
│       ├── faqLoader.ts        # FAQ 初始化与种子数据
│       └── vectorStore.ts      # Embedding API + 余弦相似度
├── src/                        # 前端源码
│   ├── components/             # React 组件
│   ├── hooks/                  # 自定义 Hooks
│   ├── pages/                  # 页面组件
│   ├── utils/                  # 工具函数
│   ├── types.ts                # 类型定义
│   ├── config.ts               # 应用配置
│   ├── App.tsx                 # 路由与全局状态
│   └── main.tsx                # React 入口
├── data/                       # 数据存储
│   ├── chat.db                 # SQLite 数据库
│   └── faq/                    # FAQ 知识库源文件目录
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md                   # 项目说明
├── DEVELOPMENT.md              # 二次开发指南
├── DEVELOPMENT_PLAN.md         # 开发方案与历史
├── ACCEPTANCE.md               # 验收清单
├── RAG_LANDSCAPE.md            # RAG 方案调研与升级路径
└── overview.md                 # 项目进度总览
```

## 核心功能

### 智能客服 Agent（`cs-agent`）

`cs-agent` 是内置模型 ID，走 [server/agents/graph.ts](file:///Users/botao/Desktop/Agent_demo/server/agents/graph.ts) 定义的 LangGraph 工作流，节点顺序：

1. `intent` - 意图识别（`refund` 退款 / `order_inquiry` 订单查询 / `tech_support` 技术支持 / `general` 通用）
2. `rag` - FAQ 知识库检索（Embedding API 向量化 + 余弦相似度）
3. `agent` - 通用 LLM 回复（无匹配 FAQ 时）
4. `escalation` - 工单升级（用户明确要求转人工或 LLM 兜底时触发）

SSE 流事件：
- `intent` - 意图 + 置信度
- `workflow_meta` - 是否命中 FAQ、是否升级、Ticket ID
- `text` - 最终回复文本
- `done` - 结束

### 统一 LLM Provider

[server/agents/llm-provider.ts](file:///Users/botao/Desktop/Agent_demo/server/agents/llm-provider.ts) 通过环境变量自动选择后端：

| 优先级 | 触发条件 | 实现 |
|--------|----------|------|
| 1 | `MINIMAX_API_KEY` | OpenAI 兼容 Provider，base_url 默认 `https://api.minimax.chat/v1` |
| 2 | `OPENAI_API_KEY` | OpenAI 兼容 Provider，base_url 默认 `https://api.openai.com/v1` |
| 3 | 无 Key | 兜底 Provider（演示模式，模板化回复） |

所有 Provider 都支持流式输出（`onText` 回调），与 SSE 协议无缝集成。

### 流式响应

使用 Server-Sent Events (SSE) 实现实时流式响应：
- 文本内容流式输出（`text` 事件）
- CS Agent 元数据流式推送（`intent` / `workflow_meta` 事件）
- 统一以 `done` 事件结束，`error` 事件报告异常

### 数据持久化

使用 SQLite 存储（7 张表）：
- `sessions` - 会话信息（标题、模型、Agent 绑定）
- `messages` - 消息历史（角色、内容、模型、时间戳）
- `faq_knowledge` - FAQ 知识库（问题、答案、分类、关键词）
- `tickets` - 工单记录（状态、优先级、升级流转）
- `conversation_intents` - 意图识别记录（意图、置信度、FAQ 命中）
- `satisfaction_ratings` - 满意度评分（1-5 星 + 评语）
- `users` - 用户认证（bcrypt 密码哈希 + RBAC 角色）

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 用户登录，返回 JWT |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/models` | GET | 获取可用模型列表 |
| `/api/sessions` | GET | 获取所有会话 |
| `/api/sessions` | POST | 创建新会话 |
| `/api/sessions/:id` | GET | 获取单个会话（含消息） |
| `/api/sessions/:id` | PATCH | 更新会话（标题/模型） |
| `/api/sessions/:id` | DELETE | 删除会话 |
| `/api/chat` | POST | 通用对话（SSE 流式响应） |
| `/api/cs-agent/chat` | POST | 智能客服 Agent（SSE 流式响应） |
| `/api/satisfaction` | POST | 提交满意度评分 |
| `/api/admin/dashboard` | GET | 管理员仪表盘统计 |
| `/api/admin/conversations` | GET | 全部会话（管理员） |
| `/api/admin/conversations/:sessionId` | GET | 单个会话详情（管理员） |
| `/api/admin/stats/satisfaction` | GET | 满意度统计 |
| `/api/admin/stats/intents` | GET | 意图分布统计 |
| `/api/admin/stats/tickets` | GET | 工单统计 |
| `/api/admin/tickets` | GET | 工单列表 |
| `/api/admin/tickets/:ticketId` | PATCH | 更新工单状态/分配 |
| `/api/admin/faq` | GET | FAQ 列表（管理员） |

## 环境要求

- Node.js 20+（`better-sqlite3` 需要原生模块匹配 ABI 版本）
- npm 或 yarn

## 配置

### 方式一：`.env` 文件

参考 `.env.example`：

```bash
PORT=3000

# LLM Provider（至少配置一种，优先级见上文）
MINIMAX_API_KEY=your_minimax_api_key
# OPENAI_API_KEY=your_api_key
# OPENAI_BASE_URL=https://api.openai.com/v1

# 管理员账号（首次启动自动创建）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# JWT
JWT_SECRET=your_jwt_secret
```

### 方式二：Web UI 配置

在应用的设置页面中配置环境变量（仅在当前服务器进程有效，重启失效）。

## 开发

```bash
# 开发模式（同时启动前后端）
npm run dev

# 单独启动后端
npm run dev:server

# 单独启动前端
npm run dev:client

# 构建生产版本
npm run build

# 运行生产版本
npm start
```

## 路线图

- [ ] 历史会话导出（JSON / Markdown）
- [ ] WebSocket 长连接替代部分 SSE
- [ ] CS Agent 多租户配置
- [ ] FAQ 可视化管理界面