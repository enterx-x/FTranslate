# PDF Translation Reader / FTranslate

FTranslate 是一个 Windows 桌面端科研论文工作台，面向论文阅读、PDF 翻译、研究表格整理、AI 大观分析、知识图谱、阅读笔记和组会 PPT 草稿生成。

当前主流程是：

1. 导入英文论文 PDF；
2. 使用本地 PDF.js 阅读；
3. 可用 PDFMathTranslate / pdf2zh 生成双语 PDF；
4. 在论文库、研究表格、AI 助手、知识图谱和阅读笔记中整理研究信息；
5. 可基于当前 PDF 提取文本与图表候选，生成组会 PPT 草稿，并导出 Markdown / JSON / 可编辑 PPTX。

## 技术栈

- Electron + React + TypeScript + Vite
- PDF.js 本地渲染 PDF
- PDFMathTranslate / pdf2zh 作为双语 PDF sidecar
- Univer 作为独立研究表格
- KaTeX + Markdown 渲染公式与研究笔记
- PptxGenJS 生成可编辑 PowerPoint `.pptx`
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
dist/PDF Translation Reader Setup 0.1.12.exe
```

安装完成后会创建桌面快捷方式和开始菜单快捷方式。
如果需要确认安装包内的界面就是当前构建，可以先运行 `npm run dist`，再运行：

```powershell
$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check
```

## 主要模块

### 工作台首页

首页采用左侧深色 App Shell + 右侧浅色工作区。主要入口包括：

- 研究表格
- 知识图谱
- 组会 PPT 生成
- 论文库
- PDF 阅读
- AI 问答
- AI 助手
- 设置

### PDF 阅读与双语 PDF

- 打开本地 PDF；
- 连续滚动阅读；
- 缩放、翻页、页码跳转；
- 原文 PDF / 左右双语 / 双语 PDF 文件切换；
- 导入已有中文或双语 PDF；
- 导出已绑定双语 PDF；
- 从当前 PDF 的 Figure / Table caption 推断图表区域，提取文献图片缩略图，并把图片/caption 提供给 AI 辅助理解；
- 基于当前 PDF 生成组会 PPT 草稿。

PDFMathTranslate sidecar 会优先查找系统中的 `pdf2zh` / `pdf2zh_next`。如果找不到，会尝试在 Electron 用户数据目录中创建私有 Python 翻译环境。

生成双语 PDF 时，应用会为 pdf2zh 写入一个本地学术翻译 prompt，用来约束模型保留公式占位符、引用编号、Fig./Table 编号、DOI、URL 和 References / Bibliography 条目结构。Windows 子进程会强制使用 UTF-8 环境，减少进度条和接口错误在界面中显示乱码。

默认双语 PDF 缓存位置：

```text
%APPDATA%\pdf-translation-reader\translations\<paperId>\
```

### arXiv 检索

arXiv 检索是一个独立模块，不会自动改写论文库或 PPT 草稿。它使用 arXiv 官方 Atom API 检索论文，并在本机缓存短时间搜索结果，减少重复请求。

已支持：

- 关键词、分类、排序、顺序、起止年份、页内年份、标签和每页数量设置；
- 中文关键词会在本地扩展为英文检索词，例如“强化学习”“机器人导航”“无人机避障”“医学影像”“信息检索”“数据库”“网络安全”“计算机图形学”会转换为对应英文检索词，避免 arXiv API 直接按中文词过滤导致结果过少；
- 检索同时匹配 title 和 abstract；年份范围会写入 arXiv submittedDate 查询条件；
- 每页数量支持 20 / 50 / 100 / 200，并显示 arXiv 返回的总结果数与当前结果范围；
- 桌面端采用左侧全局导航、顶部紧凑搜索筛选、中间论文卡片和右侧论文详情的科研检索布局；
- 论文结果支持单列 / 双列 / 三列切换，默认三列，选择会通过 `pdfTranslationReader:arxivResultColumnMode` 写入 localStorage，刷新后保留；
- 点击搜索、上一页或下一页时才会请求 arXiv，输入关键词不会自动触发请求；
- 按年份、标签、收藏、备选、已翻译、已评分筛选当前结果页；
- 显示标题、中文标题、作者、发布日期、更新时间、分类、英文摘要、中文摘要、arXiv 链接和 PDF 链接；摘要中的 `$...$` / `$$...$$` 会走公式渲染；
- 使用本地启发式评分生成相关性、新颖性、实验线索、阅读优先级和研究标签；
- 可自动排队翻译当前结果页的标题和摘要；优先使用本地 NLLB + CTranslate2，失败后回退 Argos Translate + SQLite 缓存，不消耗 AI API token；
- 离线翻译使用批量队列和持久 Python worker：首次翻译需要加载模型，后续同一运行期间会复用 worker，批量标题 / 摘要翻译会明显更快；NLLB 可用时界面会显示 CUDA / CPU 回退等运行状态；
- 翻译缓存会自动拒绝常见乱码结果，并对专有方法名、模型名、缩写和重复尾巴做质量修复；旧缓存中如果出现 `���`、`æœºå™¨`、`鏈哄櫒` 等编码损坏文本，界面会退回英文并允许重新翻译；
- 如果未安装 Argos Translate 或未安装 en -> zh 模型，界面会保留英文标题/摘要并提示本地翻译不可用；AI 翻译仍只在 AI 助手或明确 AI 操作中使用；
- 可复制 BibTeX、复制 / 导出 Markdown 摘要；
- 可收藏论文，或加入组会 PPT 候选队列；PPT 生成仍只读取用户已下载或手动选择的本地 PDF；
- 下载 arXiv PDF 到用户选择的本地路径；
- 下载完成后把 PDF 加入本地论文库；
- 保持与 PPT 生成分离：需要生成 PPT 时，再从论文库、PDF 阅读页或组会 PPT 页面选择 PDF。

#### arXiv 离线翻译配置

arXiv 标题和摘要翻译优先调用本机 NLLB worker；如果 NLLB 不可用，会回退到本机 `argos-translate`，不会自动切到 AI API。如果界面提示“离线翻译未配置”或需要配置 Argos fallback，可以在 Windows PowerShell 中按下面步骤安装：

```powershell
$venv = "$env:LOCALAPPDATA\FTranslate\argos-translate"
py -3.11 -m venv $venv
& "$venv\Scripts\python.exe" -m pip install --upgrade pip
& "$venv\Scripts\python.exe" -m pip install argostranslate
@'
import argostranslate.package

from_code = "en"
to_code = "zh"

argostranslate.package.update_package_index()
available_packages = argostranslate.package.get_available_packages()
package_to_install = next(
    package for package in available_packages
    if package.from_code == from_code and package.to_code == to_code
)
argostranslate.package.install_from_path(package_to_install.download())
'@ | & "$venv\Scripts\python.exe"
& "$venv\Scripts\argos-translate.exe" --from-lang en --to-lang zh "hello"
```

如果最后一行能输出中文结果，再把 CLI 目录加入当前用户 PATH，然后重启 FTranslate：

```powershell
$argosScripts = "$env:LOCALAPPDATA\FTranslate\argos-translate\Scripts"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$argosScripts*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$argosScripts", "User")
}
```

模型文件由 Argos Translate 安装到当前 Windows 用户的本地模型目录中；不需要放进本项目仓库，也不要提交到 git。如果你使用其他 Python 版本，把 `py -3.11` 改成机器上实际可用的 `py -3.10`、`py -3.12` 或完整 Python 路径。

如果你把 Argos 安装在空间更充足的 `D:` / `E:` 盘，可以用环境变量显式指定路径，避免应用只从 PATH 查找：

```powershell
[Environment]::SetEnvironmentVariable("FTRANSLATE_ARGOS_CLI", "E:\FTranslateTools\argos-conda\Scripts\argos-translate.exe", "User")
[Environment]::SetEnvironmentVariable("FTRANSLATE_ARGOS_PACKAGES_DIR", "E:\FTranslateTools\argos-data\packages", "User")
```

修改后重启 FTranslate。SQLite 翻译缓存位于 Electron 用户数据目录下的 `arxiv-translation-cache.sqlite`，同一篇论文标题 / 摘要命中缓存后不会重复调用 Argos。

### NLLB + CTranslate2 离线高质量翻译

FTranslate 现在支持本地 `NLLB-200 distilled 600M + CTranslate2 int8` 翻译层，用于：

- arXiv 检索页标题和摘要的本地批量翻译；
- JSON / 段落翻译队列的本地批量翻译；
- Argos 翻译质量不足时的高质量离线替代。

它不会替换 PDFMathTranslate / pdf2zh 的整篇双语 PDF 引擎。整篇 PDF 排版翻译仍由 PDFMathTranslate 处理；NLLB 主要负责标题、摘要和段落级文本。

默认安装位置在空间较大的 `E:\FTranslateTools\`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-nllb-ct2.ps1
```

脚本会创建：

```text
E:\FTranslateTools\nllb-ctranslate2
E:\FTranslateTools\models\nllb-200-distilled-600M-ct2-int8
E:\FTranslateTools\hf-cache\nllb-200-distilled-600M-snapshot
```

并写入用户环境变量：

```text
FTRANSLATE_NLLB_PYTHON
FTRANSLATE_NLLB_MODEL_DIR
FTRANSLATE_NLLB_TOKENIZER_DIR
FTRANSLATE_NLLB_DEVICE
```

`FTRANSLATE_NLLB_DEVICE` 默认是 `auto`：应用会优先尝试 CUDA，失败后自动回退 CPU。安装后请重启 FTranslate，让 Electron 读取新的用户环境变量。

如果 NLLB 环境不可用，应用会自动回退到 Argos。SQLite 缓存会记录实际使用的 engine，避免同一标题/摘要重复翻译。

### AI 问答

AI 问答是独立页面，不是 AI 助手里的子模块。入口位于左侧导航栏“AI 问答”，界面采用主流 ChatGPT 式布局：

- 左侧选择一篇或多篇论文作为上下文，并支持多个“问答窗口”，每个窗口可新建、命名、删除，并保留独立论文选择和消息历史；
- 中间是导师式聊天区，支持“开始提问”“我不会”和自由追问；每次发送都会把当前窗口选中论文的标题、笔记、PDF 文本片段和图表 caption 作为证据包发给模型；
- 右侧展示当前窗口论文对应的图表缩略图、caption 和 PDF 文本片段，图表缩略图可点击放大；
- AI 会像组会老师一样追问论文方法输入、输出、模型变换、损失或训练目标、实验指标和多论文差异；
- 用户回答不出来时，AI 会先给出解答，再继续拆成更小的问题。

AI 问答复用同一套 AI Provider / API Key 设置，但页面和状态与 AI 助手分离。若没有提取图片，可以先在 PDF 阅读页点击“提取文献图片”。

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

当前实现的是第一阶段稳定版本，重点是“先生成可检查、可编辑、可导出的结构化组会 PPT”。PPTX 导出使用 MIT 开源库 [PptxGenJS](https://github.com/gitbrent/PptxGenJS)，适合 Electron / Vite / React 侧生成标准 OOXML PowerPoint 文件。

已支持：

- 从当前 PDF 的文本块生成组会 PPT 草稿；如果缓存中的文本块尚未就绪，会主动用 PDF.js 从当前 PDF 重新抽取正文、章节和 Fig. / Figure / Table caption；
- 抽取 Abstract、Introduction、Method、Experiments、Conclusion 等章节信息；
- 从论文文本中抽取真实模块名、观测输入、动作输出、训练目标、约束、baseline 和指标，避免生成“论文信息 / 研究对象 / 方法线索”这类空泛占位；
- 方法页和公式页会优先保留论文自己的模块链路，例如 context encoder、MoE policy、joint targets、`J(theta)`、`R_tracking`、`C_collision` 等关键证据；
- 实验页和结果页会优先保留真实平台、任务、baseline 和指标，例如 Unitree G1、PPO、MPC、blind baseline、success rate、fall rate、tracking error 等；
- PPTX 质量门会过滤“本页聚焦 / 本页讲清 / 本页回到”等页面模板前缀，主张区和证据卡优先显示论文原文抽取到的具体对象、模块、流程、实验和指标；
- PPTX 质量门允许短技术术语保留英文，但会拦截整句英文原文、名词堆叠、通用占位结构图和 slide type / source 不匹配；
- 默认生成 12 页组会结构：封面、论文信息、背景、Related Work、方法、公式、实验、结果、创新、局限、启发和总结；
- 识别 Fig. / Figure / Table caption 作为图表候选；
- 根据 caption 所在位置做保守裁剪：页顶 Table / Figure caption 优先向下取图，页底 caption 优先向上取图；
- 跳过 References / Bibliography 作为默认策略；
- 生成结构化 PPT 大纲 JSON；
- 提供 HTML 幻灯片预览；
- 编辑当前页标题、bullet 和 speaker notes；
- 导出 Markdown 大纲；
- 导出 JSON 大纲；
- 导出可编辑 `.pptx`，包含深色封面、核心观点、要点卡片、图表证据占位、来源页脚和讲稿备注；
- 在 AI 助手中提供“组会 PPT 生成”提示词模板。

尚未完成：

- 多面板真实图表的精准裁剪和人工裁剪工具；
- AI 自动重写完整 PPT 大纲的稳定质量门控；
- 多篇论文综述式 PPT 自动合并。

后续建议继续补充图表接触表、人工裁剪确认、AI 增强大纲质量检查和多篇论文综述式合并。

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

当前视觉检查会覆盖首页、论文库、研究表格、PDF 阅读、组会 PPT、AI 问答、AI 助手、arXiv 检索和设置页。arXiv 检索会检查三列 / 双列 / 单列布局、列数持久化、顶部高级筛选密度、空结果备选论文库紧凑状态、右侧详情面板、分页和横向溢出；AI 问答会检查独立页面、会话窗口入口和 ChatGPT 式布局。失败时会保留对应截图，便于继续定位布局或渲染问题。

检查打包后的实际应用：

```powershell
$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check
```

可指定论文：

```bash
set VISUAL_CHECK_PDF=D:\path\to\paper.pdf
npm run visual:check
```

当前视觉质量门还会检查：

- PDF 阅读页初始居中，避免首次打开只看到页面左半边；
- PDF 右侧栏窄宽拖拽、折叠和展开状态下的横向溢出；
- arXiv 三列 / 双列 / 单列布局的卡片宽度、标题高度、分页高度和右侧详情栏宽度；
- arXiv 备选论文库是否被结果卡片遮挡，以及是否使用会盖住卡片的原生长 `title` tooltip；
- 研究表格顶部工具区高度、命令栏溢出和表格主体可用高度；
- 设置页默认“通用设置”是否真的显示表单控件。

## 架构边界

当前代码已经开始从早期的单文件集中状态拆分为可组合的领域模块：

- `src/renderer/hooks/`：承载 PDF 会话、论文库、研究表格、AI 设置、AI 翻译、双语 PDF 生成、状态队列、阅读器侧栏和视图切换等状态逻辑；
- `src/renderer/contexts/`：提供 PDF 会话、论文库、AI 翻译和 UI 状态的 Context 边界，减少跨页面 prop drilling；
- `src/main/ipc/handlers/`：按 AI、arXiv、PDF、文件导出和项目加载拆分 IPC handler 注册入口；
- `src/main/aiResponseParsing.ts`、`src/main/ipcSafety.ts`、`src/main/excelExportSafety.ts`：集中处理 AI JSON 解析、IPC 输入安全和 Excel 导出安全检查；
- `scripts/visual-check.mjs`：作为 UI 回归质量门，不只是截图脚本，失败时会保留定位截图。

## 项目结构

```text
src/
  main/
    main.ts                 Electron 窗口生命周期、sidecar 编排和 IPC 注册入口
    preload.ts              暴露给 React 的安全 IPC API
    ipc/
      handlers/             AI、arXiv、PDF、文件导出和项目加载 IPC handler
    aiResponseParsing.ts    AI JSON/Responses 解析与友好错误
    ipcSafety.ts            IPC 输入路径和参数安全检查
    excelExportSafety.ts    Excel 导出路径与扩展名保护
  renderer/
    App.tsx                 顶层视图路由、Provider 组合和页面布局
    components/
      HomePage.tsx          工作台首页和论文库
      PdfViewer.tsx         PDF.js 阅读器
      ResearchSheetPage.tsx 独立研究表格
      AiAssistantPage.tsx   AI 助手
      PaperTutorPage.tsx    论文导师问答
      StatusBar.tsx         底部状态消息队列展示
      ErrorBoundary.tsx     懒加载页面错误边界
      KnowledgeGraphPage.tsx 知识图谱
      PresentationPage.tsx  组会 PPT 草稿预览与导出
      ArxivSearchPage.tsx   arXiv 检索与 PDF 下载
      PdfFigureAssetsPanel.tsx PDF 图表候选展示
      NotesPanel.tsx        阅读笔记
      SettingsPage.tsx      设置页
      MarkdownDocument.tsx  Markdown + 公式渲染组件
    contexts/
      PdfSessionContext.tsx PDF 会话状态边界
      PaperLibraryContext.tsx 论文库和研究表格状态边界
      AiTranslationContext.tsx AI 翻译状态边界
      UiContext.tsx         UI 视图、状态栏和侧栏状态边界
    hooks/
      usePdfSession.ts      当前 PDF、页码、缩放和视图模式
      usePaperLibrary.ts    论文库 CRUD 和 localStorage 同步
      useResearchWorkbook.ts 研究表格、绑定和导入导出状态
      useAiTranslation.ts   段落翻译、AI cache 和批量翻译状态
      usePdfTranslation.ts  双语 PDF 生成进度和 sidecar 状态
      useReaderSidePanel.ts PDF 阅读侧栏宽度、折叠和持久化
      useStatusQueue.ts     多条状态消息队列
      useViewTransition.ts  轻量视图切换过渡
    lib/
      arxivClient.ts        arXiv 官方 Atom API 查询与解析
      appSettings.ts        本地设置解析与默认值
      knowledgeGraph.ts     知识图谱数据生成与导出
      presentationOutline.ts 组会 PPT 大纲生成与 Markdown 导出
      presentationPptx.ts    组会 PPTX 版式计划与 PptxGenJS 导出
      markdownDocument.ts   安全文档渲染
      paperTutor.ts         论文导师上下文、证据和追问逻辑
      papers.ts             论文库记录
      researchWorkbook.ts   研究表格本地模型
      translation.ts        JSON/Markdown/TXT 兼容解析
  shared/
    aiTranslation.ts        OpenAI-compatible chat completions
    academicTranslationQuality.ts 学术标题/摘要翻译质量修复
    pdfTranslation.ts       PDFMathTranslate 命令、缓存和输出路径
scripts/
  visual-check.mjs          开发/打包后 UI 视觉回归检查脚本
  install-nllb-ct2.ps1      NLLB + CTranslate2 本地翻译环境安装脚本
assets/
  icon.ico                  Windows 安装包与快捷方式图标
```
