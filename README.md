# Smart CS Agent

一个基于 LangGraph 工作流与统一 LLM Provider 抽象层的智能客服 Web 应用，同时支持通用对话。

## 当前能力

- **流式对话**：通过 SSE 实时输出 AI 回复
- **智能客服 Agent**：意图识别、FAQ 语义检索、LLM 回答与人工工单升级
- **统一 LLM Provider**：通过环境变量选择 MiniMax、任意 OpenAI 兼容 API 或演示兜底模式
- **多轮上下文**：调用模型前读取当前会话的历史消息
- **会话管理**：创建、切换、重命名、切换模型、持久化和删除会话
- **消息撤回**：撤回用户消息时，同时软删除紧随其后的 AI 回复
- **会话导出**：支持 JSON 和 Markdown 格式
- **FAQ 能力**：快捷问题、自动补全 API、管理员可视化 CRUD 和向量索引同步
- **内容安全**：敏感词阻断、隐私信息脱敏、提示词注入风险提示和流式输出扫描
- **管理后台**：会话、意图、满意度、工单和 FAQ 管理
- **鉴权**：JWT 登录、bcrypt 密码哈希和 `admin` / `agent` / `visitor` 角色
- **自定义 Agent**：在浏览器本地创建包含系统提示词的 Agent 配置
- **主题切换**：支持深色和浅色主题

## 技术栈

- **前端**：React 18、TypeScript、Vite
- **UI**：TDesign React、Tailwind CSS
- **图表**：ECharts
- **后端**：Node.js、Express、TypeScript
- **AI 编排**：LangGraph
- **AI 调用**：LangChain `ChatOpenAI`
- **FAQ 向量化**：LangChain `OpenAIEmbeddings` + 内存余弦相似度检索
- **数据库**：SQLite（better-sqlite3，WAL 模式）
- **鉴权**：jsonwebtoken、bcryptjs
- **测试**：Vitest

## 快速开始

### 1. 环境要求

- Node.js 20+
- npm

`better-sqlite3` 是原生模块。如果切换过 Node.js 主版本，可以执行：

```bash
npm run rebuild:native
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`，并选择一种 LLM Provider：

```bash
# 方案 A：MiniMax
MINIMAX_API_KEY=your_minimax_api_key
# MINIMAX_BASE_URL=https://api.minimax.chat/v1
# MINIMAX_MODEL=MiniMax-M1
# MINIMAX_EMBEDDING_MODEL=embo-01

# 方案 B：任意 OpenAI 兼容 API
# OPENAI_API_KEY=your_api_key
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o-mini
# EMBEDDING_MODEL=text-embedding-3-small
```

Provider 选择优先级为 `MINIMAX_API_KEY` → `OPENAI_API_KEY` → 演示兜底。

未配置 API Key 时，应用仍可启动，聊天使用模板化演示回复。当前 FAQ 语义检索依赖 Embedding API；Embedding 不可用时向量库会降级为空结果，因此演示模式下不能保证命中 FAQ。

### 4. 启动开发环境

```bash
npm run dev
```

该命令同时启动：

- 前端：http://localhost:5173
- 后端：http://localhost:3000

首次启动且用户表为空时，会自动创建管理员账号：

```text
用户名：admin
密码：admin123
```

生产或共享环境必须通过 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `JWT_SECRET` 覆盖默认值。

## 常用命令

```bash
npm run dev          # 同时启动前后端开发服务器
npm run dev:server   # 仅启动后端，支持热更新
npm run dev:client   # 仅启动前端
npm test             # 单次运行 Vitest
npm run test:watch   # Vitest watch 模式
npm run build        # TypeScript 构建 + Vite 前端构建
npm run preview      # 预览前端构建产物
npm run server       # 启动后端 API
```

当前没有 `npm start`，也没有由 Express 直接托管 `dist/` 的单体生产启动脚本。部署时需要分别托管前端构建产物并运行后端 API。

## 项目结构

```text
Agent_demo/
├── server/
│   ├── index.ts                 # Express 服务、业务 API 与 SSE 流
│   ├── db.ts                    # SQLite Schema、迁移与数据访问
│   ├── auth.ts                  # JWT、密码和角色中间件
│   ├── admin/routes.ts          # 管理后台 API
│   ├── agents/
│   │   ├── graph.ts             # LangGraph 客服工作流
│   │   ├── agent.ts             # LLM 对话节点
│   │   ├── intent.ts            # 规则意图识别
│   │   ├── rag.ts               # FAQ 检索节点
│   │   ├── escalation.ts        # 工单升级节点
│   │   ├── types.ts             # 工作流状态定义
│   │   └── llm-provider.ts      # MiniMax / OpenAI 兼容 / 演示 Provider
│   ├── moderation/
│   │   ├── contentFilter.ts     # 输入、输出内容安全过滤
│   │   └── contentFilter.test.ts
│   ├── rag/
│   │   ├── faqLoader.ts         # 默认 FAQ、初始化与增删改同步
│   │   └── vectorStore.ts       # Embedding 与内存余弦检索
│   └── __tests__/               # DB、工作流和 RAG 单元测试
├── src/
│   ├── components/              # 聊天、侧栏、设置和表单组件
│   ├── hooks/                   # 鉴权、聊天、会话、模型等 Hooks
│   ├── pages/                   # 登录、聊天、后台和 FAQ 页面
│   ├── utils/
│   ├── App.tsx                  # 路由与页面组装
│   ├── config.ts
│   ├── main.tsx
│   └── types.ts
├── data/chat.db                 # SQLite 数据库及 WAL 文件
├── README.md
├── PROGRESS.md                  # 当前进度、技术债务与路线图
├── RAG_LANDSCAPE.md             # RAG 方案调研
├── TESTING_S1.md                # 阶段 1 功能测试说明
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## 智能客服工作流

内置客服模型 ID 为 `cs-agent`，工作流定义在 `server/agents/graph.ts`：

```text
START
  → detect_intent   规则识别 refund / order_inquiry / tech_support / general
  → search_faq      Embedding + 余弦相似度检索 FAQ
  → 条件路由
      ├─ 高置信度命中 → reply_faq → END
      └─ 未命中       → call_agent
                           ├─ 能解决   → END
                           └─ 需人工   → create_ticket → END
```

`/api/cs-agent/chat` 的主要 SSE 事件：

- `init`：会话 ID、用户消息 ID、助手消息 ID
- `intent`：意图和置信度
- `text`：流式文本
- `workflow_meta`：FAQ 命中、升级状态和工单 ID
- `done`：响应结束
- `error`：处理异常

## FAQ 与 RAG

FAQ 数据保存在 SQLite 的 `faq_knowledge` 表。服务启动时：

1. 如果 FAQ 表为空，写入内置种子数据；
2. 调用 Embedding API 为问题和关键词生成向量；
3. 将向量保存在进程内存中；
4. 查询时按意图分类过滤并使用余弦相似度排序。

管理员页面路径是 `/admin/faq`。FAQ 新增、修改和删除会同步更新内存向量索引。服务重启后会从数据库全量重建索引。

当前限制：

- 向量只保存在内存，不会持久化；
- Embedding API 不可用时检索返回空结果；
- 每条 FAQ 作为一个检索单元，没有长文档分块、混合检索或 Reranker；
- `/api/faq/autocomplete` 已实现，前端输入框尚未接入自动补全 UI。

## 内容安全

`server/moderation/contentFilter.ts` 对 `/api/chat` 和 `/api/cs-agent/chat` 执行双向过滤：

| 类型 | 当前行为 |
| --- | --- |
| 敏感词 | 输入命中时阻断请求；输出命中时停止或替换流内容 |
| 隐私信息 | 对手机号、身份证、银行卡和邮箱等内容脱敏 |
| 提示词注入 | 标记风险并记录警告，不直接阻断 |

输出端使用滑动窗口扫描，避免敏感内容跨多个 SSE 分片绕过检查。

## 数据模型

SQLite 包含 7 张业务表：

| 表 | 用途 |
| --- | --- |
| `sessions` | 会话标题、模型与时间戳 |
| `messages` | 用户/助手消息、撤回状态与工作流元数据 |
| `faq_knowledge` | FAQ 问题、答案、分类和关键词 |
| `tickets` | 人工工单、状态、优先级和处理结果 |
| `conversation_intents` | 意图、置信度和 FAQ 命中记录 |
| `satisfaction_ratings` | 1～5 星评分和评语 |
| `users` | 用户、密码哈希和角色 |

## API 概览

### 公共与鉴权

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 登录并获取 JWT |
| `/api/auth/register` | POST | 管理员创建用户 |
| `/api/auth/me` | GET | 获取当前用户 |
| `/api/models` | GET | 获取当前 Provider 可用模型 |

### 会话、消息与聊天

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/sessions` | GET / POST | 获取或创建会话 |
| `/api/sessions/:sessionId` | GET / PATCH / DELETE | 会话详情、更新或删除 |
| `/api/messages/:msgId/recall` | PATCH | 成对撤回用户消息和后续助手回复 |
| `/api/sessions/:sessionId/export` | GET | 导出 JSON 或 Markdown |
| `/api/chat` | POST | 通用聊天 SSE，要求登录 |
| `/api/cs-agent/chat` | POST | 客服工作流 SSE，要求登录 |

### FAQ 与满意度

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/faq/suggestions` | GET | 按分类返回快捷问题 |
| `/api/faq/autocomplete?q=...` | GET | FAQ 问题联想 |
| `/api/satisfaction` | POST | 提交满意度 |
| `/api/satisfaction/stats` | GET | 满意度统计 |

### 管理后台

以下端点统一要求 `admin` 角色：

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/admin/dashboard` | GET | 仪表盘统计 |
| `/api/admin/conversations` | GET | 会话列表 |
| `/api/admin/conversations/:sessionId` | GET | 会话详情 |
| `/api/admin/stats/satisfaction` | GET | 满意度统计 |
| `/api/admin/stats/intents` | GET | 意图分布 |
| `/api/admin/stats/tickets` | GET | 工单统计 |
| `/api/admin/tickets` | GET | 工单列表 |
| `/api/admin/tickets/:ticketId` | PATCH | 更新工单 |
| `/api/admin/faq` | GET / POST | FAQ 列表或新增 |
| `/api/admin/faq/:id` | PATCH / DELETE | 修改或删除 FAQ |

## 当前安全边界

管理员 API 和两个聊天 API 已启用鉴权，但会话 CRUD、消息撤回、FAQ 推荐、导出和满意度端点目前没有统一挂载 `requireAuth`，数据库也没有把会话关联到用户。因此当前版本适合本地演示和功能验证，不应在未补充数据隔离与授权校验前直接部署为多用户生产服务。

另请注意：自定义 Agent 配置保存在浏览器 `localStorage`，不会同步到服务器或其他设备。

## 测试

```bash
npm test
```

截至 2026-10-25，`npm test` 的基线为 4 个测试文件、42 个测试通过。覆盖数据库 CRUD 与约束、消息成对撤回、意图分类、FAQ 数据校验和向量相似度。

内容安全模块另有一个手动自检脚本，当前未纳入 Vitest 配置：

```bash
npx tsx server/moderation/contentFilter.test.ts
```

## 路线图

- [x] FAQ 可视化管理
- [x] 内容安全过滤
- [x] 多轮上下文
- [x] 消息成对撤回
- [x] 快捷问题推荐
- [x] 会话导出（JSON / Markdown）
- [ ] FAQ 输入联想 UI（后端 API 已完成）
- [ ] 会话归属、接口授权与多用户数据隔离
- [ ] LangGraph 流式回调并发隔离
- [ ] Embedding 缓存持久化和离线降级检索
- [ ] WebSocket 实时能力
- [ ] CS Agent 多租户配置
