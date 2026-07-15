# PDF Translation Reader / FTranslate

## 2026-07-15 arXiv 1 秒级渐进翻译（0.1.28）

- 单篇翻译改为“立即反馈 → 中文标题 → 完整摘要”渐进链路。按钮点击后同步进入“翻译中”，卡片持续显示当前阶段与耗时；暖机后的真实 arXiv 样本中，中文标题约 0.52 秒出现，完整摘要约 1.52 秒完成。
- 搜索结果不再自动启动隐藏的摘要预翻译。只有用户点击单篇翻译或“翻译本页”才提交任务，避免不可抢占的后台推理占住本地 worker，造成手动点击看似无反应。
- 已生成的快速标题会直接复用于完整质量链路，摘要不再重复翻译标题；同一批次仍一次送入 NLLB，不按句逐次启动模型。
- 长摘要分段上限从 900 收紧为 480 字符，避免 NLLB 解码预算耗尽后截断尾段；公式、代码和引用继续严格校验，方法名由源文本术语层修复，被模型省略的 URL / DOI / arXiv 标识会确定性补回。
- 增加 RL / 机器人领域源文本约束，修复 `policy`、`actor`、`critic`、`agent`、retargeting、sample efficiency、Sim-to-Real、system identification 等常见误译，不增加第二次模型调用或 AI token。
- 首次启动本地 NLLB 仍需要加载模型；1 秒级指标指模型就绪后的连续使用。首次加载阶段会明确显示“首次加载本地翻译模型”，不会伪装成已完成。
- 完整构建为 99 个测试文件、646 项测试通过；源码与安装包内 arXiv 视觉门禁均通过，覆盖“无隐藏自动翻译 → 手动点击 → 同步 busy → 卡片阶段反馈 → 中文标题/摘要完成”和 1366/1440/1920px 布局。截图见 `.tmp-visual-check/arxiv-translation-progress.png`、`.tmp-visual-check/arxiv-search-results.png` 与 `.tmp-visual-check/arxiv-search-results-1366.png`。
- Windows 安装包为 `dist/PDF Translation Reader Setup 0.1.28.exe`，157,085,637 bytes，SHA-256 `2BC1B64F91960BD8EDE9F1A42F36B86DA0AFE7DD9772DDC958920872C00A273D`。

## 2026-07-15 arXiv 聚焦检索与论文库空状态（0.1.27）

- arXiv 首屏聚焦“关键词 → 搜索 → 阅读摘要 → 保存 PDF”主路径。默认只保留分类、排序和“更多筛选”，查询模式、年份、顺序、每页数量、历史关键词与本地筛选进入按需区域；布局从三个并列按钮收敛为一个下拉框。
- 检索与翻译诊断默认收进“运行状态”，仍可展开查看缓存、规范化查询、队列和质量门禁。取消无实际操作的 API 状态装饰、重复页容量和空计数徽标，减少首屏噪声但不删除能力。
- 自动摘要预翻译只处理结果前 3 篇，并在浏览器空闲或 900 ms 超时后启动；新搜索、手动翻译单篇或翻译本页都会取消尚未开始的后台任务，避免后台预览抢占用户操作。翻译仍使用本地 NLLB / Argos，不改成“机翻后 AI 润色”。
- 论文库为空时同时提供“新建研究项目”和“导入第一篇论文”。空项目不要求先关联论文，后续仍可批量归档；视觉回归会真实清空隔离测试库、打开创建弹窗、截图并恢复数据。
- 定向验证已覆盖 33 项 arXiv/论文库测试、TypeScript、arXiv 收起/展开筛选和论文库 1366/1440/1920px、空库、项目创建、无结果与路径失效状态。完整构建为 99 个测试文件、636 项测试通过；源码与安装包内完整视觉场景均通过，包含 PDF 首屏 3 秒门禁和图表提取。Windows 安装包为 `dist/PDF Translation Reader Setup 0.1.27.exe`，157,076,042 bytes，SHA-256 `FE106BCA7D2700D8F0E9CCF2464DA92713E15E090858BC0E4C6F5F0F3D34B7F2`。

## 2026-07-14 导航与 PDF 命令层级收敛（0.1.26）

- 桌面侧栏不再把 12 个模块分成 6 组全部常驻。项目空间、arXiv、论文库、PDF 阅读、实验矩阵、研究表格和科研绘图构成默认研究主路径；证据图谱、组会 PPT、论文导师和 AI 助手收进“更多工具”，设置仍保持独立可见。进入任一折叠模块后会自动展开对应区域，不删除功能或路由。
- PDF 阅读右栏默认只显示三种视图、生成双语 PDF 和提取图表。重新生成、导入/导出双语 PDF、生成组会 PPT、检查引擎、安装提示与参考文献策略移入“更多 PDF 操作”，把常驻可见按钮从 10 个降到 5 个。
- 视觉回归增加功能层级断言：默认侧栏必须是 8 个可见入口与 4 个折叠入口；PDF 高级操作必须真实隐藏而不是只改变 `open` 属性。异常退出时测试会主动关闭调试连接并终止 Electron 进程树，避免残留进程锁住下一次检查。
- 真实 25 页论文 `2604.15483v2.pdf` 的首屏为 1,621 ms；PDF 右栏在 280px、505px 和完全收起三种宽度下均无按钮/面板横向溢出，图表提取后仍检测到真实 PDF canvas 像素。截图见 `.tmp-visual-check/home.png`、`paper-library-1366.png`、`whole-pdf-reader.png` 和 `whole-pdf-narrow-sidebar.png`。
- 源码与安装包内完整视觉场景均通过。Windows 安装包为 `dist/PDF Translation Reader Setup 0.1.26.exe`，157,075,583 bytes，SHA-256 `7019A5EE4D4F08A18A9F4E674AFA5BF7F1BB99451C93C5A3DACC45E3BED468C4`。

## 2026-07-14 PDF 首屏 3 秒性能门禁（0.1.25）

- 将首屏指标拆离整套视觉场景：计时从点击论文库“继续阅读”开始，到首个真实 canvas/SVG/image 可见为止，不把后续划词、词典和截图耗时算进首屏。
- 0.1.24 安装版在全新应用用户目录中的实测基线已经达到目标：`Tactile-WAM 2026.6.25.pdf`（15,047,010 bytes、12 页）为 636 ms；`2604.15483v2.pdf`（15,587,236 bytes、25 页）为 1,687 ms。因此本版不冒险改写已满足目标的 PDF.js 主链路，而是把 3,000 ms 固化为自动回归预算。
- `pdf-selection` 专项场景和默认完整 PDF 场景都会输出 `firstRenderMs`；超过预算立即失败。可通过 `VISUAL_CHECK_PDF_FIRST_RENDER_BUDGET_MS` 调整测试预算，默认值为 3000。
- 0.1.25 安装包内重新验证为 599 ms 和 1,651 ms。安装包为 `dist/PDF Translation Reader Setup 0.1.25.exe`，157,074,002 bytes，SHA-256 `EC2AA306B9872E69DDEFDADFC22F91922B6DC24BECAB96A4458D8DBF2F760AE1`。

## 2026-07-14 PDF 首屏永久等待修复（0.1.24）

- 修复真实 PDF 偶发等待一分钟仍没有首屏的问题。根因不是文件过大，而是 PDF.js 会先创建页面并写入 `data-loaded=true`，此时 `canvasWrapper` 仍可能为空；旧逻辑误把这个占位标记当成已渲染，提前停止了 `update + forceRendering` 恢复。
- 首屏恢复现在只接受有正尺寸的 canvas、SVG 或图像作为渲染面证据；页面占位和 `data-loaded` 只保留用于诊断，不能再结束恢复。新增回归测试覆盖“1 个 loaded page、0 个真实渲染面”必须保持未完成，以及真实 canvas 才能完成。
- 使用用户实际的 `Tactile-WAM 2026.6.25.pdf`（15,047,010 bytes、12 页）验证：源码场景约 10.4 秒完成“启动、打开、首屏、适宽居中与选词”；0.1.24 安装包连续两次全新用户目录冷启动分别约 10.4 秒和 10.1 秒完成同一场景。
- 人工复查 `.tmp-visual-check/pdf-word-dictionary.png`：PDF 内容真实可见、左右边界完整、侧栏和单词卡无遮挡。Windows 安装包为 `dist/PDF Translation Reader Setup 0.1.24.exe`，157,074,187 bytes，SHA-256 `7ED607AAC3ED605E1169D123D5B0DE73C256F12F2605F42E64899B57A78AE563`。

## 2026-07-14 图表提取加载反馈与空白防回归（0.1.23）

- 修复“点击提取图表后像是整页空白”的体验问题。根因是 caption 尚未解析完成时就打开了空的三栏工作台，虽然 PDF 数据仍在，但大面积无内容区域会被误认为页面被清空或程序卡死。
- 候选生成前现在显示独立的论文结构扫描界面，明确展示“解析文字与版面 → 识别图表边界 → 生成高清素材”三阶段、非确定进度和可取消入口；识别到候选后才切换到筛选、素材卡片和右侧检查器。
- 扫描完成但没有候选时会显示可能原因和“重新扫描”，不再留下空白工作区。关闭图表工作台后，回归脚本会抽样检查真实 PDF canvas 像素，防止只凭节点存在误判恢复成功。
- 新增 `figure-assets-early` 专项视觉场景，可在 PDF 首屏刚出现时立即提取。已用 `VT-WAM 2026.7.2.pdf` 验证：首屏加载反馈完整、7 个候选全部生成图像、关闭后原文仍正常显示。

Windows 安装包为 `dist/PDF Translation Reader Setup 0.1.23.exe`。安装版同样通过 `VT-WAM` 立即提取专项检查，截图位于 `.tmp-visual-check/whole-pdf-figures-early-frame.png` 和 `.tmp-visual-check/whole-pdf-after-early-figure-extraction.png`。

## 2026-07-14 论文库项目创建与 PDF 首屏自恢复（0.1.22）

- 论文库现在把“新建项目”和“导入论文”作为两个独立动作。用户可在顶部工具栏或左侧“项目文件夹”直接新建研究项目，填写项目名称与可选研究目标，并选择把当前论文或批量选中的论文立即加入项目。
- 新建项目会写入现有 `pdfTranslationReader:researchProjects` 本地项目模型，重名会给出明确提示，项目 ID 在同一毫秒内连续创建时也不会冲突。空论文库仍可先创建项目，不再被“必须先导入 PDF”卡住。
- PDF.js 首屏渲染新增有界恢复：当页面容器已建立但首个 canvas/text layer 尚未出现时，阅读器会重新触发可见页更新与渲染；容器尺寸变化也会刷新渲染队列，成功后由真实 `pagerendered` 事件结束恢复，避免界面长期停在空白页。
- 视觉回归脚本只统计真实 `.pdf-js-viewer-container`，不再把外层嵌套容器重复算成多个阅读器；新增论文库创建项目的打开、校验、持久化、论文关联和多桌面宽度检查。

安装版已验证论文库创建项目、真实 25 页 PDF 首屏适宽居中、选区浮层跟随滚动与双击单词词典卡。截图位于 `.tmp-visual-check/paper-library-create-project-dialog.png`、`.tmp-visual-check/paper-library-project-created.png`、`.tmp-visual-check/pdf-selection-translation.png` 和 `.tmp-visual-check/pdf-word-dictionary.png`。Windows 安装包为 `dist/PDF Translation Reader Setup 0.1.22.exe`。

## 2026-07-14 图表工作台与 PDF 划词稳定性修复（0.1.21）

- 修复图表提取结束后“PDF 图表素材”工作台只露出顶部几像素、主体变成整块空白的问题。根因是三行 CSS Grid 在空闲时条件删除了第二行进度条，导致主体被自动放进固定 3px 的进度行；现在进度轨道始终保留，空闲时仅隐藏填充，筛选、素材卡片和右侧检查器保持完整可见。
- 图表专项视觉门禁不再只检查 DOM 中是否存在卡片，而是同时检查工作台主体、首张卡片和右侧预览的真实可见高度；并在取消提取进入空闲态后再次检查，避免“元素存在但被压成 3px”继续误判为通过。
- PDF 划词翻译改为完成选择后再出现：鼠标或触控按下并拖选期间不创建卡片，释放且选区稳定后只捕获一次；键盘 `Shift` 扩选使用短防抖。翻译请求继续在最终选区上自动启动，不需要额外点击。
- 双击 PDF 文字层中的英文单词会保留 Chromium 的原生整词选区，并立即进入单词卡；第二次 `pointerup` 的延迟任务会被双击捕获替换，避免同一个词重复弹卡或闪烁。

图表工作台空闲态截图位于 `.tmp-visual-check/whole-pdf-figures-idle.png`。Windows 安装包输出为 `dist/PDF Translation Reader Setup 0.1.21.exe`。

## 2026-07-13 PDF 图表高质量提取与素材工作台（0.1.20）

- 图表提取改为“完整页面渲染优先”：坐标轴、曲线、矢量文字和栅格面板会按 PDF 最终视觉一起输出，不再优先拿单张内嵌位图而丢失标注。自动裁剪使用安全非对称留白，避免把紧邻的图注重新截入，也避免切掉图内底部标签。
- caption 识别支持 `Fig.` / `Figure`、补充图、子图编号、罗马数字表格和多行图注；会过滤正文中的 “Fig. 7 for ...” 一类引用，并对同编号重复 caption 去重。双栏页面会保留候选所在栏，不再把窄图错误扩成整页正文。
- 机器人平台、实验场景等照片型多面板图会把 PDF 内嵌图像仅作为几何定位线索，再从完整页面高分辨率渲染中裁剪，因此既能收紧正文，又能保留面板标题、箭头和标注。复杂排版仍可在右侧打开整页预览，拖动或缩放选区后以 3.5 倍渲染精裁。
- “PDF 图表素材”改为独立工作台：支持全部候选、搜索、图像/表格/可用/待调整筛选、批量选择、继续提取、取消、定位原页、单图精裁、批量导出 PNG 与无 base64 的元数据清单，以及把所选真实图片直接送入组会 PPT。
- 性能方面按页分组处理：同一页只渲染一次并逐张返回结果，处理完立即释放 canvas；PDF 正文结构解析在阅读、图表与 PPT 之间共享同一进行中任务，避免重复扫描全文。自动批次最多处理 24 张，剩余候选可继续提取，不再永久只显示前 8 张。

真实 25 页论文的视觉检查输出位于 `.tmp-visual-check/whole-pdf-figures.png`、`.tmp-visual-check/whole-pdf-figure-crop-editor.png` 和 `.tmp-visual-check/pdf-figure-extracted-1.png` 至 `-3.png`。安装包：`dist/PDF Translation Reader Setup 0.1.20.exe`。

## 2026-07-13 PDF 阅读、arXiv 检索与论文库性能优化（0.1.19）

- PDF 打开链路不再用逐字符回调构造 `Uint8Array`。同一份 15.6 MB / 25 页样本中，renderer 的 base64 解码由约 1091 ms 降到约 24 ms；论文库改为先显示原文首屏，再后台顺序载入大 PDF 资源，避免同时读取多份大文件造成内存峰值。
- 首个真实 PDF 页面渲染完成前不再提前显示“已完成”；空搜索不会触发 PDF.js 全文扫描，目录抽取延后到首屏完成后的浏览器空闲阶段，并在图表/PPT提取之间复用同一解析任务。翻译侧 PDF 不再重复建立无用目录。
- 选中文字后立即调用本地 NLLB / Argos，不再要求二次点击“翻译”。卡片跟随选区滚动定位，点击外部、选区消失、翻页或缩放后自动关闭；关闭按钮仅作为显式备用操作。
- 单个英文词会进入词典卡：本地中文译文自动生成；首次点击启用在线增强前会明确说明只发送当前单词，启用后显示音标、词性、英文释义、例句、近义词和反义词，也可随时停用。联网词典不可用时仍保留本地翻译和明确的降级提示。
- arXiv“最新论文”会真实绕过旧缓存；分页固定沿用上一次已执行的查询条件，避免把尚未提交的新筛选项混入第二页。检索结果继续显示期间可以后台刷新，下载成功后直接加入论文库并打开阅读。
- arXiv 元数据预翻译从大批次缩小为 4 篇、单并发低优先级任务；新检索会取消尚未开始的旧会话预览任务，前台翻译仍保持最高优先级。
- 论文库继续保留排序、标签、项目和阅读进度视图，并让界面提示的 `Ctrl/Cmd+K` 快捷搜索真正生效。

已验证安装包：`dist/PDF Translation Reader Setup 0.1.19.exe`。源码与安装版均通过 PDF 选词、arXiv 三列/备选浮层和论文库多桌面宽度视觉检查。

使用选词翻译：打开“PDF 阅读”后直接拖选文字；卡片会自动开始本地翻译。只选择一个英文单词时会进入词典模式，在线词典详情需要首次明确启用。扫描版 PDF 没有文字层时仍需要先 OCR。

## 2026-07-13 科研绘图、arXiv 翻译与 PDF 选词翻译（0.1.18）

- 科研绘图新增可选字体、标题对齐/颜色/字重、折线样式、标记、透明度、画布边距、图例位置/排列/自定义坐标/字号/间距/符号尺寸/边框与背景，以及坐标轴线、刻度、标题和标签颜色。所有公共参数统一写入 PlotSpec，并映射到 ECharts、Python、R 与 MATLAB。
- Python、R、MATLAB 真实渲染统一读取 UTF-8 BOM 数据并优先选择可显示中文的已安装字体；R 修复坐标范围字段的部分匹配问题，MATLAB 修复百分比刻度和轴标题被裁切的问题。
- arXiv 搜索后的前 6 篇后台预翻译改为可抢占的单篇任务。卡片在后台翻译时仍可点击“优先翻译”，前台请求会获得更高优先级；空 IPC 结果会显示明确错误，不再静默无响应。
- PDF 阅读器现在可以直接在 PDF.js 文字层选中单词、短语或段落。选区旁会出现“选中翻译”卡片，自动判断英→中/中→英，使用现有本地 NLLB/Argos，支持重新翻译、复制译文和关闭；无需先生成整篇双语 PDF。
- PDF 阅读器首次打开论文时自动按可用宽度显示并水平居中，页面左右边界完整可见；用户之后仍可继续缩放、滚动和恢复阅读位置。
- AI 全文翻译保留每一段完整原文和术语上下文，不采用“机翻后选择性润色”。为降低重复消耗，系统会按翻译引擎、模型和原文哈希复用完全一致的已成功译文，并压缩固定指令中的重复表述；强制重译会绕过缓存。

0.1.18 的选词翻译曾需要再次点击按钮；0.1.19 起已改为选中即翻译。扫描版 PDF 如果没有文字层，需要先 OCR 后才能选择文字。

AI 译文缓存保存在应用用户数据目录的 `ai-translation-cache.json`，最多保留 4000 条。只有同一引擎、同一模型、同一原文且未点击强制重译时才会命中，因此不会用机器翻译替代 AI 对原文的完整检查。

> 2026-07-13：Research OS 补充全局材质与功能性动效层，包括页面/面板进入、环境光、标题渐变细线、按钮光泽与按压、卡片 hover、状态一次性流光、折叠方向、弹窗/消息/PPT 切页反馈、实验矩阵稀疏提示、图谱选中路径和长状态栏省略；系统减少动态效果和减少透明度偏好均可降级。

> 2026-07-13：arXiv “备选论文库”始终收进结果工具栏，支持展开完整列表并可用外部点击或 Esc 关闭；不影响空结果、单列、双列或三列结果布局，正式论文库保持不变。

> 2026-07-12：科研绘图工作区完成可读性与交互层级优化。三栏绘图结构、统计逻辑和本地 Runtime 接口保持不变；字段列表、图层 Inspector、工具栏和状态条统一为 Research OS 视觉语言，并支持减少动态效果与减少透明度的系统偏好。
## iPhone 本地论文阅读版（`codex/ios-mobile-reader`）

项目现在提供独立的 Capacitor iOS 构建目标。首版不是把整个 Windows 科研工作台压缩到手机，而是只迁移一个可完成的移动闭环：

1. 从 iOS“文件”导入 PDF，或通过 arXiv 检索后下载；
2. PDF 与论文元数据写入 App 本地沙盒；
3. 在论文库恢复最近阅读位置；
4. 使用 PDF.js 阅读原始 PDF；
5. 在“段落双语”模式中把中文译文直接放在对应英文段落下方；
6. 只有长按或选择词语、短语时才显示翻译浮层；
7. 可以导入已有中文/双语 PDF 并绑定到原论文。

当前明确不包含账号、云同步、桌面/手机数据互通、Android 工程、App Store 上架和 Windows `pdf2zh` Python sidecar。手机段落翻译使用用户配置的 OpenAI 兼容接口；`Base URL` 与模型名保存在本机，API Key 只保存在当前运行内存，退出 App 后需要重新填写。

### 移动端开发与验证

在 Windows 或 macOS 上运行移动 Web 预览：

```bash
npm install
npm run dev:mobile
```

构建移动 Web 资源并运行 iPhone 尺寸视觉回归：

```bash
npm run build:mobile
npm run visual:check:mobile
```

截图和溢出审计输出到 `.tmp-mobile-visual-check/`。

iOS 原生工程已经位于 `ios/App/App.xcodeproj`。每次修改移动端源码后同步到原生工程：

```bash
npm run ios:sync
```

`ios:add` 只用于尚未存在 `ios/` 工程的首次初始化；当前仓库不需要再次执行。Capacitor 8 当前要求 iOS 15+，最终模拟器、真机和签名验证需要 macOS、Xcode 与 Apple Developer 账号。

### 不上架 App Store 的 iPhone 下载

当前交付方式是 Ad Hoc `.ipa`，不会公开上架 App Store。目标 iPhone 的 UDID 必须先登记到 Apple Developer 账号并包含在 Provisioning Profile 中；每个产品家族每个会员年度最多登记 100 台设备。安装后设备需要启用开发者模式。

在 macOS 上配置好 Xcode 登录与证书后执行：

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID bash scripts/build-ios-adhoc.sh
```

如果同时准备了 HTTPS 下载地址，可生成一键安装页所需文件：

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PUBLIC_BASE_URL=https://download.example.com/ftranslate \
bash scripts/build-ios-adhoc.sh
```

生成的 `.ipa` 位于 `ios/App/output/adhoc/`；HTTPS 下载页模板位于 `distribution/ios/public/`。也可以用 Xcode 或 Apple Configurator 通过 USB 安装 `.ipa`。Windows 环境无法完成 Apple 签名或产出可安装真机的最终 `.ipa`。

移动端交互预览文件位于 `docs/mobile-preview/index.html`，可用任意静态 HTTP 服务器打开。

### 免费个人自用：GitHub Actions + Sideloadly

如果只安装到自己的 iPhone，可以不购买 Apple Developer Program。仓库提供手动工作流 `.github/workflows/ios-unsigned.yml`，使用 GitHub 的 macOS 26 runner 构建未签名 IPA：

1. 打开 GitHub 仓库的 `Actions` 页面；
2. 选择 `Build unsigned iOS IPA`；
3. 点击 `Run workflow`，分支选择 `codex/ios-mobile-reader`；
4. 构建完成后下载 `FTranslate-unsigned-ios` artifact；
5. 解压后把 `FTranslate-unsigned.ipa` 拖入 Windows 版 Sideloadly，使用个人 Apple ID 签名并安装。

免费 Apple ID 的签名有效期为 7 天。Sideloadly 可在电脑与 iPhone 通过 USB 或同一 Wi-Fi 可连接时自动刷新；必须保持相同 Apple ID 和 Bundle ID，并采用覆盖安装，不能先删除 App，否则本机论文库和译文缓存会随 App 沙盒一起删除。未签名 IPA 只用于个人自签，不能直接点开安装、上传 App Store 或公开分发。

工作流同时输出 `FTranslate-unsigned.ipa.sha256`。本地有 macOS/Xcode 26 时，也可执行：

```bash
npm ci
bash scripts/build-ios-unsigned.sh
```

输出位于 `ios/App/output/unsigned/`。

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
dist/PDF Translation Reader Setup 0.1.19.exe
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
- 搜索完成后不再隐藏地自动预翻译摘要；“翻译本页”会显式提交当前页剩余论文，单篇手动翻译保持最高优先级；翻译结果只允许写回发起它的当前搜索会话；
- 标题和摘要翻译优先使用本地 NLLB + CTranslate2，失败后回退 Argos Translate + SQLite 缓存，不消耗 AI API token；IPC 批次最多接收 100 个有效论文对象，并过滤非法项目；
- 离线翻译使用批量队列和持久 Python worker：首次翻译需要加载模型，后续同一运行期间会复用 worker，批量标题 / 摘要翻译会明显更快；NLLB 可用时界面会显示 CUDA / CPU 回退等运行状态；
- 翻译前会严格保护公式、代码和引用；DOI、URL、新旧 arXiv ID 作为可恢复字面量在模型省略时确定性补回，方法名与专业术语由源文本约束修复。翻译后拒绝严重截断、严格占位符错位、重复尾巴、英文回声和常见乱码结果进入缓存；旧缓存中如果出现 `���`、`æœºå™¨`、`鏈哄櫒` 等编码损坏文本，界面会退回英文并允许重新翻译；
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

已覆盖页面包括设置、AI 助手、论文导师问答、组会 PPT、知识图谱和 arXiv 检索。arXiv 的备选论文库在空结果与结果态都只保留工具栏紧凑入口，展开为不改变结果列数的局部浮层；正式论文库不受影响。

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
