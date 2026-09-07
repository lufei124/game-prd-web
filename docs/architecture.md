# 产品工作台架构

## 1. 产品边界

`game-prd-web` 是个人本地优先的产品需求工作台。正常 Web 流程只有一个主助手：Codex。

核心链路：

```text
新建需求
  → 自动检索项目知识
  → 需求澄清 / design tree frontier
  → 需求卡确认
  → HTML 原型生成与迭代
  → 原型确认
  → PRD
  → 可选多 Agent 评审
  → 用户裁决问题
  → 主 Codex 修改 PRD
  → 终稿
  → 可选评审讲解 HTML
  → 飞书 / Markdown / HTML 交付
```

阶段切换、确认、版本、删除和发布属于宿主权限。模型不能通过提示词改变这些业务状态。

## 2. 主要模块

### `server/domain.ts`

SQLite 业务状态与阶段门禁。

负责：

- Project / Requirement
- Artifact Version
- Confirmation
- PRD stale 关系
- 原型豁免
- 终稿
- 评审裁决

需求、原型和 PRD 都使用显式版本 ID。AI 只能产生候选或新版本，不能确认版本。

### `server/conversation.ts`

可信阶段路由。

聊天文本只是内容，不能通过“帮我切到 PRD”“确认需求”等关键词修改工作流。

新版 Web 的正常 `/chat` 请求强制使用 Codex。已有原型的普通对话修改自动标记为 `previewOnly`，避免 AI 直接覆盖正式版本。

### `server/tasks.ts`

负责任务冻结、上下文快照、候选、执行状态和重试。

任务快照包含：

- 当前需求
- 当前上游成果版本
- 自动检索知识
- 重点资料
- 当前模型与思考深度
- PRD 全局模板（仅 PRD 阶段）
- 对话历史与待确认问题

需求澄清的一次用户回答只关闭最近一个 waiting 回合中的 frontier 问题，不再把所有历史 open question 一次性标记为已回答。

已有原型修改采用：

```text
task.candidate
  ↓ previewOnly
用户预览
  ├─ 应用 → 创建新 prototype version
  └─ 放弃 → 正式 head 不变化
```

旧 `/tasks` 直接任务 API 仍保留历史 Skill / Style / Template 选择，仅用于数据迁移、历史自动化和测试兼容；新版 Web 不调用这些入口。

### `server/agent.ts`

阶段 Prompt 的可信宿主定义。

正常产品流程不从扩展中心加载执行 Skill，而是由代码内置：

- Requirement discovery
- Prototype
- PRD
- Review

需求澄清 Prompt 采用 design tree / frontier：事实由 Agent 检索，决策由用户回答；问题按前置依赖分轮，每个问题给出推荐答案。

PRD 阶段只读取全局 PRD 模板，不允许需求级/项目级模板覆盖。

`ClaudeRuntime` 暂时保留在底层用于历史兼容和旧测试，但新版产品 UI 不展示 Claude，正常对话路径也不会选择它。

### `server/codex.ts`

官方 Codex SDK 执行适配器。

每个任务：

1. 创建随机隔离工作目录。
2. 创建独立 `CODEX_HOME`。
3. 注入本次任务凭证。
4. 同步本机 Codex Skills 到隔离 `CODEX_HOME/skills`。
5. 启动受限 Codex thread。
6. 宿主预读业务上下文和相关资料。
7. 使用结构化输出回传 `content / metadata / patches / question / summary`。

正常任务禁用 Shell、任意 MCP、开放网络和其他项目目录。

### `server/codex-auth.ts`

管理订阅登录、API Key 模式和本机 Codex Skills 镜像。

Skills 来源：

```text
WORKBENCH_CODEX_SKILLS_DIR
  ↓ 未设置
~/.codex/skills
```

复制策略：

- 每个任务启动时重新同步
- 跳过 symlink / device
- 最多 5000 文件
- 总大小最多 100 MB
- 只复制到隔离任务 HOME

因此指令型 Skill 可以由 Codex 自动发现，同时不会给 Skill 额外文件系统权限。依赖 Shell 或外部工具执行的 Skill 仍会被宿主安全边界限制。

### `server/knowledge.ts`

知识解析和检索。

导入支持 Markdown、TXT、CSV、DOCX、PDF 和图片原文件。

检索流程：

```text
query
  → 英文/数字词 + 中文词/双字片段
  → 文档分块（约 1100 字符 + overlap）
  → 文件名 / 标题 / 模块 / 正文 / 完整短语加权
  → 每份文档保留 top chunks
  → 全局排序 top documents
```

实时检索只使用同一逻辑资料源的最新版本。旧版本继续留在历史任务快照中。

资料源同步是幂等的：相同 source + name 的文件如果二进制 hash 没有变化，不创建新的 knowledge version，也不复制重复原文件。

### `server/knowledge-tree.ts`

管理：

- 项目知识目录
- `knowledge.folderId`
- `knowledgeLink(requirementId, knowledgeId)`

`knowledgeLink` 用于“重点资料”。自动检索仍作用于整个项目，重点资料会强制进入当前需求任务快照。

### `server/review-panel.ts`

多 Agent 独立评审编排器。

每个角色使用同一冻结 PRD，但独立 SDK turn，不读取其他角色结论。默认角色为产品 / 交互设计 / 研发测试，Web 可以配置角色名称和 focus。

评审只提交 issues，不修改 PRD。用户通过 resolution 明确选择采纳、不采纳或稍后处理；主 Codex 只应用“采纳”的问题。

AI 评审不是终稿硬门禁。未启动评审时可以确认终稿，并记录 `reviewStatus=skipped`，而不是伪装为“评审通过”。

### `server/plugins.ts`

当前主要承载飞书读取和交付。

知识库读取飞书文档时只做 fetch，不写回源文档。PRD 发布是单独的显式用户操作。

### `web/main-v2.tsx`

新版 conversation-first UI。

页面只有四种主要形态：

1. 项目需求列表
2. 知识库
3. 设置
4. 需求工作台

需求工作台首屏是聊天框。只有产物出现后才展开右侧成果区。

原型使用 `srcDoc` 沙箱预览，并在预览副本中注入 inspector：用户点击 DOM 后将 selector、outerHTML、文本和 rect 通过 `postMessage` 返回宿主。正式保存的 HTML 不写入 inspector 脚本。

## 3. 前端阶段状态

### 需求阶段

```text
Conversation only
  ↓ 第一次形成需求卡
Conversation | Requirement Card
```

### 原型阶段

```text
Conversation | Interactive HTML
                  ↑
           click / select DOM
```

候选修改只在右侧预览，不修改正式 head。

### PRD 阶段

```text
Conversation | PRD editor
                 ├─ AI Review
                 └─ Review Brief HTML
```

PRD 支持人工编辑和 AI 修改。

## 4. 配置模型

### 系统设置

用户可配置：

- Codex 默认模型
- 默认 reasoning effort
- 全局 PRD 模板
- 全局多 Agent 评审角色

需求聊天框也允许本次任务临时改变模型和思考深度。

### 不开放的配置

以下属于产品行为，不提供 Web Prompt 编辑：

- 需求澄清 Prompt
- 原型 Prompt
- PRD 执行 Prompt
- 评审 Prompt

原因是这些 Prompt 与阶段门禁、结构化输出和版本模型共同构成工作流契约，不应被普通配置破坏。

## 5. 知识资料源

项目配置可以保存 `knowledgeSources`：

- `directory`
- `feishu`

关联时立即同步；用户也可以手动同步。知识库页面打开期间每 10 分钟执行一次 best-effort 周期同步。

本地目录首次关联时会把精确路径加入 `authorizedRoots`，目录读取仍需经过 `directoryFiles()` 的 realpath、symlink、文件数和总体积校验。

解除资料源只停止后续同步，不自动删除已经进入知识库的历史资料。

## 6. 安全边界

HTTP：

- loopback Host only
- same-site session cookie
- Origin check
- CSRF
- no-store API responses

原型 iframe：

- no same-origin
- no network
- no form submit
- no iframe/object/embed/base

Codex：

- isolated HOME
- isolated cwd
- subscription credential mutex
- shell disabled
- arbitrary MCP disabled
- no other project filesystem
- task credential removed after run

知识和 Skill 文本都是不可信内容，不能扩大权限。

## 7. 版本与依赖

```text
Requirement vN
      ↓
Prototype vN
      ↓
PRD vN
      ↓
Review vN (optional)
```

修改 Requirement：取消下游 prototype confirmation，并令已有 PRD stale。

修改 Prototype：令已有 PRD stale。

修改 PRD：旧 Review 不再代表当前 PRD 的直接评审，但评审和用户 resolution 仍保留历史追溯。

终稿只允许当前 PRD head 且 `stale=false`。

## 8. 兼容层

仓库仍包含：

- `server/extensions.ts`
- 旧内置 SKILL.md / Style release
- `ClaudeRuntime`
- 旧直接任务 API

它们暂时只服务历史数据、迁移与兼容测试。新版 Web 不再显示扩展中心、阶段 Skill 选择、风格 Skill 选择或 Claude 配置。

全局 PRD 模板目前仍利用旧 template release 作为底层版本容器；后续可以在完成数据迁移后再删除 Extension 子系统，而不是在本次 UI 重构中破坏历史记录。

## 9. CI

GitHub Actions 使用 macOS + Node.js 24：

```bash
npm ci
npm test
npm run build
```

选择 macOS 是因为当前生产 Codex 启动器依赖 macOS `sandbox-exec` 目录隔离模型。
