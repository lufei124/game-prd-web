# game-prd-web · 产品工作台

独立的本地优先产品工具网站：在同一界面整理需求、画可交互原型、编写和评审 PRD。适用于网站、App 等产品；游戏规范可通过扩展中心另行导入。

React + TypeScript、Node.js、SQLite 和本地文件，模块化单体。所有默认 Skills、模板和测试随本项目提供，启动不需要其他仓库。

## 启动

需要 Node.js 24+ 和 npm，在项目根目录运行：

```bash
npm ci
npm run build
npm start
```

打开 [本地工作台](http://127.0.0.1:4317/)。数据默认保存在根目录 `.data/`；可用 `WORKBENCH_DATA` 指定其他位置。服务仅监听本机。`npm run dev` 监听后端代码；已构建时提供 dist 静态页面，修改前端后重新运行 build；没有 dist 时自动挂载 Vite。

## 配置产品助手

默认 **Codex / gpt-5.6-terra / 中等思考深度 / ChatGPT 订阅登录**。无需填写 API Key：

1. 安装依赖并启动网站，进入「设置」。macOS 下自动发现依赖自带的 Codex CLI。
2. 点击「使用 ChatGPT 登录」，打开显示的官方登录页面，输入一次性代码并用订阅账号授权。账号可能需要在 ChatGPT 安全设置中启用 Codex 设备代码登录。
3. 页面自动更新连接状态，再到需求工作区提交任务。登录就绪不代表真实模型调用已验证；额度、可选模型和使用限制以账号为准。

网站登录独立保存于 `.data/codex-auth/`，不读取桌面账号。官方认证说明见 [Codex Authentication](https://developers.openai.com/codex/auth/)。可在设置中退出或取消登录。登录网络失败、超时可重试；服务重启后保留已完成登录。为避免凭证刷新冲突，同一网站同时执行一个订阅任务，其他任务会明确提示等待后重试。

如需 API 按量计费或指定 CLI，复制 `.env.example` 为 `.env` 后按需填写并重启：

```dotenv
# 可选：明确选择 API 计费；默认 subscription，即便设置了 key 也不会自动使用
WORKBENCH_CODEX_AUTH_MODE=api-key
WORKBENCH_CODEX_API_KEY=你的独立OpenAI_API_key
# 可选：覆盖自动检测的程序路径
WORKBENCH_CODEX_BINARY=/绝对路径/codex
# 可选 Claude 助手
WORKBENCH_ANTHROPIC_API_KEY=你的独立Anthropic_API_key
PORT=4317
```

Codex 严格目录隔离目前支持 macOS，其他系统可手动选择 Claude。不会静默切换供应商。API Key 按 API 计费，与订阅额度独立。

设置页、项目默认、本次任务均支持助手、模型 ID 和思考深度，优先级为任务 > 项目 > 系统。任务记录固定实际配置和 Skill/模板/知识版本。未配置时，手动编辑、资料导入、确认和版本管理仍可使用。

## 使用流程

1. 新建项目，添加长期知识或需求专用资料。支持 Markdown、TXT、PDF、DOCX、CSV 和图片；保留来源、原文件及解析状态。目录导入需先授权，默认没有授权目录。
2. 新建需求，选择完整流程、仅原型、仅评审或仅发布。完整流程先整理需求卡，再由用户确认具体版本。
3. 选生成 Skill、视觉风格和资料生成原型；可点击体验、批注、局部修改和恢复版本。已有原型默认仅视觉修改。无 UI 变化需用户明确豁免。
4. 确认原型后，按所选模板生成 PRD；支持手动编辑、选区 AI 修改、评审、终稿、Markdown 导出。原型或规则变化会标记关联 PRD 待同步。
5. 飞书交付先核对目标、终稿版本和附件，再手动确认。发布失败保留终稿，未知创建结果需核验，远端修改不会静默覆盖。

产品助手位于中间成果区下方：上方编辑或体验成果，下方对话、查看任务和输入指令。圆角输入框底部可添加资料、选择本次模型和思考深度，并提交任务。

项目页输入项目名称确认后移入回收站，可完整恢复。点击「清理回收站」，选择一个项目并再次输入名称，可永久删除项目、版本和关联本地文件，无法恢复。清理中断会保留待清理标记，可重试，重启也会继续清理；清理开始后不能恢复。远端飞书文档、独立备份和最小审计事件保留。运行任务、正在停止的任务或发布操作会阻止移入回收站。

## Skills、模板与插件

内置中文通用 Skills：需求整理、交互原型、低保真线框、PRD 编写与评审。另有清透薄荷/墨色编辑风格和研发执行版模板。

扩展中心支持本地目录、ZIP、公开 GitHub 仓库根目录、tree 子目录及 blob SKILL.md 文件链接。多 Skill 仓库需指定目录，私有或超过 20 MB 的仓库请改用本地目录/ZIP。保留资源目录，但不执行脚本或安装依赖。导入后检查权限/兼容状态，并在本次任务选择该 Skill。

详见 [扩展开发](docs/extensions.md)。

## 飞书

使用独立安装的 `lark-cli` 与操作系统钥匙串：

```bash
lark-cli config init
lark-cli auth login
lark-cli auth check --scope "docx:document:readonly docx:document:create docx:document:write_only drive:file:upload" --json
```

目标文档/文件夹需对当前身份可访问。更新整体替换正文，远端图片和评论可能受影响，发布前会提示。附件可包含资料原文件和原型 HTML，不将 localhost 当分享链接。真实租户权限、发布和附件上传需配置后实测。

## 测试与备份

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

也可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已安装的 Chrome。测试使用临时数据库和明确标记的 Mock；正式服务不提供 Mock 降级开关。macOS 沙箱测试需允许 sandbox-exec，本机 HTTP 测试需允许监听。

备份前停止服务，复制完整 `.data/`。其中包含数据库、原文件和隔离会话，不提交到 Git。迁移方式及独立性验收见 [迁移说明](docs/migration.md)、[验证记录](docs/verification.md) 与 [架构说明](docs/architecture.md)。本地不等于离线，用户发起 AI 任务时，相关选定资料会发送在线模型。
