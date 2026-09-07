# 独立产品网站架构

## 模块与状态

- `server/index.ts` 从自身项目目录启动，createApp(dataRoot, options?) 初始化应用；bootstrap(store) 只读取项目自带的 defaults。
- `server/domain.ts` 和 SQLite 是唯一业务状态源。版本、确认、任务、资料和交付分别存储；AI 保存通过基础版本与阶段门禁，不能直接确认/删除/发布。
- `server/tasks.ts` 固定本次 Skills、模板、知识与模型参数。取消、失败、重试及刷新保留状态，重试使用原快照。
- `server/agent.ts` 使用 Claude Agent SDK 及受控 MCP；`server/codex.ts` 默认调用官方 Codex SDK，接收冻结输入与选定资源，输出候选或问题。模型循环由 SDK 管理；宿主负责最终版本校验。
- `server/extensions.ts` 管理标准 SKILL.md 资源、版本和权限；`server/knowledge.ts` 管理文件解析、词项检索、来源与解析状态；`server/plugins.ts` 提供受审插件注册及飞书适配。
- `web/` 为黑白灰 React 界面；产物和状态可见，原型通过无 same-origin 与网络权限的 iframe 预览。

## 默认资源与迁移

defaults 提供五个通用阶段 Skill、三种风格、默认 PRD 模板和原型契约。只把本任务选中的内容送入模型；Claude 可受控读取资源，Codex 由宿主预读选中 Skill 的直接文本引用。不扫描任何相邻仓库。

首次初始化或升级以事务创建内置版本并记录 migrations.version=2 与 standaloneDefaultsRevision=1。未编辑的旧系统扩展升级为通用 release，保留 extension ID、启停与绑定；历史 release、任务和成果不改写。有用户编辑/导入/回退历史的扩展不自动替换。已有默认选择和模型配置保留，缺少的默认项由内置资源补齐。

迁移识别代码可能包含旧来源标识，用于匹配数据库历史记录；它们不是可访问的路径。旧自动目录授权移除，其他用户授权保留。历史资料来源字符串仍用于追溯，原文件读取只使用本地保存的文件 ID。

## 安全与边界

HTTP 只允许 loopback Host、同站 Cookie、Origin 和 CSRF。Skills、资料和模型返回均不能扩大权限。ZIP 限制大小并阻止路径穿越、软链接及任意脚本执行。API 密钥仅从服务端环境加载；订阅认证由官方 CLI 设备登录完成并保存在私有 codex-auth 目录，不返回前端或送入 Prompt。设备登录只展示白名单官方地址及临时代码，原始进程输出不进日志。每次任务使用隔离 HOME，只暂存必要认证文件，结束时原子保存刷新结果并移除任务凭证。订阅执行采用互斥，阻止并发刷新和执行中退出；Codex/Claude 会话及目录隔离。

确认与版本绑定；终稿和发布状态独立；原型变化使关联 PRD 待同步。飞书写入前检查远端版本、用户确认、目标和幂等记录，未知结果必须核验。项目回收站以事务保存关联实体，恢复检查 ID 冲突；进行中的任务和发布锁阻止删除。永久删除需可信界面和完整名称确认，先持久化 purging 标记再删除归属文件，最后移除回收站实体；异常或重启可重试，标记期间禁止恢复。文件路径限于宿主生成的标识，拒绝软链接父目录；保留最小审计和远端文档。

首版为个人本地服务，不支持多人实时协作、任意第三方代码、公共插件市场或原型在线托管。SQLite、原文件与凭证不能直接暴露公网。

## 知识目录与引用

`knowledge-tree.ts` 管理 knowledgeFolder（projectId / parentId）、knowledge.folderId 与 knowledgeLink（requirementId / knowledgeId）。目录属于项目，移动和引用都校验归属；目录路径只用于展示，不参与磁盘路径拼接。文件仍使用宿主生成的 ID 存储。

Knowledge 初始化执行幂等旧模块迁移，仅补充资料 folderId 并创建目录；历史任务、release 与确认不变。删除采用 deletedAt 使资料退出实时目录和检索，并删除关联 knowledgeLink；原文件保留用于旧任务快照。任务启动将需求引用与 @ 对应 referenceIds 合并校验，再冻结选定资料。知识提案 HTTP 入口和页面已经移除，旧记录仅供兼容历史。

## 对话回合与执行启动

`conversation.ts` 按可信请求的 stage 与 action 路由，无 stage 的旧客户端按数据库当前阶段回退，不解析聊天关键词选择阶段或扩展。普通聊天可以只回复，需求澄清充分后提交需求卡。确认仍受 Domain 门禁控制；确认需求后 UI 进入原型，确认原型后进入 PRD，不自动发起模型调用。

`codex-launcher.ts` 是宿主可信启动器：只接收 SDK 参数，将其随机临时目录中的 schema.json 复制到任务目录，再以该目录为 cwd 启动受限 Codex；中止信号转交子进程。OS 沙箱继续拒绝其他项目与本机 API，只为 DNS 允许固定 mDNSResponder 服务路径。真实订阅最小诊断已经成功，测试 Mock 与真实诊断记录分开。

### 产品助手对话

工作台只保留一个产品助手，默认通过 Codex SDK 自然聊天、逐轮澄清需求。普通问答不强制生成成果，需求澄清后自动将需求卡更新到右侧成果区；对话区显示交流与必要的思考、停止和重试状态，详细执行记录位于右侧“执行状态”。历史和版本保存在 SQLite，确认与发布仍需用户操作。保留现有独立凭证、工作目录及可选 Claude 配置，真实在线调用待实测。

助手输入框支持 Return 发送、Shift + Return 换行；输入法组字时不发送，@ 资料候选优先由 Return 选择。空消息或任务执行中不重复发送。

### 阶段配置与独立评审

`PATCH /requirements/:id/assistant` 保存需求级配置，校验类型、阶段和项目可用性。每阶段一个执行 Skill，prototype 一个 style，prd 一个 template。单次显式请求、需求、项目、系统逐级回退，最终 release 固定进任务快照。页面提供四阶段 Skill、风格单选和模板正文。

`review-panel.ts` 编排三个新的 SDK turn，读取同一冻结输入而不共享结论。角色列表冻结在 snapshot，独立会话 ID 保存在 sessionIds。报告经 reviewSchema 校验后统一编号，仅提交一个最终评审候选。失败或取消不提交部分结果。Tasks 和 Domain 继续校验基础版本；评审后的普通对话路由到 PRD 修改，显式评审操作重新评审。终稿必须绑定当前 PRD 的评审及用户裁决。
