# PDF Translation Reader

本项目是一个本地 Windows 桌面端论文阅读工具，用于论文 PDF 阅读、整本双语 PDF 翻译、AI 翻译缓存、阅读笔记、论文库和独立研究表格。

技术栈：

- Electron + React + TypeScript + Vite
- PDF.js，本地渲染 PDF，不依赖在线 PDF 服务
- PDFMathTranslate sidecar，用于生成保留论文排版的整本双语 PDF
- KaTeX，用于右侧译文、笔记和表格内公式显示
- Univer `0.24.0`，用于独立研究表格模块
- electron-builder，生成 Windows NSIS 安装包

## 运行

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

完整构建检查：

```bash
npm run build
```

生成 Windows 安装包：

```bash
npm run dist
```

打包产物在 `dist/` 目录。安装 `dist/PDF Translation Reader Setup 0.1.0.exe` 后，会自动创建桌面快捷方式和开始菜单快捷方式，双击 `PDF Translation Reader` 即可打开。

## 桌面打包配置

`package.json` 已配置：

- `appId`: `com.local.pdf.translation.reader`
- `productName`: `PDF Translation Reader`
- `win.target`: `nsis`
- `nsis.createDesktopShortcut`: `true`
- `nsis.createStartMenuShortcut`: `true`
- `nsis.shortcutName`: `PDF Translation Reader`
- 图标：`assets/icon.ico`

图标资源使用透明边缘版本。前端品牌图标为 `src/renderer/assets/brand-mark.png`，安装包/桌面快捷方式图标为 `assets/icon.ico`。

## 主要功能

- 主页工作台：启动后先显示“研究表格”和“论文库”两个同级模块，后续可以继续扩展新的研究工具入口。
- 论文库：只保留论文主要信息，包括中文标题、英文标题、期刊、作者、年份、最近打开时间、上次页码、PDF/翻译/AI 缓存状态；默认是只读展示，点击“编辑信息”后才进入输入框编辑。
- 阅读器：左侧连续滚动 PDF，支持页码跳转、上一页/下一页、按钮缩放、`Ctrl + 鼠标滚轮` 缩放、文本选择复制。
- 整体双语 PDF：右侧提供“原文 PDF / 双语 PDF”切换，可以调用 PDFMathTranslate 生成整本双语 PDF，也可以导入已有中文/双语 PDF；生成或导入后左侧直接显示整本 PDF，不再依赖右侧段落卡片作为主阅读面。
- 手动模式：导入 JSON/Markdown/TXT 翻译文件，逐段显示原文和译文，并提供外部 AI JSON 提示词复制。
- AI 模式：支持 OpenAI、DeepSeek、Kimi 和 Custom OpenAI-compatible API；翻译后逐段保存 JSON 缓存，避免重复消耗 token。
- 阅读笔记：按论文自动保存到本机论文库记录。
- 独立研究表格：从论文库入口打开，使用 Univer 提供接近 Excel 的表格体验。

## 独立研究表格

研究表格是独立模块，不再塞进论文库。默认工作表为“论文研究表”，第一行冻结，默认列包括：

- 论文
- 中文标题
- 英文标题
- 创新点
- 局限点
- 方法
- 数据/任务
- 指标/结果
- 复现计划
- 后续 idea
- 备注

Univer 内置支持基础表格能力，包括增删行列、拖拽列宽、复制粘贴、编辑单元格、输入公式和单元格格式。应用额外提供一条轻量格式工具栏，可对当前选区设置字号、加粗、斜体、字色、底色、水平/垂直居中、自动换行，并支持“复制格式 / 粘贴格式”作为简化版格式刷。工作簿保存到本机 `localStorage`：

- `pdfTranslationReader:researchWorkbook`
- `pdfTranslationReader:researchSheetLinks`

每行可以绑定一篇论文，也可以解除当前行绑定；绑定和解除绑定合并为同一个按钮，解除绑定只移除论文关联，不会删除表格文字。从论文库点击“表格定位”会自动创建或定位到该论文对应行。

右键菜单不再使用应用自绘浮层，而是接入 Univer 原生表格右键菜单。右键后可以直接选择：

- `AI 填充选区`
- `绑定/解除当前行论文`
- `复制格式`
- `粘贴格式到选区`

## 单元格级 AI 填写

研究表格中选中任意正文单元格后，可以点击“AI 填此单元格”。也可以像普通表格一样框选多个单元格，点击按钮或右键选择“AI 填充选区”。AI 只填写当前选区，不会一键填全表。

AI 上下文包括：

- 当前列名和单元格地址
- 当前单元格已有内容
- 同一行其它单元格内容
- 绑定论文的元信息
- 论文 PDF、翻译文件、AI 缓存和阅读笔记

Provider 策略：

- OpenAI：首次对某篇论文填表时上传 PDF 并缓存 `file_id`，后续使用 Responses API 的 PDF `input_file` 引用该文件，避免每个单元格重复传完整 PDF。
- Kimi：使用 Files API 上传 PDF，`purpose=file-extract`，提取后的文本会本地缓存，后续填表复用提取结果。
- DeepSeek/Custom：使用本地 PDF.js 文本提取作为上下文兜底，因为 DeepSeek 官方 chat completions 没有等价 PDF 上传接口。

PDF 上下文会按 provider、PDF 路径、文件大小和修改时间做本地缓存。多选单元格填充会按绑定论文分组，一篇论文的一组选区只构造一次上下文请求，减少重复消耗。

## 整本双语 PDF 翻译

整本双语 PDF 翻译采用开源 PDFMathTranslate 作为 sidecar。应用不会把 Python 运行时塞进安装包，第一版会在本机检测 `pdf2zh` 命令：

```bash
uv tool install pdf2zh
```

使用方式：

1. 在阅读器中打开 PDF，或从论文库打开已有论文。
2. 在右侧“整体 PDF 阅读”区域点击“生成双语 PDF”。
3. 应用会复用当前 AI 设置里的 Provider、Base URL、Model 和 API Key，把 API Key 只传给主进程子进程环境变量，不写入命令参数和日志。
4. 生成完成后，左侧 PDF 阅读器自动切换到“双语 PDF”。
5. 再次打开同一篇论文时，如果 PDF 文件大小和修改时间未变化，会复用本机缓存的双语 PDF，避免重复翻译。

缓存位置在 Electron 用户数据目录：

```text
%APPDATA%\PDF Translation Reader\translations\<paperId>\
```

如果你已经用其它工具生成了中文或双语 PDF，可以点击“导入中文/双语 PDF”，导入后同样会作为整本 PDF 在左侧显示，并绑定到当前论文记录。

## 翻译文件格式

JSON 格式必须是数组，每项包含 `section`、`original`、`translation`：

```json
[
  {
    "section": "Abstract",
    "original": "We present a new robotic foundation model, called π0.7...",
    "translation": "我们提出一种新的机器人基础模型，称为 π0.7..."
  }
]
```

Markdown/TXT 格式按空行切分段落。文件开头可以写元信息：

```markdown
中文标题：机器人基础模型 π0.7
英文标题：A Robotic Foundation Model
期刊：arXiv
作者：Author A, Author B
年份：2026

摘要

这里开始是中文译文正文。
```

## 视觉检查

先执行 `npm run dist`，再执行：

```bash
npm run visual:check
```

脚本会启动 `dist/win-unpacked/PDF Translation Reader.exe`，使用真实 PDF 做桌面端截图检查。默认 PDF 路径：

```text
D:\GPT浏览器下载\2604.15483v2.pdf
```

可以用环境变量覆盖：

```bash
set VISUAL_CHECK_PDF=D:\path\to\paper.pdf
npm run visual:check
```

截图输出到 `.tmp-visual-check/`，不会提交到 git。当前检查重点：

- 顶栏和主页图标没有黑圈/胶囊背景，PNG 四角透明。
- 主页默认是模块工作台，进入“论文库”后才显示论文表。
- 论文库只显示主要论文信息，不再混入研究表格列，且默认不出现输入框。
- 研究表格作为独立页面打开，能看到 Univer 表格 surface、合并后的绑定/解除按钮、格式工具栏，以及原生右键菜单中的 AI 填表和格式刷命令。
- 已绑定双语 PDF 的论文打开后默认显示“双语 PDF”，右侧能看到“整体 PDF 阅读”控制区。
- AI 模式队列空白区域点击后不会白屏，仍保持左右分栏和 AI 面板可见。

## 项目结构

```text
src/
  main/
    main.ts              Electron 主进程、文件读写、AI IPC、PDF 上下文缓存
    preload.ts           暴露给 React 的安全 IPC API
  renderer/
    App.tsx              顶层状态、home/reader/researchSheet 三视图切换
    components/
      HomePage.tsx       轻量论文库
      ResearchSheetPage.tsx 独立 Univer 研究表格
      PdfViewer.tsx      PDF.js 阅读器
      AiModePanel.tsx    AI 翻译模式
      TranslationPanel.tsx 手动翻译阅读器
    lib/
      papers.ts          论文库记录
      researchWorkbook.ts 研究表格本地模型与 Univer snapshot 转换
      sheetCellAi.ts     单元格级 AI prompt
      translation.ts     JSON/Markdown/TXT 翻译文件解析与导出
  shared/
    aiTranslation.ts     OpenAI-compatible chat completions 请求
    aiPaperContext.ts    PDF 上下文 provider 策略
    pdfTranslation.ts    PDFMathTranslate 命令构造、输出路径和缓存 hash
scripts/
  visual-check.mjs       打包后视觉验收脚本
assets/
  icon.ico               Windows 安装包和快捷方式图标
```
