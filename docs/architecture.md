# 产品工作台架构

## 1. 产品边界

`game-prd-web` 是个人本地优先的产品需求工作台。正常 Web 流程只有一个主助手：Codex。

核心链路：

```text
新建需求
  → Context Orchestrator 构建冻结 ContextPack
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
- 经过 Recall Policy、FTS、rerank、Source Reader 与预算控制的 `contextPack`
- 重点资料解析后的相关 ContextItem
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

应用与放弃都通过任务级受控接口落库并记录审计；前端不能绕过候选任务直接把 AI 内容保存为正式版本。

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

服务端只有 Codex 执行器，认证固定为 ChatGPT 订阅登录。

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

管理 ChatGPT 订阅登录和本机 Codex Skills 镜像。

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

知识解析、版本化导入与兼容搜索 API。

导入支持 Markdown、TXT、CSV、DOCX、PDF 和图片原文件。

知识上下文流程：

```text
Source sync
  → Source / Document / immutable DocumentVersion
  → heading-aware persistent chunks（约 1100 字符 + 160 overlap）
  → 英文/数字词 + 中文词/双字片段 search_text
  → SQLite FTS5

Task create
  → Recall Policy / deterministic Query Plan
  → session + project scope filter
  → FTS top 30 candidates / 每 Document 最多 3 个
  → metadata rerank / document diversity
  → frozen Source Reader / neighbor expansion
  → dedupe / current-version filter / token budget
  → citation assembly
  → frozen ContextPack + RecallTrace
```

`server/context-orchestrator.ts` 是新任务唯一的 Knowledge Context 构建入口。Search API 只用于 UI/调试候选检索，不等于 Agent Context。实时检索只使用逻辑文档的 current version；旧版本和旧 `snapshot.knowledge` 继续用于历史任务回放。

默认预算：chatOnly 3000、requirement 5000、prototype 5000、PRD 6500、review 5000（近似 token）。ContextItem 使用稳定的 `K1/K2...`，Requirement/PRD 的重要知识事实必须引用这些 ID。知识正文始终标记为不可信参考，不能授予确认、文件、Shell、网络或发布权限。

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

需求卡、原型和 PRD 的历史回退会以所选历史版本为内容创建新版本，不移动或覆盖历史 head。工作区可以在已经生成的三类成果间切换，以便从终稿阶段回到上游继续修改；上游正式版本变化后下游进入 stale 状态。评审讲解版本由 SQLite 保存，并显式关联生成时的 PRD version；当前 PRD 变化后旧讲解只保留作追溯。

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

需求聊天框也允许本次任务临时改变模型和思考深度。模型和思考深度都从工作台内置列表选择，不提供手写 ID 或系统下拉框。

ChatGPT 订阅登录在主界面右上角完成；设置页只保存默认模型和思考深度，不再承载登录入口。

### 不开放的配置

以下属于产品行为，不提供 Web Prompt 编辑：

- 需求澄清 Prompt
- 原型 Prompt
- PRD 执行 Prompt
- 评审 Prompt

原因是这些 Prompt 与阶段门禁、结构化输出和版本模型共同构成工作流契约，不应被普通配置破坏。

## 5. 知识资料源

Canonical state 是 `knowledgeSource` entity，支持：

- `directory`
- `feishu`

旧 `project.defaults.knowledgeSources` 会幂等迁移并暂时保留读取兼容。关联时立即同步；用户也可以手动同步。知识库页面打开期间每 10 分钟执行一次 best-effort 周期同步。

Source 下是稳定 `knowledgeDocument`；既有 `knowledge` 记录作为不可变 DocumentVersion。Local 用 source 内 normalized relative path 识别文档、SHA256 判断内容变化；飞书用 document token 识别，保存 revision、URL、远端更新时间（若 API 返回）和同步时间。相同 hash 只刷新同步元数据，不制造重复文本版本。

Local Source 同步结束后使用本次扫描到的 relative path 集合对账。缺失文档标记为 `deprecated / source_missing`，不删除 DocumentVersion、Chunk、Pinned link 或历史 ContextPack；相同文件重新出现时恢复 `active`，且相同 hash 不创建新版本。

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
- `srcDoc` 预览副本注入 CSP，只允许内联脚本/样式及 data/blob 图片

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
- 旧直接任务 API

它们暂时只服务历史数据、迁移与兼容测试。新版 Web 不再显示扩展中心、阶段 Skill 选择或风格 Skill 选择。

全局 PRD 模板目前仍利用旧 template release 作为底层版本容器；后续可以在完成数据迁移后再删除 Extension 子系统，而不是在本次 UI 重构中破坏历史记录。

## 9. CI

GitHub Actions 使用 macOS + Node.js 24：

```bash
npm ci
npm test
npm run build
```

选择 macOS 是因为当前生产 Codex 启动器依赖 macOS `sandbox-exec` 目录隔离模型。

## 10. MVP 后续边界

MVP 不包含 User/Team/Workspace Scope、Vector/Embedding、Recall LLM Subagent、自动 Learning、Knowledge/Code Graph、AST、Git/Notion/Web Connector 或语义冲突裁决。V2 可在 RecallTrace 证明词法召回不足后评估 User opt-in、Candidate Learning（必须用户确认）、Recall Quality 和可选 Vector；V3 再评估团队域、连接器、图谱与自动治理。

## 11. Workspace 前端呈现层（2026-09-08）

导航与工作区继续调用既有版本/确认/候选/评审/发布接口。新增 `web/components` 中的 DocumentEditor、ExecutionStatus、CommandMenu、KnowledgeDocument 与 useArtifactDraft；`web/workspace.css` 提供统一呈现层。UI 草稿缓存不参与 Domain 状态、不授予确认或覆盖权限，冲突时阻止保存并保留用户文本。

知识列表继续省略正文。`GET /api/knowledge/:id/document` 只读取指定 immutable knowledge version 的 id/text/status，拒绝已删除资料，不写入状态。引用通过成果 task 的冻结 ContextPack 寻找 knowledgeId，人工修订沿父版本查找；绝不把历史引用替换为当前知识版本。上传新增可选 displayName 字段，保留 UTF-8 文件显示名，移除路径部分；原文件仍使用宿主生成 ID 存储。

Inspect 的 postMessage 只接收当前原型 iframe，Escape 可以从 iframe 传回。预览副本继续使用 CSP 与 allow-scripts sandbox；历史预览同样隔离。Markdown 不执行 HTML。所有生成/确认/Apply/Discard/终稿/飞书审批状态沿用现有逻辑。完整交互结构见 `docs/ux-redesign.md`。

## 12. 项目与需求回收站

项目删除继续使用既有 `projectTrash` 快照。新增 `requirementTrash` 记录（存储于现有 entities，无 schema 或数据迁移）：用户提供完整名称后，事务移入 requirement 及 requirementId 归属的全部实体。版本、确认、任务冻结快照、需求知识版本与文档保持原 ID；原文件和检索分块暂时保留，正常查询不返回已移出的知识实体。

`DELETE /api/requirements/:id` 校验名称、实际运行任务与发布锁；Domain 同时拒绝 Agent、queued/running/waiting 任务及 writing 发布。`POST /api/requirements/:id/restore-deleted` 要求父项目存在，逐项检查 ID 冲突，事务恢复且不覆盖现有实体。bootstrap 仅暴露回收站摘要，不返回内部快照。

项目删除包含 requirementTrash；恢复项目不自动恢复此前单独删除的需求。既有项目永久清理递归纳入这些需求的附件、任务目录和交付文件，避免漏清理。普通删除入口移入回收站；回收站提供输入完整名称确认的永久清理入口。需求清理复用文件安全检查与可重试墓碑，按 requirement_id 删除索引，保留公共资料及其他需求。清理时禁止恢复或删除所属项目；重启后续跑未完成清理。

## 本地 Draft Recovery

`useArtifactDraft` 的 localStorage key 为 `forge:artifact-draft:v1:{requirementId}:{artifactKind}:{baseVersionId}`，保存文本、原始文本和基础版本编号。700ms debounce 加页面隐藏/卸载补写，仅供浏览器恢复；服务器仍是业务状态源。新会话明确恢复，同版本可继续编辑，异版本只读查看；保存后移除对应备份。存储容量或权限失败会显示提示。CI 复用已有 executablePath 配置运行 Mock smoke，不要求下载 Playwright Chromium。

### 可拖动左右分栏

桌面端导航、对话与成果、文档大纲与正文、编辑与预览、知识来源与文档，以及知识文档侧栏支持拖动调宽。悬停分隔线显示反馈，双击恢复默认，方向键以 10px 调整（Shift 为 40px）。宽度按布局类型保存在当前浏览器；设置最小宽度与可用空间约束，窄屏使用原响应式布局。布局偏好不改变业务数据。

### 可选原型与保真度

需求卡可选择“跳过原型，生成 PRD”；已有原型阶段也可明确跳过。复用当前需求版本的用户 waiver，需求改版后需重新确认，Agent 不得自行跳过。每次原型生成同时交付线框图与高保真，共用业务 DOM/脚本、独立视觉 CSS；下拉框即时切换查看，不请求模型或创建版本。页面与交互解释并排显示，跟随当前版本/候选。默认 iPhone 17 Pro 402×874，支持切回自适应预览。设置页移除 Codex 卡片，账号在右上角管理，模型与思考强度仍在对话输入区选择。

按用户指定参考外部原型 Skill 的画布、线框、交互状态和说明规则，已将规则写入当前 defaults；运行时不读取外部仓库。默认资源按既有机制追加 release，用户编辑过的扩展不自动覆盖。

### 双视图与说明契约

新原型任务冻结 dualPrototype 要求，提交候选时校验两份具名样式和逐页 presentation.explanations，保存时再次检查。历史单视图继续可读，不覆盖旧版本或历史任务快照。双视图共享业务逻辑并同时迭代，说明不使用其他版本的数据；下拉查看切换保留当前演示状态。原型旁新增可拖动解释栏，窄屏上下排列。

基于历史单视图创建的新原型任务同样必须补齐双视图和逐页解释。历史兼容只允许读取旧版本，不得关闭新任务的双视图校验；补齐通过新版本/候选完成，不回写旧版本。

### 原型缩放

原型工具栏按 25%–200% 调整预览比例，偏好保存于浏览器 `forge:prototype-zoom`。外部缩放容器负责显示尺寸，iframe 内部 iPhone 17 Pro 画布保持 402×874；自适应模式按画布可用宽度计算。缩放不重载成果、不修改版本或触发模型，放大时保留滚动访问。
