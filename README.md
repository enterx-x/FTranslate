# PDF Translation Reader

一个本地离线的 Windows 桌面端“PDF 原文 + 中文翻译交互阅读器”。

技术栈：

- Electron
- React
- TypeScript
- Vite
- PDF.js
- electron-builder

应用支持两种工作流：手动模式保持本地阅读和外部 AI 提示词复制；AI 模式可选接入 OpenAI-compatible API（OpenAI、DeepSeek、Kimi 或自定义地址）逐段翻译。PDF 文本提取只使用 PDF.js 文本层，不做 OCR；扫描版图片 PDF 无法自动提取正文。

## 功能

- 打开本地英文 PDF。
- PDF 左侧连续滚动阅读，支持上一页、下一页、页码跳转、按钮缩放、`Ctrl + 鼠标滚轮` 按鼠标位置缩放、空格键拖拽或鼠标中键拖拽平移。
- PDF 文本层支持鼠标选中复制；JSON 当前段会尽量在 PDF 内按完整段落、句子或模糊片段高亮。
- 右侧原文和译文支持 KaTeX 公式渲染，行内公式使用 `$...$`，独立公式使用 `$$...$$`。
- 从 PDF 提取出的裸公式行也会尽量转换为 KaTeX 显示，减少算法伪代码和公式阅读时的乱码感。
- AI 模式当前段译文框支持纵向拖拽调整高度，方便阅读长段落。
- 右侧提供“阅读笔记”折叠面板，按论文自动保存到本机论文库。
- 界面采用简洁黑白灰风格，顶部工具栏加入品牌图标，关键状态使用高对比黑白样式。
- 默认进入“论文库”主页，按表格管理看过的论文。
- 论文库记录中文标题、英文标题、期刊、作者、年份、最近打开时间和上次阅读页码。
- 打开本地翻译文件，支持 `.json`、`.md`、`.markdown`、`.txt`。
- JSON 翻译模式：
  - 默认只显示英文原文；
  - 点击“翻译当前段”显示中文译文；
  - 点击“上一段原文”或“下一段原文”会自动隐藏译文；
  - 支持编辑当前段译文；
  - 点击“保存翻译”写回本地 JSON 文件。
- Markdown 翻译模式：
  - 按空行切分为多个中文段落；
  - 支持上一段/下一段切换；
  - 点击“保存翻译”写回 Markdown 文件。
- 手动模式：
  - 右侧提供“AI 提示词”区域；
  - 可一键复制当前段或全文 JSON 生成提示词，拿去给外部 AI 使用。
- AI 模式：
  - 支持 OpenAI、DeepSeek、Kimi、Custom 四类 OpenAI-compatible 接口；
  - OpenAI preset 包含官方模型选项，例如 `gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`、`gpt-5.4-nano`、`gpt-5.2`、`gpt-5.2-pro`、`gpt-5.1`、`gpt-5` 等；
  - API Key 通过 Electron `safeStorage` 优先加密保存到本机；
  - 支持刷新当前 Provider 的模型列表，优先使用服务商 `/models` 返回的可用模型；
  - 支持查询 Kimi、DeepSeek 余额，以及 OpenAI 近 7 天成本概览；
  - 可从 PDF 文本层生成 JSON 缓存草稿；
  - 翻译完成后逐段写回 JSON 缓存，避免重复消耗 token；
  - 当前段操作条固定在 AI 模式顶部；队列中每一行也提供“翻译 / 重译”，不需要上下滚动找按钮；
  - 保存过的 AI JSON 缓存会绑定到当前论文记录，下次从论文库打开时自动导入；
  - 提示词会要求模型保留 LaTeX 定界符，便于右侧公式排版。
- 新建翻译项目：
  - 依次选择 PDF 和翻译文件；
  - 自动加入论文库并保存到 `localStorage`；
  - 下次启动默认显示论文库，可从表格继续打开阅读。
- 导出双语 Markdown：
  - 当前翻译文件为 JSON 时可用；
  - 导出为 `## section`、`Original`、`Translation` 结构。
- 可选全局快捷键：
  - 应用运行时按 `Ctrl + Alt + P` 可把窗口显示到前台；
  - 应用退出时会自动释放快捷键。

## 安装依赖

```bash
npm install
```

## 开发模式启动

```bash
npm run dev
```

该命令会启动 Vite 开发服务器，并打开 Electron 桌面窗口。

## 构建检查

```bash
npm run build
```

该命令会依次运行：

- `npm test`
- TypeScript 类型检查
- Vite 前端构建
- Electron 主进程构建

## 视觉检查

```bash
npm run visual:check
```

该命令会启动打包后的 `dist/win-unpacked/PDF Translation Reader.exe`，用真实论文做自动截图检查。

默认测试文件路径为：

```text
D:\GPT浏览器下载\2604.15483v2.pdf
```

如需指定其它 PDF：

```bash
set VISUAL_CHECK_PDF=D:\path\to\paper.pdf
npm run visual:check
```

截图输出到：

```text
.tmp-visual-check/
```

检查内容包括：

- PDF 当前段高亮是否越界；
- 高亮线是否保持细线；
- AI 队列是否混入明显图中文字噪声；
- AI 当前译文框是否可调整高度；
- 论文阅读笔记是否自动保存到论文库；
- 论文记录中的 AI JSON 缓存是否能在下次打开时自动导入；
- 右侧公式是否成功渲染为 KaTeX；
- 顶部品牌图标、AI 快捷操作条、每行翻译按钮和折叠面板是否正常显示。

## 生成 Windows 安装包

```bash
npm run dist
```

打包产物位于：

```text
dist/
```

当前 `electron-builder` 配置：

- `appId`: `com.local.pdf.translation.reader`
- `productName`: `PDF Translation Reader`
- Windows target: `nsis`
- 安装后创建桌面快捷方式
- 安装后创建开始菜单快捷方式
- 快捷方式名称：`PDF Translation Reader`
- 安装包和桌面快捷方式图标：`assets/icon.ico`

`npm run dist` 已配置 `ELECTRON_BUILDER_BINARIES_MIRROR`，用于下载 NSIS 等 electron-builder 打包工具二进制，减少 GitHub 连接失败导致的打包中断。

安装完成后，双击桌面上的 `PDF Translation Reader` 快捷方式即可打开应用。

## 使用方式

### 新建翻译项目

1. 在“论文库”主页点击“新建翻译项目”。
2. 先选择英文原文 PDF。
3. 再选择翻译文件，支持 JSON 或 Markdown。
4. 应用会把论文加入主页表格。
5. 后续可在主页点击“打开阅读”继续阅读。

### 编辑论文信息

主页表格中点击“编辑信息”，可以修改：

- 中文标题
- 英文标题
- 期刊
- 作者
- 年份

这些信息保存在本机 `localStorage`，不上传到任何在线服务。

### 单独打开文件

也可以分别点击：

- “打开 PDF”
- “打开翻译文件”

用于替换当前阅读中的 PDF 或翻译稿。

### 保存译文

编辑当前段译文后，点击“保存翻译”写入本地文件。

JSON 文件会保存为数组结构；Markdown 文件会按空行分隔段落保存。

### PDF 阅读操作

- 普通鼠标滚轮：上下连续滚动。
- `Ctrl + 鼠标滚轮`：按鼠标所在位置放大或缩小。
- 空格键按住后左键拖动：平移 PDF 视图。
- 鼠标中键拖动：平移 PDF 视图。
- 普通左键拖选：选中 PDF 文本并复制。

### 手动模式提示词

右侧切到“手动模式”后，在“AI 提示词”区域点击：

- “复制当前段 JSON 提示词”：让外部 AI 只翻译当前段；
- “复制全文 JSON 提示词”：让外部 AI 按数组输出整篇 JSON。

提示词会要求外部 AI 只返回 JSON 数组，不要使用 Markdown 代码块，不要输出解释文字。

### AI 模式

1. 右侧切到“AI 模式”。
2. 选择 Provider：OpenAI、DeepSeek、Kimi 或 Custom。
3. 填写 `Base URL`、`Model` 和 `API Key`，点击“保存 AI 设置”。
4. 可点击“刷新模型”从当前 Provider 拉取可用模型列表。
5. 可点击“刷新余额”查看 Kimi/DeepSeek 余额或 OpenAI 近 7 天成本。
6. 打开 PDF 后等待文本层提取完成，展开“PDF 提取与缓存”，点击“生成/刷新 JSON 缓存”。
7. 点击“保存 AI JSON”选择缓存文件位置。
8. 点击顶部“AI 翻译当前段”或“批量翻译未缓存”，也可以在队列某一行直接点击“翻译 / 重译”。

AI 模式会跳过已有 `translation` 的段落；如果要重新调用 API，使用“重新翻译当前段”。

保存 AI JSON 后，缓存路径会写入当前论文库记录。下次在“论文库”点击同一篇论文的“打开阅读”，应用会同时读取 PDF、手动翻译文件和 AI JSON 缓存，并在 AI 模式中直接显示已缓存译文。

### 阅读笔记

右侧顶部有“阅读笔记”折叠面板。展开后可以记录：

- 论文核心结论；
- 公式推导和符号解释；
- 复现实验计划；
- 对照实验或消融实验想法；
- 后续论文 idea。

笔记内容会自动保存到本机论文库的当前论文记录中，不会写入 PDF，也不会上传到任何在线服务。

### 公式显示

右侧阅读区支持常见 LaTeX 定界符：

- 行内公式：`$L=\sum_i x_i^2$`
- 独立公式：`$$\max_\theta \mathbb{E}[R]$$`
- 也支持 `\(...\)` 和 `\[...\]`

JSON 或 Markdown 译文中保留这些定界符后，应用会自动渲染公式。AI 模式的系统提示词和手动模式复制提示词都已经加入“保留 LaTeX 定界符”的要求。

从 PDF 文本层提取出的算法伪代码或独立公式行，即使没有 `$...$` 定界符，也会尽量按本地规则转换成 KaTeX 展示；普通正文不会被强制当作公式处理。

### 导出双语 Markdown

当前翻译文件为 JSON 时，点击“导出双语 Markdown”。

导出格式示例：

```markdown
## Abstract

**Original**

We present a new robotic foundation model, called π0.7...

**Translation**

我们提出一种新的机器人基础模型，称为 π0.7...
```

## JSON 翻译文件格式

JSON 文件必须是数组，每一项包含：

- `section`
- `original`
- `translation`

示例：

```json
[
  {
    "section": "Abstract",
    "original": "We present a new robotic foundation model, called π0.7...",
    "translation": "我们提出一种新的机器人基础模型，称为 π0.7..."
  },
  {
    "section": "I. INTRODUCTION",
    "original": "Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.",
    "translation": "基础模型的工作原理在于：通用能力会从大规模且多样化的数据集训练中涌现出来。若包含公式，例如 $L=\\sum_i x_i^2$，会在右侧渲染。"
  }
]
```

## Markdown 翻译文件格式

Markdown 文件按空行切分段落。

推荐在文件开头写论文元信息，主页会自动预填：

```markdown
中文标题：机器人基础模型 π0.7
英文标题：A Robotic Foundation Model
期刊：arXiv
作者：Author A, Author B
年份：2025

摘要

我们提出一种新的机器人基础模型，称为 π0.7。
```

如果没有这些元信息，应用会用第一个中文段落预填中文标题，用 PDF 文件名预填英文标题。

示例：

```markdown
我们提出一种新的机器人基础模型，称为 π0.7。

基础模型的工作原理在于：通用能力会从大规模且多样化的数据集训练中涌现出来。

这是一段新的中文译文。
```

## 项目结构

```text
src/
  main/
    main.ts              Electron 主进程：窗口、文件对话框、读写文件、全局快捷键
    preload.ts           安全暴露给 React 的 IPC API
  renderer/
    App.tsx              应用状态、最近项目恢复、文件操作协调
    main.tsx             React 入口
    assets/
      brand-mark.png     顶部工具栏品牌图标
    components/
      HomePage.tsx       论文库主页和论文信息表格
      AiModePanel.tsx    AI 设置、PDF 提取缓存、批量翻译队列
      MathText.tsx       KaTeX 公式渲染组件
      NotesPanel.tsx     当前论文阅读笔记面板
      PdfViewer.tsx      PDF.js 阅读器、文本层、搜索高亮和缩放交互
      Toolbar.tsx        顶部工具栏
      TranslationPanel.tsx 右侧段落阅读和编辑组件
    lib/
      aiMode.ts          PDF 提取块转换为 AI JSON 缓存的辅助逻辑
      mathText.ts        解析普通文本和 LaTeX 公式并生成安全 HTML
      papers.ts          论文库记录、元数据预填、localStorage 序列化辅助
      papers.test.ts     论文库数据处理测试
      promptTemplates.ts 外部 AI JSON 提示词生成
      translation.ts     JSON/Markdown 解析、保存、双语 Markdown 导出
      translation.test.ts 翻译数据处理测试
    styles/
      global.css         全局样式
    types/
      electron.d.ts      preload API 类型声明
  shared/
    aiTranslation.ts     OpenAI-compatible 请求构造、缓存跳过规则和 provider preset
scripts/
  visual-check.mjs       打包后桌面端视觉回归检查
assets/
  icon.ico               Windows 安装包和快捷方式图标
```

## 后续可扩展方向

- 增加 PDF 书签或页码与段落的手动映射。
- 增加段落搜索。
- 增加双栏同步阅读进度。
- 增加多项目列表。
- 增加本地模型或更细粒度 provider 配置。
- 增加公式识别辅助，把纯文本公式半自动转换为 LaTeX。
