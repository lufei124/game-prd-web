---
name: mint-product-style
description: 明亮底色、薄荷配色与简洁组件的通用产品原型视觉风格，仅控制视觉。
---
# 清透薄荷风格
仅负责视觉。使用奶白背景 #f6f8f5、墨绿文字 #163d32、薄荷绿主色 #397e68、柔和描边 #dae5de。系统无衬线字体，8px 间距基数，按钮圆角 10px，卡片圆角 16px，轻量阴影，充分留白。
用 CSS custom properties 定义 --surface、--ink、--accent、--space、--radius，明确 :focus-visible 与 disabled 状态。保持所有业务规则、页面、状态和交互与已确认需求一致。
仅视觉修改时只能提交 style 元素内的替换，不得改 DOM 文本、事件处理或 prototype-meta。视觉不授予任何业务工具权限。
