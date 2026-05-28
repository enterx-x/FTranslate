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

1. 点击 `新建 PDF 翻译` 或 `打开 PDF` 选择英文论文。
2. 在右侧 `整体 PDF 阅读` 面板里配置 PDF 翻译 API。
3. 点击 `生成双语 PDF`。
4. 生成完成后，左侧阅读器会自动切换到 `双语 PDF`。
5. 再次打开同一篇论文时，如果 PDF 文件大小和修改时间没有变化，会复用本机缓存的双语 PDF，避免重复扣 token。

也可以点击 `导入中文/双语 PDF`，把其它工具已经生成的中文或双语 PDF 绑定到当前论文记录中。

## PDFMathTranslate 引擎

应用优先查找系统里的 `pdf2zh` 或 `pdf2zh_next` 命令。找不到时，会在 Electron 用户数据目录创建私有 Python 虚拟环境，并自动安装 `pdf2zh`：

```text
%APPDATA%\PDF Translation Reader\sidecars\pdf2zh-venv\
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

双语 PDF 缓存位置：

```text
%APPDATA%\PDF Translation Reader\translations\<paperId>\
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
- 字体大小、加粗、斜体、字色、底色、居中、换行
- 复制格式和粘贴格式
- 右键菜单里的 `AI 填充选区`

每行可以绑定一篇论文，也可以解除绑定。AI 填表时会按绑定论文加载上下文；OpenAI 和 Kimi 会复用文件上传或提取缓存，避免每个单元格都重复上传完整 PDF。

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
