# PDF Translation Reader / FTranslate

FTranslate 是一个 Windows 桌面端论文阅读、PDF 翻译、研究表格和知识图谱工作台。当前主流程以“整份 PDF 阅读 + 双语 PDF 生成”为核心：导入英文论文 PDF，使用本地 PDF.js 阅读，调用 PDFMathTranslate 生成双语 PDF，并在应用内进行论文库管理、研究表格整理、AI 大观分析、笔记和知识图谱浏览。

## 技术栈

- Electron + React + TypeScript + Vite
- PDF.js 本地渲染 PDF
- PDFMathTranslate / pdf2zh 作为双语 PDF sidecar
- KaTeX 用于公式渲染
- Univer 用于独立研究表格
- electron-builder 生成 Windows NSIS 安装包

## 运行与打包

```bash
npm install
npm run dev
```
构建源码：

```bash
npm run build
```

生成 Windows 安装包：

```bash
npm run dist
```

安装包输出在 `dist/`，例如：

```text
dist/PDF Translation Reader Setup 0.1.0.exe
```

安装完成后会创建桌面快捷方式和开始菜单快捷方式。

## 主要模块

### 工作台首页

首页采用桌面软件式 App Shell：左侧深色侧边栏，右侧浅色工作区。首页显示论文数量、双语 PDF 数量、笔记数量、知识图谱节点数量、最近打开论文，以及“研究表格 / 知识图谱 / 论文库”三个主要入口。

### PDF 阅读与双语 PDF

- 支持打开本地 PDF。
- 支持原文 PDF、左右双语 PDF、双语 PDF 文件切换。
- 支持缩放、翻页、页码跳转和连续阅读。
- 支持导入已有中文/双语 PDF。
- 支持导出当前绑定的双语 PDF。
- 右侧包含整体 PDF 阅读、PDF 翻译 API、阅读笔记等折叠面板。

PDFMathTranslate sidecar 会优先查找系统中的 `pdf2zh` 或 `pdf2zh_next`。如果找不到，会尝试在 Electron 用户数据目录中创建私有 Python 环境。

默认双语 PDF 缓存位置：

```text
%APPDATA%\pdf-translation-reader\translations\<paperId>\
```

### AI 助手

AI 助手集中管理：

- 大观分析
- 联网查新
- 提示词模板
- API 设置
- API 高级参数
- AI 分析历史

分析结果使用 Markdown + 公式渲染，不再直接显示原始 `##`、`-`、`$...$`。分析结果支持复制和全屏查看。AI 助手左右栏支持拖拽调整宽度，并在窄窗口或高 DPI 缩放下自动退化为单列，避免面板互相挤压。

### 研究表格

研究表格基于 Univer，作为独立模块存在，不和论文库混在一起。支持：

- 多工作表
- 首行冻结
- 单元格编辑
- 复制/粘贴
- 字号、加粗、斜体、颜色、对齐、自动换行等格式工具
- 导入 / 导出 Excel
- 行绑定论文
- 选区级 AI 填写
- 跳转 AI 助手进行大观分析

公式帮助不常驻显示，点击“公式帮助”后查看：

```text
行内公式：$E=mc^2$
块级公式：$$L = L_data + lambda L_physics$$
```

编辑时保留源码，预览、笔记和 AI 结果中渲染公式。

### 知识图谱

知识图谱会从研究表格和论文库中生成论文、方法、关键词、作者、年份、期刊/会议、场景、指标等节点关系。

当前支持：

- 数据来源切换：研究表格、论文库、二者合并
- 图谱类型切换：全量、论文-方法、论文-关键词、论文-作者、年份演化
- 节点类型筛选
- 搜索节点
- 最大节点数控制
- 标签显示策略
- 鼠标滚轮缩放
- 拖拽平移
- hover 高亮一阶邻居
- 点击节点查看详情
- 右键节点查看菜单
- 导出 SVG 图片
- 导出 JSON

图谱布局采用 cluster 分区：论文、方法、关键词、场景、指标、年份等节点会分布在不同区域，画布只默认显示核心标签，右侧详情优先展示摘要和核心字段，其余表格行信息折叠。默认最大显示 80 个节点，节点较多时建议使用筛选器缩小范围。

### 论文库

论文库只保留论文主要信息：

- 中文标题
- 英文标题
- 期刊
- 作者
- 年份
- 文件状态
- 最近打开时间
- 上次页码
- 操作入口

复杂的创新点、局限点、方法、实验计划等内容放在研究表格中整理。

### 阅读笔记

PDF 阅读页保留轻量笔记编辑器：

- 核心结论
- 疑问
- 复现计划
- 研究 idea
- 公式推导
- 局限性
- 可借鉴点

笔记支持编辑 / 预览 / 分屏模式。预览使用 Markdown + KaTeX 渲染，复制时优先复制原始 Markdown。

### 设置

设置页提供分类导航：

- 通用设置
- PDF 阅读设置
- AI 设置
- 联网查新设置
- 研究表格设置
- 笔记设置
- 知识图谱设置
- 导出与路径
- 数据与缓存

导出与路径中预留：

- 默认导出路径
- PDF 导出路径
- 双语 PDF 导出路径
- 翻译 JSON 导出路径
- 知识图谱图片导出路径
- 知识图谱 JSON 导出路径
- 笔记导出路径
- 研究表格导出路径

当前部分系统目录选择按钮为 UI 预留，后续可接入 Electron 目录选择 IPC。

## API 与模型

应用使用 OpenAI-compatible 接口，支持 OpenAI、DeepSeek、Kimi 和 Custom provider。API Key 保存于本机 Electron 配置中，不写入日志、不提交到 git。

Kimi K2.5 非思考模式使用：

```text
temperature = 0.6
top_p = 0.95
thinking = disabled
```

只有明确的 thinking 模型才使用思考模式。OpenAI provider 会显示 OpenAI 推理强度选项，其它 provider 不显示该项。

## 参考文献翻译策略

默认策略是“参考文献保持原文”，避免 References / Bibliography 部分的编号、换行、DOI、作者和期刊格式被破坏。设置页中保留参考文献策略入口：

- 保持参考文献原文
- 翻译参考文献标题
- 跳过参考文献翻译

当前 PDFMathTranslate 的最终排版质量仍取决于上游引擎本身；如果参考文献格式不稳定，建议保持原文或导入外部已校对的中文/双语 PDF。

如果生成双语 PDF 时触发模型限制，应用会把常见错误转成可读提示，例如 `content_filter` 会提示内容安全拦截，`invalid temperature` 会提示检查当前模型允许的 temperature 值。

## 视觉检查

构建后运行：

```bash
npm run visual:check
```

脚本会启动打包后的应用并生成截图，默认输出到：

```text
.tmp-visual-check/
```

可以指定论文：

```bash
set VISUAL_CHECK_PDF=D:\path\to\paper.pdf
npm run visual:check
```

## 项目结构

```text
src/
  main/
    main.ts                 Electron 主进程、文件读写、AI IPC、PDF 翻译 sidecar
    preload.ts              暴露给 React 的安全 IPC API
  renderer/
    App.tsx                 顶层路由和应用状态
    components/
      HomePage.tsx          工作台首页和论文库
      PdfViewer.tsx         PDF.js 阅读器
      ResearchSheetPage.tsx 独立研究表格
      AiAssistantPage.tsx   AI 助手
      KnowledgeGraphPage.tsx 知识图谱
      NotesPanel.tsx        阅读笔记
      SettingsPage.tsx      设置页
      MarkdownDocument.tsx  Markdown + 公式渲染组件
    lib/
      appSettings.ts        本地设置解析与默认值
      knowledgeGraph.ts     知识图谱数据生成与导出
      markdownDocument.ts   安全文档渲染
      papers.ts             论文库记录
      researchWorkbook.ts   研究表格本地模型
      translation.ts        JSON/Markdown/TXT 兼容解析
  shared/
    aiTranslation.ts        OpenAI-compatible chat completions
    pdfTranslation.ts       PDFMathTranslate 命令、缓存和输出路径
scripts/
  visual-check.mjs          打包后视觉检查脚本
assets/
  icon.ico                  Windows 安装包与快捷方式图标
```
