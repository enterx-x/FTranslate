# PDF Translation Reader

一个本地离线的 Windows 桌面端“PDF 原文 + 中文翻译交互阅读器”。

技术栈：

- Electron
- React
- TypeScript
- Vite
- PDF.js
- electron-builder

第一版不接 OpenAI API，不自动翻译，不做 OCR，也不强制从 PDF 中提取段落。PDF 只负责原文阅读；段落数据来自用户导入的 JSON 或 Markdown 翻译文件。

## 功能

- 打开本地英文 PDF。
- PDF 左侧阅读，支持上一页、下一页、页码跳转、放大、缩小。
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
    "translation": "基础模型的工作原理在于：通用能力会从大规模且多样化的数据集训练中涌现出来。"
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
    components/
      HomePage.tsx       论文库主页和论文信息表格
      PdfViewer.tsx      PDF.js canvas 渲染组件
      Toolbar.tsx        顶部工具栏
      TranslationPanel.tsx 右侧段落阅读和编辑组件
    lib/
      papers.ts          论文库记录、元数据预填、localStorage 序列化辅助
      papers.test.ts     论文库数据处理测试
      translation.ts     JSON/Markdown 解析、保存、双语 Markdown 导出
      translation.test.ts 翻译数据处理测试
    styles/
      global.css         全局样式
    types/
      electron.d.ts      preload API 类型声明
assets/
  icon.ico               图标占位文件，后续可替换为正式图标
```

## 后续可扩展方向

- 增加 PDF 书签或页码与段落的手动映射。
- 增加段落搜索。
- 增加双栏同步阅读进度。
- 增加多项目列表。
- 后续再接入本地模型或 OpenAI API 做半自动翻译，但第一版保持离线。
