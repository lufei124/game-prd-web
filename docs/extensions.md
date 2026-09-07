# 新增 Skill、模板与功能插件

Skill 规定如何工作，模板规定产物组织，功能插件提供实际工具。三者可独立配置，或通过 workbench-pack.json 组合导入；不建设公共市场。

## 新增一种风格

1. 创建目录及标准 SKILL.md，frontmatter 包含稳定 name 与中文 description，正文描述色彩、字体、间距和组件，不改变业务规则与阶段门禁。
2. 在扩展中心从目录、ZIP 或 GitHub 导入，扩展类型选择风格，阶段填写 prototype。references/assets/scripts 会保留，脚本不会执行。
3. 在需求的视觉风格中选择它；生成新候选版本，不覆盖已确认原型。内置示例见 defaults/mint 与 defaults/ink。

## 新增 PRD 模板

在扩展中心创建模板或导入 Markdown，适用阶段为 prd。可使用 `{{需求名称}}`，以标题、表格、字段说明、写作要求及示例定义结构。条件章节通过 Markdown 注释给出指引，例如 `<!-- condition: hasUI -->`；条件由助手依据确认内容处理，不是隐藏模板编程语言。

项目可设置默认模板，单次需求覆盖。更换模板只组织已有内容，不改写结论。完整性检查基于规则、验收与异常等内容，不要求固定章节名称。示例见 defaults/prd.md。

## 功能插件

在 server/plugins.ts 实现 DeliveryPlugin 接口并通过 PluginRegistry 注册，由 createApp 初始化注入。现有 Feishu 实现提供 status、fetch、create、update、attach 能力。新插件必须声明能力/权限，将秘密放在服务端凭证层，通过受控配置和用户确认调用；不能让 Skill 导入动态执行第三方代码。

发布适配须保留版本、目标、远端修订号和结果；区分失败和未知结果，测试重试幂等与冲突检测。tests/fixtures.ts 展示测试 Mock，生产入口不能使用它。

## 扩展版本

每次更新创建新 release，保留资源文件和 hash。任务固定实际版本，不随扩展更新变化。扩展可启停、项目绑定与回退。可配置优先级为任务 > 项目 > 系统，权限和确认规则不可覆盖。

目录导入需先授权；GitHub 支持公开仓库根目录、tree 子目录和 blob SKILL.md 链接。多 Skill 时指定子目录；缺依赖或未授权能力会明确提示，不自动安装依赖。既有历史来源记录不形成对其他仓库的依赖。
