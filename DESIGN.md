# FTranslate DESIGN.md

本文件定义 FTranslate 未来 UI 的设计语言。它面向 AI coding agent 和后续人工开发，不以当前界面为最终参考。

## 1. 产品气质

FTranslate 不是普通 PDF 翻译器，也不是营销型 AI 聊天入口。它的目标是本地化 AI 科创研发工作台，帮助高校实验室、AI 创业团队和科创企业把论文、代码、实验、模型运行状态和研发知识沉淀成可追踪、可验证、可复用的研发闭环。

界面应当像专业研发控制台，而不是展示页。优先级是：

1. 信息密度和可扫描性；
2. 证据来源和状态可追踪；
3. 长时间阅读、整理、复现和调试的舒适度；
4. 可解释的工作流闭环；
5. 克制、稳定、工程化的视觉表达。

## 2. 参考系统

从 `awesome-design-md` 中采用组合参考，而不是照搬单一品牌：

- IBM / Carbon：主设计底座。用于工作台、表格、表单、设置、Runtime 状态、实验矩阵。
- Mintlify：文档和证据阅读结构。用于 Paper-to-Method、Paper-to-Code、方法卡、证据链页面。
- Supabase：产品工作台面板表达。用于项目空间、任务队列、日志、模型状态和数据面板。
- Cursor：AI 研发流程表达。用于 Agent 执行 timeline、代码复现映射、调试进度。
- Linear：只借鉴 App Shell 的克制质感、状态 badge、细边框和有限 accent，不采用全暗色主界面。

不建议作为主参考：

- ClickHouse、VoltAgent、Sentry：品牌色太强，不适合作为科研桌面工作台底座。
- OpenCode、Ollama：README / 终端感过强，不适合复杂中文科研阅读和实验矩阵。
- Replicate、Vercel：可局部借鉴，但整体更偏营销页或开发者平台宣传。

## 3. 视觉原则

### 3.1 主界面

- 主工作区使用浅色、高对比、低噪声画布。
- 左侧导航可以保留深色 App Shell，但不能让整套产品变成黑色科技风。
- 大部分页面应由表格、列表、详情面板、证据卡、状态条和操作栏构成。
- 页面首屏要直接进入工作流，不做营销式 hero。
- UI 文字要服务操作，不写解释性宣传文案。

### 3.2 信息层级

每个页面必须明确四层信息：

1. 当前对象：项目、论文、代码仓库、实验、模型或任务；
2. 当前状态：未开始、处理中、已完成、失败、需要人工确认；
3. 证据来源：PDF 页码、段落、公式、图表 caption、代码文件、日志片段；
4. 下一步动作：继续阅读、映射代码、生成方法卡、设计实验、运行检测、导出。

不要只展示“功能入口”。入口必须连接到研发对象和下一步动作。

## 4. 颜色系统

颜色应少而稳定，避免大面积渐变和多彩装饰。

### 4.1 推荐 token

```css
:root {
  --ft-canvas: #f7f8fa;
  --ft-surface: #ffffff;
  --ft-surface-muted: #f2f4f7;
  --ft-surface-raised: #ffffff;
  --ft-sidebar: #0b0f17;
  --ft-sidebar-raised: #111827;
  --ft-ink: #161616;
  --ft-ink-muted: #525866;
  --ft-ink-subtle: #7a8494;
  --ft-border: #d9dee7;
  --ft-border-soft: #e7ebf1;
  --ft-primary: #0f62fe;
  --ft-primary-hover: #0050e6;
  --ft-primary-soft: #e8f0ff;
  --ft-success: #24a148;
  --ft-warning: #f1c21b;
  --ft-danger: #da1e28;
  --ft-info: #0f62fe;
}
```

### 4.2 使用规则

- 蓝色只用于主操作、链接、焦点、选中态和信息状态。
- 绿色只用于成功、可用、已完成。
- 黄色只用于警告、等待人工确认、风险提示。
- 红色只用于错误、失败、危险操作。
- 紫色、橙色、青色等可以出现在图表或标签中，但不能成为主界面品牌色。
- 不使用大面积紫蓝渐变、霓虹、光球、玻璃拟态背景。

## 5. 字体和排版

FTranslate 主要面向中文科研使用，排版必须优先照顾中文可读性。

推荐字体：

```css
font-family:
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "Segoe UI",
  "PingFang SC",
  "Noto Sans CJK SC",
  system-ui,
  sans-serif;
```

代码、路径、命令、模型 ID、论文 ID 使用等宽字体：

```css
font-family:
  "JetBrains Mono",
  "Cascadia Mono",
  "SFMono-Regular",
  Consolas,
  monospace;
```

排版规则：

- 正文默认 14px 或 15px，行高 1.45-1.6。
- 表格、列表、详情面板可以使用 12px-13px 元信息。
- 页面标题控制在 24px-32px，不使用巨型营销标题。
- 工作台卡片标题控制在 16px-20px。
- 不使用 viewport width 动态缩放字体。
- 中文按钮文字不要过长，必要时换成图标 + tooltip。

## 6. 布局模式

### 6.1 App Shell

默认结构：

```text
┌──────────────┬────────────────────────────────────────────┐
│ Left Nav     │ Top context bar / page actions             │
│              ├──────────────────────┬─────────────────────┤
│              │ Main work area        │ Detail / evidence   │
│              │ list/table/canvas     │ panel               │
│              ├──────────────────────┴─────────────────────┤
│              │ Status queue / runtime message              │
└──────────────┴────────────────────────────────────────────┘
```

左侧导航只负责模块切换，不承载复杂说明。右侧详情面板用于当前选中对象的证据、状态、操作和日志。

### 6.2 典型页面

项目空间首页：

- 左：项目概览、最近论文、运行中任务；
- 中：研发流程看板，按 Paper-to-Method、Paper-to-Code、Experiment Matrix、Runtime Center 展示少量可执行对象卡；
- 右：Current Focus / Next Actions / Decision Queue Inspector，用于当前焦点、下一步和风险缺口。

Paper-to-Method：

- 左：论文章节 / 图表 / 公式目录；
- 中：方法卡结构化字段；
- 右：证据来源和原文片段。

Paper-to-Code：

- 左：代码仓库文件树和关键入口；
- 中：论文模块到代码文件的映射表；
- 右：依赖、运行命令、错误日志和风险。

实验矩阵：

- 主体：高密度表格；
- 顶部：实验组、seed、metric、状态筛选；
- 右侧：选中实验的配置、日志、结果和失败诊断。

Runtime Center：

- 主体：本地模型、sidecar、任务队列、缓存和 GPU/CPU 状态；
- 右侧：故障详情、修复命令、路径检测结果。

AI Autopilot：

- 主体：Agent timeline；
- 右侧：每一步输入、输出、证据和写入位置；
- 底部：人工确认队列。

## 7. 组件规则

### 7.1 按钮

- 主按钮：蓝底白字，小圆角 4px-6px，高度 32px-40px。
- 次按钮：白底或浅灰底，1px 边框，黑色文字。
- 危险按钮：红色只用于删除、覆盖、清理、重置等危险操作。
- 工具按钮优先用图标，配 tooltip。
- 不使用大面积 pill CTA。状态 badge 可以使用 pill。

### 7.2 卡片和面板

- 卡片只用于重复对象、详情面板、状态面板和 modal。
- 页面区域不要套卡片再套卡片。
- 工作台首页、项目空间和 Runtime Center 优先使用“少量顶层 pane + 内部行态/表格/时间线”，不要把每个指标、每个行动项、每个风险都做成独立卡片。
- 工作台首页允许使用研发流程看板对象卡，但卡片必须对应真实研发对象或流程阶段，具备状态和动作；不能把指标、行动项和风险缺口都拆成装饰性卡片。
- 反对卡片堆叠不等于把界面压平成粗糙表格；顶层 pane 可以保留克制圆角、边框、浅阴影和留白，内部对象再用分隔线、状态 badge、行 hover 和小型操作按钮组织。
- 默认边框 1px，轻阴影可选但必须克制。
- 推荐圆角 6px-8px；大型面板最多 12px。
- 卡片内必须有清晰对象、状态和可执行动作。

### 7.3 表格和列表

- 表头使用浅灰背景或底部分割线。
- 行 hover 只做轻微背景变化。
- 每行尽量展示状态、来源、最近动作和下一步入口。
- 支持密度切换时，必须保证文字不截断关键字段。

### 7.4 标签和状态

状态标签必须语义稳定：

- `Draft` / `Ready` / `Running` / `Blocked` / `Failed` / `Verified`
- `Evidence missing` / `Needs review` / `Local only` / `Cached`

标签不能只用于装饰。每个标签都应该帮助用户判断风险或下一步。

### 7.5 证据卡

证据卡必须显示：

- 来源类型：PDF、Figure、Table、Equation、Code、Log、Experiment；
- 来源定位：页码、文件路径、函数名、行号或日志时间；
- 摘要；
- 操作：打开来源、复制引用、加入方法卡、加入实验矩阵。

## 8. AI 和可追踪性

任何 AI 生成内容都不能只是聊天气泡。界面必须显示：

- 生成对象；
- 输入来源；
- 证据覆盖率；
- 未确认字段；
- 写入位置；
- 回滚或编辑入口。

Agent 执行过程应展示为 timeline：

```text
Reading paper -> Extracting method -> Mapping code -> Designing experiment -> Checking runtime -> Awaiting review
```

每个阶段都要有状态、耗时、证据和失败原因。

## 9. 响应式和桌面约束

FTranslate 是 Windows Electron 桌面应用，优先桌面体验。

- 默认设计宽度以 1366px、1440px、1920px 为主。
- 1280px 以下允许折叠右侧详情面板。
- 不以移动端为主，但窗口缩小时不能横向溢出。
- 表格、PDF、知识图谱这类核心区域必须使用稳定尺寸约束。
- 视觉回归必须覆盖首页、项目空间、表格、PDF 阅读、AI 问答、Runtime Center 和设置页。

## 10. 禁止项

- 不以当前 UI 为最终视觉参考。
- 不做营销型 landing page。
- 不做全局暗色科技风。
- 不用大面积渐变、光球、玻璃拟态、霓虹边框。
- 不用巨型 hero 文案替代真实工作流。
- 不把 AI 输出停留在聊天记录里。
- 不用装饰性卡片堆叠掩盖缺少数据闭环。
- 不把“减少卡片”误解为廉价线框表格；视觉密度、层级、留白和操作焦点必须同时成立。
- 不隐藏失败、跳过错误或用成功文案掩盖未验证状态。

## 11. 分阶段落地

第一阶段：设计系统基线

- 建立 `DESIGN.md`。
- 梳理全局颜色、间距、按钮、卡片、表格、状态标签。
- 保持现有功能可用，不大规模重构。

第二阶段：项目空间和导航

- 将首页改为 AI 科创项目空间。
- 左侧导航围绕项目、论文、代码、实验、Runtime、证据图谱组织。
- 当前旧入口以兼容方式保留。

第三阶段：核心研发对象

- Paper-to-Method 方法卡；
- Paper-to-Code 复现映射；
- 实验矩阵；
- Runtime Center；
- Evidence Graph。

第四阶段：Research Autopilot

- 多 Agent timeline；
- 人工确认队列；
- 输出写回项目空间和证据链。

## 12. 验证方式

每次 UI 改动后至少执行：

```bash
npm run typecheck
npm run visual:check
```

视觉检查后必须人工查看 `.tmp-visual-check/` 中相关截图，按对抗式审查确认：没有重叠、遮挡、截断、横向/纵向溢出、裸露内部滚动条、流程对象卡压缩、风险行裁切、紫色品牌色回潮、过度卡片化或过度线框化。

如果只修改文档，可以不运行代码测试，但必须执行：

```bash
git diff -- README.md PLAN.md DESIGN.md
```

并在 `PLAN.md` 记录设计决策和验证结果。
