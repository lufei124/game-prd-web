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
