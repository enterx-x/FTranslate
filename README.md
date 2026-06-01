# PDF Translation Reader / FTranslate

FTranslate 是一个 Windows 桌面端科研论文工作台，面向论文阅读、PDF 翻译、研究表格整理、AI 大观分析、知识图谱、阅读笔记和组会 PPT 草稿生成。

当前主流程是：

1. 导入英文论文 PDF；
2. 使用本地 PDF.js 阅读；
3. 可用 PDFMathTranslate / pdf2zh 生成双语 PDF；
4. 在论文库、研究表格、AI 助手、知识图谱和阅读笔记中整理研究信息；
5. 可基于当前 PDF 提取文本，生成“研究生组会极简风格”PPT 大纲草稿，并导出 Markdown / JSON。

## 技术栈

- Electron + React + TypeScript + Vite
- PDF.js 本地渲染 PDF
- PDFMathTranslate / pdf2zh 作为双语 PDF sidecar
- Univer 作为独立研究表格
- KaTeX + Markdown 渲染公式与研究笔记
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

首页采用左侧深色 App Shell + 右侧浅色工作区。主要入口包括：

- 研究表格
- 知识图谱
- 组会 PPT 生成
- 论文库
- PDF 阅读
- AI 助手
- 设置

### PDF 阅读与双语 PDF

- 打开本地 PDF；
- 连续滚动阅读；
- 缩放、翻页、页码跳转；
- 原文 PDF / 左右双语 / 双语 PDF 文件切换；
- 导入已有中文或双语 PDF；
- 导出已绑定双语 PDF；
- 基于当前 PDF 生成组会 PPT 草稿。

PDFMathTranslate sidecar 会优先查找系统中的 `pdf2zh` / `pdf2zh_next`。如果找不到，会尝试在 Electron 用户数据目录中创建私有 Python 翻译环境。

生成双语 PDF 时，应用会为 pdf2zh 写入一个本地学术翻译 prompt，用来约束模型保留公式占位符、引用编号、Fig./Table 编号、DOI、URL 和 References / Bibliography 条目结构。Windows 子进程会强制使用 UTF-8 环境，减少进度条和接口错误在界面中显示乱码。

默认双语 PDF 缓存位置：

```text
%APPDATA%\pdf-translation-reader\translations\<paperId>\
```

### AI 助手

AI 助手集中管理：

- 大观分析；
- 联网查新；
- 提示词模板；
- API 设置；
- API 高级参数；
- AI 分析历史；
- 组会 PPT 生成提示词模板。

分析结果使用 Markdown + KaTeX 渲染，避免直接显示原始 `##`、`-`、`$...$`。

### 研究表格

研究表格基于 Univer，作为独立模块存在，不和论文库混在一起。支持：

- 多工作表；
- 首行冻结；
- 单元格编辑；
- 复制 / 粘贴；
- 字号、加粗、斜体、颜色、对齐、自动换行等格式工具；
- 导入 / 导出 Excel；
- 行绑定论文；
- 选区级 AI 填写；
- 跳转 AI 助手进行大观分析；
- 进入知识图谱；
- 进入组会 PPT 生成流程。

公式帮助隐藏在工具栏入口中。写法：

```text
行内公式：$E=mc^2$
块级公式：$$L = L_data + lambda L_physics$$
```

编辑时显示源码，预览、笔记和 AI 结果中渲染公式。

### 知识图谱

知识图谱会从研究表格和论文库中生成论文、方法、关键词、作者、年份、期刊/会议、场景、指标等关系。

当前支持：

- 数据来源切换：研究表格、论文库、二者合并；
- 图谱类型切换；
- 节点类型筛选；
- 搜索节点；
- 最大节点数控制；
- 鼠标滚轮缩放；
- 拖拽平移；
- hover 高亮一阶邻居；
- 点击节点查看详情；
- 右键节点菜单；
- 导出 SVG 图片；
- 导出 JSON。

### 论文库

论文库只保留论文主要信息：

- 中文标题；
- 英文标题；
- 期刊；
- 作者；
- 年份；
- 文件状态；
- 最近打开时间；
- 上次页码；
- 操作入口。

复杂的创新点、局限点、方法、实验计划等内容放到研究表格中整理。

### 阅读笔记

PDF 阅读页包含轻量笔记编辑器：

- 核心结论；
- 疑问；
- 复现计划；
- 研究 idea；
- 公式推导；
- 局限性；
- 可借鉴点。

笔记支持编辑 / 预览 / 分屏模式。预览使用 Markdown + KaTeX 渲染，复制时优先复制原始 Markdown。

### 组会 PPT 生成器

当前实现的是第一阶段稳定版本，重点是“先生成可检查的结构化草稿”，不直接跳到复杂 PPTX 导出。

已支持：

- 从当前 PDF 的文本块生成组会 PPT 草稿；如果缓存中的文本块尚未就绪，会主动用 PDF.js 从当前 PDF 重新抽取正文、章节和 Fig. / Figure / Table caption；
- 抽取 Abstract、Introduction、Method、Experiments、Conclusion 等章节信息；
- 默认生成 12 页组会结构：封面、论文信息、背景、Related Work、方法、公式、实验、结果、创新、局限、启发和总结；
- 识别 Fig. / Figure / Table caption 作为图表候选；
- 跳过 References / Bibliography 作为默认策略；
- 生成结构化 PPT 大纲 JSON；
- 提供 HTML 幻灯片预览；
- 编辑当前页标题、bullet 和 speaker notes；
- 导出 Markdown 大纲；
- 导出 JSON 大纲；
- 在 AI 助手中提供“组会 PPT 生成”提示词模板。

尚未完成：

- 精准图表裁剪；
- 真实 `.pptx` 导出；
- AI 自动重写完整 PPT 大纲；
- 多篇论文综述式 PPT 自动合并。

后续建议在该草稿流程稳定后，再接入 `pptxgenjs` 或 HTML-to-PPT 导出链路。

### 设置

设置页包含：

- 通用设置；
- PDF 阅读设置；
- AI 设置；
- 联网查新设置；
- 研究表格设置；
- 笔记设置；
- 知识图谱设置；
- 组会 PPT 设置；
- 导出与路径；
- 数据与缓存。

导出与路径中预留：

- 默认导出路径；
- PDF 导出路径；
- 双语 PDF 导出路径；
- 翻译 JSON 导出路径；
- 知识图谱图片导出路径；
- 知识图谱 JSON 导出路径；
- 笔记导出路径；
- 研究表格导出路径；
- PPT 导出路径；
- PPT 图片素材缓存路径。

当前部分系统目录选择按钮是 UI 预留，后续可接入 Electron 目录选择 IPC。

## API 与模型

应用使用 OpenAI-compatible 接口，支持 OpenAI、DeepSeek、Kimi 和 Custom provider。API Key 保存于本机 Electron 配置中，不写入日志、不提交到 git。

Kimi K2.5 非思考模式建议使用：

```text
temperature = 0.6
top_p = 0.95
thinking = disabled
```

OpenAI provider 会显示 OpenAI 推理强度选项；其他 provider 不显示该项。

## 参考文献翻译策略

默认策略是“参考文献保持原文”，避免 References / Bibliography 部分的编号、换行、DOI、作者和期刊格式被破坏。

可选策略：

- 保持参考文献原文；
- 翻译参考文献标题；
- 跳过参考文献翻译。

如果 PDFMathTranslate 输出质量不稳定，建议保持参考文献原文，或导入外部已校对的中文 / 双语 PDF。

## 视觉检查

构建后运行：

```bash
npm run visual:check
```

默认截图输出到：

```text
.tmp-visual-check/
```

当前视觉检查会覆盖首页、论文库、研究表格、PDF 阅读、组会 PPT、AI 助手和设置页；失败时会保留对应截图，便于继续定位布局或渲染问题。

可指定论文：

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
      PresentationPage.tsx  组会 PPT 草稿预览与导出
      NotesPanel.tsx        阅读笔记
      SettingsPage.tsx      设置页
      MarkdownDocument.tsx  Markdown + 公式渲染组件
    lib/
      appSettings.ts        本地设置解析与默认值
      knowledgeGraph.ts     知识图谱数据生成与导出
      presentationOutline.ts 组会 PPT 大纲生成与 Markdown 导出
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
