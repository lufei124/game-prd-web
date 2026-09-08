# 自包含原型契约

content 为完整 HTML，metadata 与 HTML 中 `<script id="prototype-meta" type="application/json">` 的 JSON 完全一致。不要添加 Markdown 代码围栏。

metadata：schemaVersion 为 "1.0"；requirementName 为本需求名称；module 为模块；prototypeVersion 为 "v0.1" 等版本；prototypeStatus 为 "Draft"（确认仅由应用写入）。

- device: {orientation: "portrait" 或 "landscape", platform: ["web"]}，按实际原型选择方向；Web 可响应式。
- scope: {included: [本次范围], excluded: [明确非目标]}；included 至少一项。
- pages: [{id, name}]；每个页面有唯一 ID。
- scenarios: [{id, entry, flow: [操作步骤], result}]；每项描述可体验的完整流程。
- states: [{id, description}]；覆盖主流程及必要异常或空状态。
- decisions: [{id: "D-001", summary, status: "已确认"、"待确认"、"已排除"或"已替代"}]；仅有可信确认依据时使用已确认。

各列表 ID 必须唯一，页面、场景和状态不得为空。所有按钮有真实本地交互或明确不可用原因，禁止请求工作台接口、外网或嵌套第三方页面。演示数据仅用于体验，不冒充真实业务结果。


## 双视图评审包

新原型必须在同一个 HTML / Version 中同时包含线框图和高保真视图，共用页面 DOM、业务 JavaScript 和 metadata；不是两个独立任务或独立确认流程。

- 完整视觉样式分别置于唯一的 `style#prototype-high-fidelity` 和 `style#prototype-wireframe`。可以另设共用结构样式，但两份视觉样式必须真实完整，不能为空、占位或只加滤镜。
- 默认 `<html data-prototype-view="high">`。样式按 `html[data-prototype-view="high"]` / `html[data-prototype-view="wireframe"]` 限定；切换属性即可呈现对应视觉。线框使用灰阶描边、图片占位和简洁控件，高保真呈现完整组件层级和状态。不要切换业务规则。
- metadata 增加 `presentation: {format: "dual-fidelity", explanations: [{pageId, title, purpose, interactions: [操作与反馈], rules: [规则与依据], exceptions: [异常与恢复]}]}`。每个 pages 页面恰有一份解释；purpose 和 interactions 不可空，规则/异常无已知内容时明确待确认，不编造结论。
- 宿主在原型旁渲染解释、流程、范围和待确认问题；它们是评审说明，不属于产品界面。说明随版本及候选冻结，不读其他版本的解释。
- 已有双视图修改仍用 patches，并保留两份样式和 explanations；涉及说明变化时同步 embedded JSON 与 metadata。仅视觉修改不改变说明/业务。
- 历史单视图原型保持原样并明确标识，不能伪称已有两种视图；新任务缺少双视图或对应页面解释会被拒绝。

基于历史单视图创建的新原型任务同样必须补齐双视图和逐页解释。历史兼容只允许读取旧版本，不得关闭新任务的双视图校验；补齐通过新版本/候选完成，不回写旧版本。
