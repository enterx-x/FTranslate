# PDF Translation Reader / FTranslate

## 2026-07-13 科研绘图、arXiv 翻译与 PDF 选词翻译（0.1.18）

- 科研绘图新增可选字体、标题对齐/颜色/字重、折线样式、标记、透明度、画布边距、图例位置/排列/自定义坐标/字号/间距/符号尺寸/边框与背景，以及坐标轴线、刻度、标题和标签颜色。所有公共参数统一写入 PlotSpec，并映射到 ECharts、Python、R 与 MATLAB。
- Python、R、MATLAB 真实渲染统一读取 UTF-8 BOM 数据并优先选择可显示中文的已安装字体；R 修复坐标范围字段的部分匹配问题，MATLAB 修复百分比刻度和轴标题被裁切的问题。
- arXiv 搜索后的前 6 篇后台预翻译改为可抢占的单篇任务。卡片在后台翻译时仍可点击“优先翻译”，前台请求会获得更高优先级；空 IPC 结果会显示明确错误，不再静默无响应。
- PDF 阅读器现在可以直接在 PDF.js 文字层选中单词、短语或段落。选区旁会出现“选中翻译”卡片，自动判断英→中/中→英，使用现有本地 NLLB/Argos，支持重新翻译、复制译文和关闭；无需先生成整篇双语 PDF。
- PDF 阅读器首次打开论文时自动按可用宽度显示并水平居中，页面左右边界完整可见；用户之后仍可继续缩放、滚动和恢复阅读位置。
- AI 全文翻译保留每一段完整原文和术语上下文，不采用“机翻后选择性润色”。为降低重复消耗，系统会按翻译引擎、模型和原文哈希复用完全一致的已成功译文，并压缩固定指令中的重复表述；强制重译会绕过缓存。

使用选词翻译：打开“PDF 阅读”，拖动选中文字，点击选区旁的“翻译选中内容”。扫描版 PDF 如果没有文字层，需要先 OCR 后才能选择文字。

AI 译文缓存保存在应用用户数据目录的 `ai-translation-cache.json`，最多保留 4000 条。只有同一引擎、同一模型、同一原文且未点击强制重译时才会命中，因此不会用机器翻译替代 AI 对原文的完整检查。
> 2026-07-13：arXiv 结果区的“备选论文库”支持在有检索结果时展开和收起；默认保持紧凑，不影响单列、双列、三列结果布局，空结果页仍直接展示备选论文。

> 2026-07-12：科研绘图工作区完成可读性与交互层级优化。三栏绘图结构、统计逻辑和本地 Runtime 接口保持不变；字段列表、图层 Inspector、工具栏和状态条统一为 Research OS 视觉语言，并支持减少动态效果与减少透明度的系统偏好。

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

## 产品与设计方向

FTranslate 的长期方向是本地化 AI 科创研发工作台，而不是单纯的 PDF 翻译器。当前界面仍处于迁移阶段，不作为最终 UI 参考。

未来 UI 以 [DESIGN.md](DESIGN.md) 为设计基准：主底座参考 IBM / Carbon 的高信息密度工作台风格，文档和证据阅读参考 Mintlify，产品面板参考 Supabase，AI 研发流程参考 Cursor，Linear 仅作为克制 App Shell 和状态组件的局部参考。

## 第一阶段项目空间迁移

当前第一阶段已把首页和左侧导航从“PDF 翻译器入口集合”迁移为“本地 AI 科创研发项目空间”：

- 左侧导航优先展示“项目空间 / 实验矩阵 / 证据图谱 / 组会 PPT”，旧的论文库、研究表格、PDF 阅读、论文导师、AI 助手和设置仍保留为兼容入口。
- 首页展示当前本地项目、论文对象、证据数量、双语 PDF、研发闭环阶段、下一步动作和风险队列。
- 首页视觉已回到克制的卡片化研发工作台：中心保留 4 张真实流程对象卡，项目 KPI 合并为分段指标块，右侧焦点 / 下一步 / 风险合并为连续 Inspector；状态色采用低饱和灰绿、雾灰蓝和蓝灰，避免亮蓝/亮绿/亮黄塑料感，也避免棕色旧纸感。
- 左侧 App Shell 选中态已收敛为石墨 / 蓝灰，不再使用高饱和紫蓝描边；视觉检查会拦截侧栏选中态颜色通道差过高的回潮。
- 新增项目空间本地数据模型，存储键为 `pdfTranslationReader:researchProjects`；首次创建默认项目时会接入当前论文，后续论文与项目的归属由用户显式管理，不再自动吞并所有新论文。
- 旧论文库、研究表格、知识图谱、PDF 阅读和 PPT 生成数据仍沿用原有 localStorage 与本地文件结构，不做破坏性迁移。
- 当前动效不引入 GSAP；页面切换、面板进入、按钮反馈、状态 badge shimmer 和知识图谱节点 halo 均使用 CSS transition / keyframes 完成，并支持 `prefers-reduced-motion` 降级，避免增加依赖和 Windows 打包风险。

## 运行与打包

```bash
npm install
npm run dev
```

构建源码：

```bash
npm run build
```

运行可持续 headless 研发闭环 demo：

```bash
npm run demo:research-loop
```

该 demo 不打开 Electron UI，也不调用外部 AI API。它会使用内置安全强化学习导航样例，把 PDF 文本块、Figure / Table caption 和阅读笔记编译为方法卡，再派生 baseline / proposed / ablation 实验矩阵，并输出到：

```text
demo-output/research-loop/
```

输出文件包括：

- `README.md`：demo 运行说明和质量门；
- `research-loop-summary.json`：项目、论文、证据、方法卡和实验行摘要；
- `method-card.json`：字段级证据绑定方法卡；
- `experiment-matrix.md`：可读 Markdown 实验矩阵；
- `local-storage-seed.json`：可供 UI 或后续自动化使用的 localStorage seed 数据。

运行无 UI 的代码仓库扫描与 Paper-to-Code 映射 demo：

```bash
npm run demo:code-repo
```

该 demo 不打开 Electron UI，也不会执行样例仓库代码。它会创建一个安全强化学习导航代码仓库 fixture，执行只读扫描，把 manifest、训练入口、配置文件、方法卡字段和一段失败日志映射为可追踪代码证据、复现诊断、手动运行计划和 15 分钟复现任务包，并输出到：

```text
demo-output/code-repository/
```

输出文件包括：

- `repository-scan.json`：仓库文件、manifest、入口脚本、配置文件和风险摘要；
- `repository-summary.md`：可读的仓库扫描与方法到代码映射说明；
- `paper-to-code-mapping.json`：方法卡字段到代码证据路径的结构化映射；
- `reproduction-diagnosis.json`：复现失败日志到依赖清单、入口文件、证据行和下一步动作的结构化诊断；
- `reproduction-run-plan.json`：把诊断 issue、入口脚本和配置文件组合成 manual-only 的结构化复现运行计划；
- `reproduction-run-plan.md`：可读的手动复现运行计划，明确哪些命令会修改环境或执行仓库代码，默认不自动运行；
- `reproduction-task-package.json`：把方法卡、Paper-to-Code 映射、日志诊断、运行计划和实验矩阵行合并成可交接任务包，包含质量门、下一步动作、readiness audit、失败模式、验收标准和被阻塞实验行；
- `reproduction-task-package.md`：可读的 15 分钟复现任务包，默认 manual-only，用来告诉用户先修什么、证据在哪、哪些环节只是假设、哪些实验暂时不能运行。

阶段 4/5 已先完成数据层与 headless 闭环，UI 由后续代理接入：

- Runtime Center MVP：`docs/superpowers/plans/2026-07-01-runtime-center-mvp.md`，先实现本地 AI 运行时快照、IPC、renderer helper 和 hook，再由 UI 代理接入。
- Paper-to-Code Mapping MVP：`docs/superpowers/plans/2026-07-01-paper-to-code-mapping-mvp.md`，先实现只读代码仓库扫描、入口识别、项目链接和方法卡到代码证据映射，严禁自动执行用户仓库代码。

生成 Windows 安装包：

```bash
npm run dist
```

如果 Windows 上在 Vite renderer build 阶段出现 `node.exe : memory allocation ... failed`，可临时提高 Node heap 后重试：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist
```

安装包输出在 `dist/`，例如：

```text
dist/PDF Translation Reader Setup 0.1.17.exe
```

安装完成后会创建桌面快捷方式和开始菜单快捷方式。
如果需要确认安装包内的界面就是当前构建，可以先运行 `npm run dist`，再运行：

```powershell
$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check
```

## 主要模块

### 工作台首页

首页采用浅色高密度研发工作台，当前布局是“项目概览 + 研发流程看板 + Inspector”，不是入口卡片集合。主要区域包括：

- 左侧：当前本地项目、项目状态、论文 / 证据 / 双语 PDF 计数和最近论文；项目计数使用单个分段指标块，不再拆成四张装饰 KPI 卡；
- 中间：Workflow Board 以 2x2 流程列展示 Paper-to-Method、Paper-to-Code、实验矩阵和 Runtime Center，每列只保留一张可执行对象卡，并用低饱和状态线、轻量流程轨迹和 badge 表达阶段；
- 右侧：Current Focus、Next Actions 和 Decision Queue 统一放入一个连续 Inspector，三条下一步动作必须完整可见，避免三张右侧卡片继续堆叠或互相挤压；
- 底部/导航：实验矩阵、证据图谱、组会 PPT、论文库、研究表格、PDF 阅读、论文导师、AI 助手和设置等兼容入口。

### Paper-to-Method 方法卡

Paper-to-Method 是阶段 2 的核心研发对象，不是参赛材料生成器。当前已落地本地方法卡数据核心：

- 新增 `pdfTranslationReader:methodCards` 持久化键和 `MethodCard` / `EvidenceSource` / `MethodCardField` 数据结构；
- 可从 PDF 文本块、Figure / Table caption 和阅读笔记中抽取字段级证据；
- 方法卡字段覆盖 problem、input / output、model architecture、training objective、loss function、constraints、dataset / environment、baseline、metrics、claimed contribution、limitations 和 reproduction risk；
- 非空字段必须绑定 evidence source，没有证据时保持空值和 `unconfirmed`，避免生成不可追踪结论；
- 同一项目同一论文再次保存会提升 version，不静默覆盖已有方法卡；
- 新增 `useMethodCards` 本地 hook，可按当前项目读取 `pdfTranslationReader:methodCards`，避免跨项目方法卡串入实验矩阵；
- 方法卡可进一步派生实验矩阵行，把论文中的 baseline、proposed method、constraints、environment、metrics 和 evidence 转成可执行实验设计。

当前阶段已完成数据核心、项目级本地读取和实验矩阵桥接；尚未接入三栏方法卡审查 UI 或研究表格写回入口。

无需 UI 的演示闭环可通过 `npm run demo:research-loop` 运行。该命令会反复生成同一套方法卡、实验矩阵、Markdown 和 localStorage seed，用于评审演示、其他代理接 UI 和后续回归。

### 实验矩阵

实验矩阵不是把现有研究表格改名，也不是覆盖 Univer 自由表格。它是独立的结构化实验设计视图，用来把方法卡中的证据字段转换成可执行实验行。

当前已落地本地实验矩阵数据核心和独立页面：

- 新增 `src/renderer/lib/experimentMatrix.ts`，从 `MethodCard` 派生 baseline / proposed / ablation 三类实验行；
- 实验矩阵列覆盖 paper、group、hypothesis、baseline、proposed method、ablation、controlled variables、seeds、metrics、expected result、status 和 evidence；
- `buildExperimentMatrixWorkbookFromMethodCards` 会生成独立 workbook，sheet 名为 `实验矩阵`，不会修改已有研究表格数据；
- 只从已绑定 evidence 的方法卡字段生成实验行，避免凭空发明实验；
- 当前默认状态为 `planned`，独立页面可把行状态切换为 planned / running / blocked / done；
- 新增 `pdfTranslationReader:experimentMatrices` 持久化键，按 projectId 保存用户确认和编辑后的实验矩阵；
- 提供安全合并逻辑，重新从方法卡生成时不会静默覆盖用户已编辑行；
- 侧栏“实验矩阵”进入独立结构化页面，包含方法卡桥接摘要、项目摘要、实验组 / 状态 / 关键词筛选、高密度表格、右侧实验详情和证据定位；
- 页面可从当前项目方法卡合并 baseline / proposed / ablation 实验行，只使用带 evidence locator 的字段，并保留已有手动编辑；
- 1366px / 1440px 桌面宽度下，实验矩阵主表优先展示实验组、论文、假设、方法和指标；状态切换与证据定位交给右侧详情面板承载，避免底部横向滚动条破坏扫描体验；
- 页面支持复制 Markdown；`ResearchWorkbook` workbook 导出核心已存在，Excel 文件导出入口后续再接；
- 页面主操作使用深石墨色，实验组和状态 badge 使用低饱和灰蓝、雾灰蓝和灰绿，避免亮蓝/亮绿/亮黄塑料感，也避免棕色旧纸感；
- 侧栏“研究表格”保留 Univer 自由表格，不再和实验矩阵混用。

研究表格继续作为自由整理和人工编辑区域；实验矩阵作为结构化的“实验设计层”，二者后续可以互相跳转，但不能互相替代。

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
- 查询模式支持“严格 / 均衡 / 探索”：严格模式尽量保留原始短语，均衡模式执行本地英文规范化和适度扩展，探索模式加入更宽的同义表达；查询模式进入缓存键，互不串用结果；
- 中文关键词会在本地规范化为英文检索词，例如“强化学习”“机器人导航”“无人机避障”“医学影像”“信息检索”“数据库”“网络安全”“计算机图形学”会转换为对应英文检索词，避免 arXiv API 直接按中文词过滤导致结果过少；状态条会同时显示原始查询和实际提交给 arXiv 的英文查询；
- 检索同时匹配 title 和 abstract；年份范围会写入 arXiv submittedDate 查询条件；
- 每页数量支持 20 / 50 / 100 / 200，并显示 arXiv 返回的总结果数与当前结果范围；
- 桌面端采用左侧全局导航、顶部紧凑搜索筛选、中间论文卡片和右侧论文详情的科研检索布局；
- 论文结果支持单列 / 双列 / 三列切换，默认三列，选择会通过 `pdfTranslationReader:arxivResultColumnMode` 写入 localStorage，刷新后保留；
- 右侧论文详情支持折叠为窄 rail，折叠后搜索区和结果区会扩展到 rail 前，避免出现空白详情列；
- 结果卡片使用 CSS `content-visibility` 做滚动性能隔离，并带有克制的进入 stagger、hover 层级和搜索状态扫描条；`prefers-reduced-motion` 下会降级为静态；
- 点击搜索、上一页或下一页时才会请求 arXiv，输入关键词不会自动触发请求；
- 按年份、标签、收藏、备选、已翻译、已评分筛选当前结果页；
- 显示标题、中文标题、作者、发布日期、更新时间、分类、英文摘要、中文摘要、arXiv 链接和 PDF 链接；摘要中的 `$...$` / `$$...$$` 会走公式渲染；
- 使用本地启发式评分生成相关性、新颖性、实验线索、阅读优先级和研究标签；“本页相关排序”只重排 arXiv 已返回的当前页，不冒充全局相关性排序，评分始终绑定最后一次成功执行的查询和查询模式；
- 搜索完成后只自动预翻译当前页前 6 篇中的缺失项；“翻译本页”会显式提交当前页剩余论文，单篇手动翻译优先于预览和整页后台任务；翻译结果只允许写回发起它的当前搜索会话；
- 标题和摘要翻译优先使用本地 NLLB + CTranslate2，失败后回退 Argos Translate + SQLite 缓存，不消耗 AI API token；IPC 批次最多接收 100 个有效论文对象，并过滤非法项目；
- 离线翻译使用批量队列和持久 Python worker：首次翻译需要加载模型，后续同一运行期间会复用 worker，批量标题 / 摘要翻译会明显更快；NLLB 可用时界面会显示 CUDA / CPU 回退等运行状态；
- 翻译前会保护公式、LaTeX、双反引号代码、DOI、URL、新旧 arXiv ID、引用和学术术语占位符；翻译后按分段数量与顺序恢复占位符，并拒绝严重截断、占位符错位、重复尾巴、英文回声和常见乱码结果进入缓存；旧缓存中如果出现 `���`、`æœºå™¨`、`鏈哄櫒` 等编码损坏文本，界面会退回英文并允许重新翻译；
- 如果未安装 Argos Translate 或未安装 en -> zh 模型，界面会保留英文标题/摘要并提示本地翻译不可用；AI 翻译仍只在 AI 助手或明确 AI 操作中使用；
- 结果卡片只保留“阅读 / 翻译 / 加入阅读队列”三个主操作；评分、收藏、BibTeX、Markdown 导出和 PPT 候选操作集中在右侧论文详情，减少大结果页按钮噪声；
- 可收藏论文，或在右侧详情中加入组会 PPT 候选队列；PPT 生成仍只读取用户已下载或手动选择的本地 PDF；
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
- 右侧展示当前窗口论文对应的图表证据、caption 和 PDF 文本片段；如果图片提取已完成，图表缩略图可点击放大，如果图片仍在提取或不可用，会先展示 caption 级证据；
- AI 会像组会老师一样追问论文方法输入、输出、模型变换、损失或训练目标、实验指标和多论文差异；
- 用户回答不出来时，AI 会先给出解答，再继续拆成更小的问题。

AI 问答复用同一套 AI Provider / API Key 设置，但页面和状态与 AI 助手分离。PDF 阅读页点击“提取文献图片”后，会先把 Figure / Table caption 候选写入论文导师证据；图片提取完成后再用带缩略图的版本补全。

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

研究表格基于 Univer，作为独立模块存在，不和论文库混在一起，也不会被实验矩阵替换。它保留自由编辑、临时整理和人工分析空间；实验矩阵是另一层结构化设计视图。研究表格支持：

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

论文库已升级为面向大规模本地论文管理的高密度工作台，默认采用“标签 / 项目 / 智能视图 → 搜索与稳定排序 → 右侧 Inspector → 继续阅读 → 批量整理”的闭环：

- 左侧按标签、研究项目和“最近阅读 / 待整理 / 重点论文 / 已完成”智能视图筛选，并显示实时数量；多标签筛选采用 AND 语义。
- 顶部支持标题、作者、期刊、年份、标签、笔记和研究表格单元格的组合搜索；默认按“最近活动”降序，并可切换标题、发表年份、导入时间、最近阅读和阅读进度排序。
- 中间高密度列表稳定显示标题、作者、来源、年份、标签与阅读进度；置顶论文始终优先，同值排序保持原顺序，缺失值始终放在末尾。
- 右侧 Inspector 提供阅读进度、继续阅读、标签、项目归属、本地资产、笔记、关联关系和元数据编辑；PDF 路径失效时禁用阅读按钮并给出重新定位 / 导入入口。
- 标签管理使用应用内对话框，重命名会显示受影响论文数；删除标签需要二次确认。批量栏支持添加 / 移除标签、加入 / 移出项目、置顶、标记完成和移除记录。
- 从论文库移除记录只删除本地索引，不会删除 PDF、翻译文件、AI 缓存或双语 PDF。
- `PaperRecord` 会兼容迁移旧记录并保留标签、置顶、导入 / 更新时间、总页数和完成状态；损坏的本地存储在用户明确修改前不会被空数据静默覆盖。

视图偏好保存在 `pdfTranslationReader:paperLibraryView`，包括排序字段、排序方向、紧凑 / 舒适密度和 Inspector 折叠状态；搜索词、临时筛选和勾选状态不会持久化。复杂的创新点、局限点、方法和实验计划仍放到研究表格、方法卡和实验矩阵中继续整理。

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

当前视觉检查会覆盖首页、论文库、实验矩阵、研究表格、PDF 阅读、组会 PPT、AI 问答、AI 助手、arXiv 检索和设置页。论文库会检查 1366 / 1440 / 1920 宽度、排序、列表可见行、右侧继续阅读、批量栏、标签管理对话框、无结果、PDF 路径失效和 Inspector 折叠状态；实验矩阵会检查独立页面、侧栏高亮、方法卡桥接摘要、摘要、筛选、表格、右侧详情、证据面板、Markdown 操作、横向溢出，以及主按钮 / badge 是否回到高饱和蓝绿黄；arXiv 检索会检查 1366 / 1440 / 1920 宽度、三列 / 双列 / 单列布局、真实查询元数据、长查询省略、查询模式、本页排序、翻译入口、搜索期间禁用态、高级筛选默认折叠与展开无遮挡、卡片三主操作、右侧详情 PPT / 导出、分页和横向溢出；AI 问答会检查独立页面、会话窗口入口和 ChatGPT 式布局。失败时会保留对应截图，便于继续定位布局或渲染问题。

首页视觉检查额外执行对抗式审查：检查 Workflow Board / 单一 Inspector 是否存在、横向/纵向溢出、内部滚动条、流程对象卡裁切、流程卡标题/说明/动作重叠、状态 badge 是否回到高饱和亮蓝/亮绿/亮黄、侧栏选中态是否回到高饱和紫蓝、最近论文文字重叠、下一步动作按钮遮挡、下一步动作裁切、风险行裁切、紫色品牌色回潮，以及指标/行动/风险是否重新变成卡片式堆叠。

默认视觉检查聚焦 UI 回归和证据面板布局：PDF 图表场景允许 caption-only 或页面裁剪结果通过，避免把耗时的 native PDF 图像提取绑定到每次 UI 检查。需要专项验证 native 图像提取时运行：

```powershell
$env:VISUAL_CHECK_REQUIRE_NATIVE_FIGURES='1'; npm run visual:check
```

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
- arXiv 右侧详情折叠后是否变成窄 rail、结果区是否随之扩展，避免折叠后留下大块空白；
- 全局动效基线是否进入构建产物，包括 220ms-280ms 视图切换、面板 stagger、状态 sheen、知识图谱节点 scale-in / halo、边线平滑过渡和 `prefers-reduced-motion` 降级；
- arXiv 备选论文库是否被结果卡片遮挡，以及是否使用会盖住卡片的原生长 `title` tooltip；
- 研究表格顶部工具区高度、命令栏溢出和表格主体可用高度；
- 实验矩阵表格横向滚动是否被限制在表格 viewport，1366px 下主表是否能自然扫描，右侧详情是否和证据面板重叠，主按钮和状态 badge 是否出现高饱和塑料感；
- 设置页默认“通用设置”是否真的显示表单控件。

## 架构边界

当前代码已经开始从早期的单文件集中状态拆分为可组合的领域模块：

- `src/renderer/hooks/`：承载 PDF 会话、论文库、研究表格、AI 设置、AI 翻译、双语 PDF 生成、状态队列、阅读器侧栏和视图切换等状态逻辑；
- `src/renderer/contexts/`：提供 PDF 会话、论文库、AI 翻译和 UI 状态的 Context 边界，减少跨页面 prop drilling；
- `src/main/ipc/handlers/`：按 AI、arXiv、PDF、文件导出和项目加载拆分 IPC handler 注册入口；
- `src/main/runtimeCenter.ts`：生成本地 AI runtime 快照、能力状态、任务队列和可复制 next actions，不暴露 API key、完整 prompt 或缓存内容；
- `src/main/codeRepositoryScanner.ts`：只读扫描本地代码仓库，识别 manifest、入口脚本、配置文件和风险，不自动执行用户仓库代码；
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
      HomePage.tsx          工作台首页与论文库页面路由
      PaperLibraryPage.tsx  高密度论文库、标签/项目筛选、批量操作和 Inspector
      ExperimentMatrixPage.tsx 独立实验矩阵页面
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
      useExperimentMatrix.ts 实验矩阵项目级持久化和行状态更新
      useMethodCards.ts    方法卡本地持久化读取和项目过滤
      useRuntimeCenter.ts  Runtime Center 快照读取、环境检测和刷新状态
      useCodeRepositories.ts 代码仓库扫描结果的项目级本地持久化
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
      methodCards.ts         Paper-to-Method 方法卡、证据抽取和本地序列化
      experimentMatrix.ts    从方法卡派生 baseline / proposed / ablation 实验矩阵
      experimentMatrixBridge.ts 方法卡到当前项目实验矩阵的桥接摘要和候选行生成
      runtimeCenter.ts      Runtime Center renderer 类型、摘要和高风险能力过滤
      codeRepositories.ts   代码仓库记录序列化和技术栈摘要
      paperToCodeMapping.ts 方法卡字段到代码证据路径的确定性映射
      researchLoopDemo.ts    无 UI 的论文证据到实验矩阵 demo 闭环
      experimentMatrixView.ts 实验矩阵筛选、摘要和选中行视图逻辑
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

## 2026-07-01 UI 收口说明

本轮继续把旧页面向统一的本地科研工作台视觉语言收拢，重点不是再增加入口卡片，而是压低遗留的高饱和蓝、绿、黄、紫色块，统一按钮、badge、面板、滚动条和空状态。

已覆盖页面包括设置、AI 助手、论文导师问答、组会 PPT、知识图谱和 arXiv 检索。arXiv 检索结果态的备选论文库现在只保留摘要条，不再展开成列表压住论文卡片；空结果状态保留候选论文快捷定位，但去掉紫色渐变和光晕。

为避免界面从“塑料蓝绿黄”退到“全灰黑单调”，全局样式使用低饱和研究色相：蓝灰、鼠尾草绿、雾灰蓝、石板灰和灰紫只用于页面方向、状态线、badge、图谱节点和 active 状态。设置页内部导航、知识图谱节点和 arXiv / 实验矩阵状态色都已纳入 `visual:check` 的高饱和与灰度坍缩断言，默认强调色不再使用棕色旧纸感。

验证方式：

```powershell
npm run build
npm run visual:check
npm run dist
$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check
```

关键截图输出在 `.tmp-visual-check/`，建议优先查看 `home.png`、`experiment-matrix.png`、`knowledge-graph.png`、`arxiv-search-results.png`、`settings-page.png`、`paper-tutor-page.png` 和 `presentation-page.png`。

## 2026-07-08 动效与可视化预览

本轮在不引入 GSAP 的前提下加入更明显但克制的科研工作台微动效：

- 主视图切换使用约 260ms 的 fade + translate + 轻 scale；
- 首页、实验矩阵、知识图谱、arXiv、设置、论文导师、组会 PPT 等主要页面的面板进入使用轻量 stagger；
- 按钮、导航、流程卡、表格选中行和详情面板 hover / focus 增加 1px 位移、低饱和边框和轻阴影；
- Ready / Planned / Draftable 等状态 badge 只在 hover 或视图切换时出现一次性 sheen，不做持续闪烁；
- 知识图谱节点进入时 scale-in，选中节点使用低饱和呼吸 halo，边线 hover / active 平滑变深；
- `prefers-reduced-motion: reduce` 下动效降级为近静态。

本地可视化预览：

```powershell
# 真实应用热更新预览
npm run dev
# 打开 http://127.0.0.1:5173/

# 动效前后对比稿
python -m http.server 8765 --bind 127.0.0.1 --directory .superpowers/brainstorm/ui-motion-comparison
# 打开 http://127.0.0.1:8765/
```
## 科研绘图工作台（0.1.17）

侧栏“科研绘图”现已接入独立工作台，面向实验数据、论文图表和可复现实验结果整理：

- 数据来源：CSV、TSV、XLSX、多工作表选择、剪贴板表格、当前研究表格及最后选区；文件导入可自动判断、指定表头行或明确选择“无表头”，无表头时不会丢失第一行数据。
- 图形：折线、散点、柱状、面积、分布、热图、相关矩阵、3D、Sankey/Alluvial、生存、森林、火山和雷达等受控图形；不会让未选择的语言代画。
- 统计：描述统计、置信区间、回归、参数/非参数检验和多重比较校正；检验设计无效时明确报错，不生成伪显著性标记。
- 渲染器：JavaScript/ECharts 内置即时预览；Python、R 会自动扫描 `PATH`、Windows 注册表和常见安装目录，优先使用依赖完整的系统环境；只有完全缺失时才提供私有环境安装。MATLAB 只检测已有授权安装，不由 FTranslate 安装。
- 导出：ECharts 直接生成 PNG/SVG；外部语言导出自身生成的图片和脚本；`.fplot` 可复现包默认不包含原始数据，可由用户显式选择。
- UI：环境配置、数据导入、转换、脚本和导出均为按需弹窗，不常驻挤占画布；左侧数据、中间画布、右侧 Inspector 在 1366px 桌面宽度下保持可扫描。
- 坐标轴与样式：X/Y 字段可随时重选；支持自动/线性/对数/分类/时间尺度、最小/最大值、正反向、上下左右位置、主次刻度、标签旋转与数字格式、前后缀、字号、轴线及主次网格。数值轴默认按数据范围缩放，不再强制从零开始。

安装程序会提供 Python、R 和 MATLAB 检测意图选项，但不会静默修改系统 `PATH`。首次进入科研绘图时会打开环境管理弹窗；如果系统 Python/R 仅缺绘图库，界面显示“修复现有环境”，不会误导用户重复下载运行时；只有未检测到语言时才显示“安装私有环境”。R 修复按当前受控脚本实际使用的 6 个包逐个安装并显示进度，重复点击会复用同一任务，不再停在一个虚假的 20%。下载任务可取消，官方安装器会校验固定 SHA-256。

绘图语言在工作区顶部“绘图语言”下拉框选择，四种语言始终显示，并直接标注“内置 / 已检测 / 缺依赖 / 未安装”。检测到 MATLAB 后，可在这里选择 `MATLAB（已检测）`，随后点击“渲染预览”；预览与导出均由 MATLAB 本身生成。

必要验证：

```powershell
npm run typecheck
npm run build:renderer
$env:VISUAL_CHECK_SCENARIO='scientific-plot'; npm run visual:check
$env:VISUAL_CHECK_PACKAGED='1'; $env:VISUAL_CHECK_SCENARIO='scientific-plot'; npm run visual:check
```

全页面视觉回归仍使用 `npm run visual:check`；科研绘图专项模式用于只保留与该页面有关的必要验证。

绘图页面视觉截图输出到：

```text
.tmp-visual-check/scientific-plot-page.png
.tmp-visual-check/scientific-plot-axis-editor.png
```

当前 Windows 安装包：

```text
dist/PDF Translation Reader Setup 0.1.17.exe
SHA256 16C9A33F31C07DFB17253D2085323DBC4D07FF21149CCFC0F2CC1759F732D6BA
```

## 聚焦型 Research OS 界面

首页、全局侧栏、PDF 阅读器、AI 助手与科研绘图工作台现在共享浅色优先的 Research OS 视觉语言。侧栏按科研流程分组，“科研绘图”位于“实验与运行”；关键主操作使用深石墨到蓝紫渐变，焦点检查器使用局部玻璃材质与柔和发光。

AI 持续动效仅在真实生成期间运行，并支持 `prefers-reduced-motion: reduce`。视觉回归截图位于 `.tmp-visual-check/home.png`、`.tmp-visual-check/scientific-plot-page.png`、`.tmp-visual-check/whole-pdf-reader.png` 和 `.tmp-visual-check/ai-assistant.png`。
