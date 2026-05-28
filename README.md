# PDF Translation Reader

本项目是一个本地 Windows 桌面端论文阅读工具，用于“PDF 原文 + 中文翻译”交互阅读，并提供 AI 翻译缓存、阅读笔记、论文库和独立研究表格。

技术栈：

- Electron + React + TypeScript + Vite
- PDF.js，本地渲染 PDF，不依赖在线 PDF 服务
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

- 论文库：只保留论文主要信息，包括中文标题、英文标题、期刊、作者、年份、最近打开时间、上次页码、PDF/翻译/AI 缓存状态；默认是只读展示，点击“编辑信息”后才进入输入框编辑。
- 阅读器：左侧连续滚动 PDF，支持页码跳转、上一页/下一页、按钮缩放、`Ctrl + 鼠标滚轮` 缩放、文本选择复制。
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

Univer 内置支持基础表格能力，包括增删行列、拖拽列宽、复制粘贴、编辑单元格、输入公式和单元格格式。应用额外提供一条轻量格式工具栏，可对当前选区设置字号、加粗、斜体、字色、底色、水平/垂直居中和自动换行。工作簿保存到本机 `localStorage`：

- `pdfTranslationReader:researchWorkbook`
- `pdfTranslationReader:researchSheetLinks`

每行可以绑定一篇论文，也可以解除当前行绑定；解除绑定只移除论文关联，不会删除表格文字。从论文库点击“表格定位”会自动创建或定位到该论文对应行。

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
- 论文库只显示主要论文信息，不再混入研究表格列，且默认不出现输入框。
- 研究表格作为独立页面打开，能看到 Univer 表格 surface、绑定/解除绑定控件、格式工具栏和右键“AI 填充选区”菜单。

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
scripts/
  visual-check.mjs       打包后视觉验收脚本
assets/
  icon.ico               Windows 安装包和快捷方式图标
```
