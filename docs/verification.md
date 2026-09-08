# 独立项目验证记录

## 2026-09-08 · 模型列表与右上角登录

- `npm test`：58 passed，0 failed。模型调用仍是 SDK/Runtime Mock。
- `npm run build`：TypeScript 与 Vite 通过；1590 modules，JS 272.47 kB（gzip 86.94 kB），CSS 43.42 kB（gzip 9.23 kB）。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e`：14 passed（20.0s）。覆盖输入框与设置页的自定义模型/思考深度列表、设置持久化，以及设置卡内不再出现登录按钮。
- 真实 Chrome 截图确认：输入框为胶囊列表、设置页为设计列表、登录在主界面右上角。证据见 `docs/ux/model-picker-start.png`、`docs/ux/model-list-settings.png`、`docs/ux/effort-list-settings.png`、`docs/ux/account-login.png`。
- 没有发起真实订阅登录或在线模型调用。没有提交、推送或部署。

## 2026-09-08 · Product Agent Workspace 重设计验收

本节为当前重设计结果；下方保留的 2026-09-07 记录描述历史版本，不代表当前 UI 或服务状态。

- 修改前：读取实际代码，启动隔离 Mock 工作台；真实 Chrome 跑原版 6 条 E2E，全部通过；观察并保存首屏、原型、PRD 截图后再实施。
- `npm test`：55 passed，0 failed，0 skipped。包括真实本地 HTTP 安全与 macOS sandbox-exec 检查；模型调用是 SDK/Runtime Mock。
- `npm run build`：TypeScript 与 Vite 通过；1586 modules，JS 259.92 kB（gzip 83.10 kB），CSS 38.87 kB（gzip 8.37 kB）。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e`：11 passed（16.7s）。运行真实本机 Chrome；默认 Playwright 下载浏览器不存在，因此使用项目现有 executable 环境变量支持，无需新增浏览器依赖。
- `git diff --check`：通过，无输出。
- 干净目录 `/private/tmp/game-prd-ux-clean-FICuo5`：不包含相邻仓库、真实 `.data`、`.env` 或 Git；复制项目源码和已经安装的依赖，55 项测试通过，最终前端构建通过。没有重新下载安装依赖。
- 初次在外层执行沙箱内运行时，本地监听和嵌套 sandbox-exec 受限；在获准的测试运行环境中重跑通过，没有修改产品沙箱策略。

浏览器覆盖原有确认、候选 Apply/Discard、历史 Restore、stale PRD、可选评审/终稿血缘、Show Me 新旧版本、Markdown/HTML 导出和飞书显式发布 Mock。新增覆盖就地 Inspector、候选对照、快捷应用、命令菜单、草稿跨面板保留/并发冲突、来源筛选/空搜索/知识版本、中文附件、IME、停止/失败重试、45 节文档与冻结引用预览。

响应式实测宽度 1512、1280、900、600、390。检查横向溢出、独立滚动、成果操作与 Composer 可访问。截图已人工观察，精选证据见 `docs/ux/`，详细边界见 `docs/ux-redesign.md`。

没有发起真实模型调用、真实飞书同步/发布或正式数据迁移。没有提交、推送或部署。未保存草稿仅在当前页面生命周期保留；完整 GFM 富文本和逐字符 diff 不在当前实现范围。

日期：2026-09-07。以下区分真实本地执行、测试 Mock 与待配置服务。

## 本次更新：订阅登录、中央助手与永久删除

- 干净目录 `/private/tmp/game-prd-subscription-clean-lqrng9n4` 完成 npm ci、构建、34 项后端测试和 6 项浏览器测试；不带用户数据、既有依赖或相邻仓库。
- 假 CLI 测试覆盖设备代码、登录完成/取消、独立凭证刷新、并发互斥、失败后的临时凭证清理；SDK Mock 继续验证模型与思考深度传递。没有进行真实账号授权或模型调用。
- 浏览器验证助手与成果区同宽、位于成果下方且输入框可见；登录入口展示白名单官方地址和测试代码。
- 永久删除验证身份限制、名称确认、归属文件删除、其他项目保留、软链接拦截、清理中断与重试；浏览器验证删除后刷新不能恢复且本地草稿移除。
- 本机 4317 已从 game-prd-web 重启，默认 subscription，自动发现安装依赖附带的 Codex。尚未登录，明确显示待登录。实际项目和回收站均未执行删除。
- 真实订阅登录、账号额度/模型权限及飞书调用仍待用户配置后实测。

## Codex 启动修复与多轮需求对话

- 复现并修复：SDK 继承网站 cwd 导致 OS 沙箱拒绝启动；SDK schema 在系统临时目录，现由受控启动器复制进任务目录。仅增加固定 mDNSResponder Unix socket 访问，未启用宽泛 system-socket 权限。
- 无凭证诊断已从 EPERM / DNS 错误进展到预期 401；真实订阅诊断使用 gpt-5.6-terra / low，成功返回结构化候选。只发送固定连接测试文字，无项目或知识库内容。第一次 medium 诊断 60 秒超时，第二次低深度成功，不将超时标为成功。
- 干净目录 `/private/tmp/game-prd-chat-clean-7gkl1fsj` 安装、构建、38 项后端测试、8 项浏览器测试通过；覆盖阶段 Skill 自动选择、显式风格请求、连续问答与需求卡版本更新、临时 schema 和越权文件隔离。
- 对话设置面板移除，需求阶段通过聊天逐轮生成文档；当前本地服务已更新。真实飞书交付仍未实测。

## 知识库目录与需求引用

- 干净目录 `/private/tmp/game-prd-knowledge-clean-fcfc8cvi` 完成安装、构建、36 项后端测试和 7 项浏览器测试。
- 覆盖旧模块幂等迁移、子目录与跨项目校验、需求资料引用幂等、删除清理引用、旧快照与原文件保留，以及界面 @ 选择实际传递 referenceIds。模型执行仍使用 Mock。
- 正式服务无运行任务时停止并备份完整数据到 Git 忽略的 `backups/knowledge-tree-20260907-200132/`，随后在 4317 启动新服务。
- 原实体逐项核对不变（资料仅补充 folderId），1 个原文件 SHA-256 一致；SQLite 完整性正常。现有资料位于根目录，网站 HTTP 200。备份与知识库数据均未提交。

## 白色输入框与模型菜单

- 输入框统一白色主题，移除底部“由你确认”字样；模型菜单使用浏览器原生 Popover，在按钮旁展开并支持点外部/Esc 关闭。
- 构建、34 项后端测试、6 项浏览器测试通过；模型和思考深度从菜单选择后与任务配置保持一致。已检查实际渲染截图。

## 三栏布局调整

- 根据新的标注图，将资料、对话和成果按从左到右排列；任务配置默认收起，输入框固定在对话栏底部。
- 构建、34 项后端测试和 6 项浏览器测试通过。测试确认对话与成果左右并列、等高、输入框在视口内，对话可见高度超过 250px；已检查实际渲染截图。

## 输入框参考图调整

- 输入框改为深灰圆角容器，底部附件、模型/思考深度入口和圆形发送按钮均复用真实任务功能。
- 构建与 34 项后端测试通过；浏览器回归增加输入框修改模型/深度后与任务配置一致的校验。
- Git 状态确认：独立仓库已存在，提交数为 0，无远端；数据、依赖和 .env 被忽略。

## 已验证

- 在 `/private/tmp/game-prd-web-clean-2cpi0fug` 放置自包含项目文件，不带旧仓库、现有 node_modules 或用户数据；执行 npm ci、npm run build、npm test、npm run test:e2e。
- 31 项 Node 测试通过：阶段确认、版本与任务快照、取消/重试/恢复、原型局部修改、PRD 同步、中文扩展、目录/ZIP/GitHub 安全、文档解析及独立迁移。
- 5 项浏览器测试通过：完整原型到 PRD 流程、两种风格、确认/恢复、自定义模板、原型隔离、草稿刷新、模型/深度设置、项目回收站、GitHub 导入入口和失败提示。
- 干净目录的正式入口在临时 4319 端口启动成功：runtime=live，内置 8 个扩展，默认 Codex，默认授权目录为空；检查完成后已停止该临时服务。
- macOS OS 沙箱真实拒绝越权读文件与目录内逃逸软链接；官方 Codex CLI 在受限目录内执行 --version 成功，未传凭证或调用模型。
- 新项目构建通过。正式 4317 进程 cwd 为 `/Users/luffy/工作/UGit/game-prd-web`，存储目录为本项目 `.data/`。
- 旧数据复制前后文件校验一致。升级后 SQLite integrity_check=ok，保留原有 8 个 release、8 个 extension ID、2 个回收站记录及 2 条审计记录；系统设置升级为自包含默认资源。迁移时没有活跃项目或需求，回收站原内容逐实体核对不变。
- 旧仓库仅撤销本次添加的四份文档内容；新增应用目录移入私有备份。清理后旧仓库 git status --short 为空。
- 新 Git 仓库仅初始化，无提交、无远端。数据、密钥、依赖、构建和测试输出均被忽略。

## Mock 与真实外部能力

模型生成测试使用 MockRuntime，Codex SDK 参数/输出测试使用显式 SDK Mock；真实模型质量、账号权限和长任务行为待配置后实测。正式服务 Codex 显示待配置，不自动共享桌面登录。

飞书幂等、冲突、附件和失败恢复使用 MockLark。没有执行真实远端发布。GitHub 解析/安全及界面错误处理有测试；先前已只读下载公开 SKILL.md 子目录资源，本次独立化没有执行任何下载脚本。

## 当前边界

严格 Codex OS 沙箱当前支持 macOS；其他系统不提供备用执行器。PDF/DOCX 解析使用库，扫描资料不假装已 OCR；跨文档语义冲突仍需助手和用户核对。模板条件是写作指引，不是强制章名或模板语言。

个人本地服务尚不支持实时协作、任意插件代码、公共市场、双向同步或原型托管。终稿、发布、删除、正式知识采纳仍有可信用户确认门禁。

## 文档与迁移

新项目有独立 AGENTS、README、CHANGELOG、架构/扩展/迁移说明和核验脚本。原 Skill 正文、知识包、安装与 CLI 规范未改动，无需维护或同步它们。

备份位置在两个项目之外：`/Users/luffy/工作/UGit/.game-prd-web-backup-20260907-191444`。original-workbench 为迁移前完整备份，retired-workbench 为退出旧仓库的原目录，old-documents 与 patch 保留撤销前文档；备份目录不属于新 Git 仓库。

## 设置页精简与登录状态

- 设置页保留助手配置状态、默认模型及必要操作，SDK、配置方式与登录目录折叠在「配置详情」。
- 已配置的 Codex 不再展示订阅登录入口与旧验证码；退出确认后才恢复登录入口，授权等待期间只能取消。
- 服务端重复登录请求直接返回已有配置状态，不创建新的授权流程。
- 验证：npm test 38 项通过；npm run build 通过；使用本机 Chrome 执行 npm run test:e2e，8 项通过。重新构建后全流程回归通过。
- 登录测试使用假 CLI 与浏览器 Mock，未退出真实账号、未发起真实授权或模型调用。

### Codex 聊天模式验收（2026-09-07）

- `npm test`：39 项通过，包含聊天历史、固定 Codex 与禁止成果写入的 Mock 测试。
- `npm run build`：通过。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e`：9 项通过，包含聊天发送与刷新恢复。使用本机 Chrome，测试服务为 Mock。
- 未进行真实在线模型调用；Codex 登录和在线回复需在实际配置环境验收。

### 统一产品助手对话验收（2026-09-07）

已替代此前双模式界面。`npm test` 39 项通过，`npm run build` 通过，本机 Chrome 的 `npm run test:e2e` 9 项通过。Mock 覆盖普通问答不生成版本、逐轮提问、回答后右侧需求卡更新、对话区无成果任务卡片、Return 发送与刷新恢复。执行记录改从右侧“执行状态”展开。真实 Codex 在线澄清效果待实测。

### 对话流程、阶段配置与评审验收（2026-09-07）

- `npm test`：42 项通过，包含明确阶段、不按关键词切换、默认 scope=layout、需求级风格选择、三个独立评审调用及部分失败不提交、升级备份与用户扩展保护。
- `npm run build`：通过。
- 使用本机 Chrome 的 `npm run test:e2e`：10 项通过，覆盖需求确认→原型→PRD→评审→终稿，以及阶段 Skill、单选风格、模板预览、配置刷新恢复。
- 将源码、内置 defaults 和实际依赖复制到不含相邻仓库的临时目录，运行 standalone 和 workflow 验收：5 项通过。
- 模型和发布验收使用 Mock。真实 Codex 多会话评审质量及在线澄清待实测，未提交、推送或部署。

### 项目与需求删除、恢复验收（2026-09-08）

- `npm test`：58 项通过，覆盖可信用户与名称确认、运行中任务阻止删除、关联版本与快照恢复、恢复冲突回滚，以及已删除需求随项目回收和清理。
- `npm run build`：通过；`git diff --check`：通过。
- 使用本机 Chrome 执行 `npm run test:e2e`：12 项通过，覆盖项目管理入口、列表和工作区删除、名称确认、取消、回收站恢复及手机宽度。
- 独立目录 `/private/tmp/game-prd-delete-clean-ioXROn` 不包含相邻仓库、用户数据和凭证，58 项测试及构建通过。
- 删除操作只在临时测试数据上执行，未删除用户项目或需求。模型与发布仍使用 Mock，真实在线服务待实测。

### Draft Recovery 与 E2E CI smoke（2026-09-08）

- `npm test`：58 项通过；`npm run build` 和 `git diff --check` 通过。
- 本机系统 Chrome 完整 `npm run test:e2e`：14 项通过。覆盖需求卡与 PRD 刷新恢复、显式恢复前不覆盖正式内容、旧版本只读预览/放弃、保存后清理，以及浏览器存储异常提示。
- 新增独立 `@smoke`：新需求 → 需求卡 → 确认 → 原型 → Candidate → Apply → PRD；已通过本地执行。GitHub CI 在 build 后定位系统 Chrome 运行该测试，失败时保留测试附件。
- GitHub 托管运行仍待后续推送验证；本轮未提交或推送。真实 Codex 与飞书继续待真实环境验收。

### 可拖动左右分栏验收（2026-09-08）

- `npm test` 58 项通过，`npm run build` 与 `git diff --check` 通过。
- 本机 Chrome 完整 E2E 15 项通过，新增实际鼠标拖动、刷新持久化、双击重置、大纲键盘调宽、编辑/预览分栏、知识分栏和手机无横向溢出验证。
- 知识文档侧栏定位调整后，专项浏览器测试再次通过，确认从左边缘向左拖动可增大侧栏宽度。
- 本次仅修改布局交互与偏好存储，未提交或推送。
