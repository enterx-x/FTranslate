# PDF Translation Reader

本项目是一个 Windows 桌面端学术 PDF 阅读和双语 PDF 生成工具。当前主流程是：打开英文 PDF，使用 PDFMathTranslate 生成整份双语 PDF，然后直接在左侧 PDF 阅读器里阅读生成后的双语 PDF。

## 技术栈

- Electron + React + TypeScript + Vite
- PDF.js 本地渲染 PDF
- PDFMathTranslate sidecar 生成整份双语 PDF
- KaTeX 用于笔记和表格里的公式显示
- Univer `0.24.0` 用于独立研究表格
- electron-builder 生成 Windows NSIS 安装包

## 运行

```bash
npm install
npm run dev
```

完整构建：

```bash
npm run build
```

生成 Windows 安装包：

```bash
npm run dist
```

打包产物在 `dist/` 目录。安装 `dist/PDF Translation Reader Setup 0.1.0.exe` 后，会自动创建桌面快捷方式和开始菜单快捷方式，双击 `PDF Translation Reader` 即可打开。

## 主流程：整份双语 PDF

1. 点击顶部 `+` 图标（新建 PDF 翻译）或 `PDF` 图标选择英文论文；新建项目只需要选择 PDF，不强制导入 JSON/Markdown。
2. 在右侧 `整体 PDF 阅读` 面板里配置 PDF 翻译 API。
3. 点击 `生成双语 PDF`。
4. 生成完成后，左侧阅读器会自动切换到 `双语 PDF`。
5. 再次打开同一篇论文时，如果 PDF 文件大小和修改时间没有变化，会复用本机缓存的双语 PDF，避免重复扣 token。

如果上一次生成失败或想绕过旧缓存，点击 `重新生成` 会强制让 PDFMathTranslate 忽略已有缓存重新跑。生成完成后可以点击 `导出双语 PDF`，把当前绑定的双语 PDF 另存到任意位置。也可以点击 `导入中文/双语 PDF`，把其它工具已经生成的中文或双语 PDF 绑定到当前论文记录中。

## PDFMathTranslate 引擎

应用优先查找系统里的 `pdf2zh` 或 `pdf2zh_next` 命令。找不到时，会在 Electron 用户数据目录创建私有 Python 虚拟环境，并自动安装 `pdf2zh`：

```text
%APPDATA%\pdf-translation-reader\sidecars\pdf2zh-venv\
```

自动安装需要本机有 Python 3.10 或 3.12。Windows 上优先使用：

```bash
py -3.12
py -3.10
```

如果自动检查失败，可以手动安装：

```bash
uv tool install pdf2zh
```

或：

```bash
py -3.12 -m pip install pdf2zh
```

API Key 只保存在本机 Electron 配置中，并且只通过子进程环境变量传给 PDFMathTranslate，不写入命令行参数或日志。

Kimi `kimi-k2.5` 这类模型只接受 `temperature=1`。应用使用私有 `pdf2zh` 运行时时会自动补丁其 OpenAI-compatible 翻译器，并通过环境变量传入 Kimi 需要的温度参数；OpenAI、DeepSeek 和 Custom provider 仍使用默认 `temperature=0`。

针对 Kimi K2 系列，应用还会禁用 `thinking`、把 PDFMathTranslate 调用限制为单线程，并设置 API 超时和重试次数，避免任务长时间停在 `0%` 或因为模型参数不兼容直接失败。长 PDF 翻译仍然可能耗时较久，任务运行期间状态栏会定期输出心跳进度和最后一条日志。

双语 PDF 缓存位置：

```text
%APPDATA%\pdf-translation-reader\translations\<paperId>\
```

## 论文库

主页现在先显示两个同级模块：`论文库` 和 `研究表格`。论文库只保留主要论文信息：

- 中文标题
- 英文标题
- 期刊
- 作者
- 年份
- 文件状态
- 最近打开
- 上次页码

论文库不再承载创新点、局限点、方法等研究整理字段；这些内容放到独立研究表格里。

## 独立研究表格

研究表格是一个独立模块，使用 Univer 提供接近 Excel 的表格体验：

- 首行冻结
- 增删行列
- 调整列宽
- 单元格编辑
- 公式输入
- 字体大小、加粗/取消加粗、斜体/取消斜体、字色、底色、居中、换行
- 复制格式和粘贴格式；格式按钮尽量图标化，鼠标悬停可看到功能说明
- 右键菜单里的 `AI 填充选区`
- 行高和自定义列会随本地工作簿一起保存
- 加粗和斜体是同一个 toggle 按钮，不再用单独的 `取消 B` / `取消 I` 按钮占空间
- 支持导入外部 `.xlsx`，导入时会追加为新工作表，不覆盖当前工作簿
- 支持导出当前 App 内同格式 `.xlsx`，尽量保留多工作表、冻结窗格、公式、自动换行、常见样式、列宽和行高

每行可以绑定一篇论文，也可以解除绑定。AI 填表时会按绑定论文加载上下文；OpenAI 和 Kimi 会复用文件上传或提取缓存，避免每个单元格都重复上传完整 PDF。

研究表格还提供 `AI 大观分析`：选择若干已绑定论文的行后，AI 会读取这些行的表格信息、论文元信息、已有笔记、AI 缓存和可用 PDF 上下文，批量提炼该领域反复出现但仍未解决的核心缺口，并且只提出 1 个 idea。提示词会明确要求给出科学问题、可验证技术路线、实验方案、评价指标和失败诊断，同时拒绝模块堆砌、改名蹭热点和空泛口号。

## 阅读笔记

阅读器右侧保留轻量笔记功能，笔记会跟随当前论文记录保存在本机。笔记面板支持常用模板快速插入：

- 核心结论
- 疑问
- 复现计划
- 研究 idea

笔记内容可以一键复制，后续可以直接粘贴到研究表格或作为 AI 大观分析的补充上下文。

## 兼容的旧翻译文件

JSON / Markdown / TXT 段落翻译逻辑仍保留在代码中，用于兼容旧数据和生成 AI 缓存，但不再作为主阅读界面。主界面优先使用整份双语 PDF。

JSON 示例：

```json
[
  {
    "section": "Abstract",
    "original": "We present a new robotic foundation model...",
    "translation": "我们提出一种新的机器人基础模型..."
  }
]
```

Markdown / TXT 会按空行切分段落。

## 视觉检查

先执行：

```bash
npm run dist
```

再执行：

```bash
npm run visual:check
```

脚本会启动 `dist/win-unpacked/PDF Translation Reader.exe`，用真实论文或 fallback PDF 做桌面端截图检查。可以用环境变量指定论文：

```bash
set VISUAL_CHECK_PDF=D:\path\to\paper.pdf
npm run visual:check
```

截图输出到 `.tmp-visual-check/`，不会提交到 git。

## 项目结构

```text
src/
  main/
    main.ts              Electron 主进程、文件读写、AI IPC、PDFMathTranslate sidecar
    preload.ts           暴露给 React 的安全 IPC API
  renderer/
    App.tsx              home / reader / researchSheet 顶层状态
    components/
      HomePage.tsx       主页和轻量论文库
      ResearchSheetPage.tsx 独立 Univer 研究表格
      PdfViewer.tsx      PDF.js 阅读器
      NotesPanel.tsx     阅读笔记
    lib/
      papers.ts          论文库记录
      researchWorkbook.ts 研究表格本地模型和 Univer snapshot 转换
      sheetCellAi.ts     单元格级 AI prompt
      translation.ts     旧 JSON/Markdown/TXT 兼容解析
  shared/
    aiTranslation.ts     OpenAI-compatible chat completions 请求
    aiPaperContext.ts    PDF 上下文 provider 策略
    pdfTranslation.ts    PDFMathTranslate 命令构造、输出路径和缓存 hash
scripts/
  visual-check.mjs       打包后视觉验收脚本
assets/
  icon.ico               Windows 安装包和快捷方式图标
```
