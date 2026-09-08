# PLAN.md

## 2026-09-08：日常科研助手与个性化论文简报（已实现并验收）

### 产品方向修正
- 用户明确否定实验矩阵等冗余模块，批准实现日常使用的科研软件：每日定时个性化 arXiv 简报、直接阅读收藏、反馈与本地积累。
- 本节优先于旧「科研研发工作台」扩张计划；旧模块退离默认导航而保留数据，不继续新增实验管理入口。
- 第一性原理：真实问题是每天重复找论文与筛论文；不可压缩约束是来源可信、限量相关、能继续读、失败可见、用户可撤销偏好。复用已有解析、下载、缓存与阅读能力。

### 实施与验收
- 当前详细实施计划：`docs/daily-research-implementation.md`；协调记录：`MULTI_AGENT_REPORT.md`。用户要求停用 Superpowers 及相关技能，旧计划仅为历史草稿；所有代理由主代理直接派发、审查与协调，不再转派。
- 用户指定三个 Luna/MAX 代理。主进程服务、今日页面、导航与视觉测试并行；主代理集成、审查、打包并同步 git。
- 定时任务仅在本机应用运行时执行，启动补跑当日已到时间的任务；失败退避，同一时间只有一个简报生成任务。
- AI 默认关闭且需要用户启用；只使用公开摘要，必须明确数据来源，不捏造已读全文、代码验证或实时推送覆盖。
- 核心验收：偏好保存/重启恢复、手动/定时生成、去重、反馈/撤销、空结果/断网保留历史、从简报下载并进入阅读器。
- UI 使用 1366/1440/1920 截图验证，默认视觉门禁转向今日、论文库、阅读、arXiv 和设置，旧模块不再计入当前核心验收。

### 问题台账与验证边界
- 工作区原有 8 个 PDF/移动提取源码和测试改动及临时语料保持不动，不混入本次提交；本地构建自然包含这些现有工作区源码，不能声称安装包只含本次提交。
- 中途代理遇到账户使用限额中断；用户发出「继续」后恢复原任务，不重建重复代理。
- 源码视觉门禁已通过：今日的偏好保存、规则简报、反馈撤销、刷新恢复、错误保留历史，以及论文库、PDF 阅读、arXiv、设置内 AI 配置。1366/1440/1920 今日页均无横向溢出；已人工检查生成与错误状态截图。
- 对抗审查修复：保存失败回滚简报，损坏存储写前备份，短状态写入串行化，反馈稳定 ID 去版本，排除词支持顿号，数量输入先校验不静默改值，启发式分数不显示成概率；设置 AI 面板不再显示无关的 PDF 状态。旧模块首页配置回退今日，当前首页设置在启动时生效。
- 视觉脚本修复了表达式括号、字符串内正则转义、reload 时 body 尚未存在、旧「返回主页」按钮等过时假设。截图目录 `.tmp-visual-check/`；旧日期截图不作为本轮证据。
- 最终 `npm run dist` 通过：95 个测试文件、710 项测试通过，TypeScript、renderer、Electron、Windows NSIS 构建成功。安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,392,473 字节，SHA-256 `8AD6094C70F7B3FCAAD9E49E75161AF129A8685BDAFC7447693158AF096D75B0`。
- 最新源码 `npm run visual:check` 与 `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check` 均通过。打包后的简报保存、生成、反馈撤销、刷新持久化、失败保留历史、不同 arXiv 版本对应已有论文并打开阅读器、五入口与原位 AI 配置全部验证；今日及 AI 配置均覆盖 1366/1440/1920。最后修正了测试 PDF 的填充色泄漏，文字恢复黑色并重新人工复核。
- 人工复核截图：`.tmp-visual-check/daily-generated-1366.png`、`daily-generated-1440.png`、`daily-generated-1920.png`、`daily-error-1366.png`、`daily-open-reader.png`、`paper-library.png`、`settings-ai-1366.png`、`settings-ai-1440.png`。主要页面无明显遮挡、横向溢出或按钮越界。日志 `.tmp-daily-dist.log`、`.tmp-daily-visual.log`、`.tmp-daily-packaged-visual.log`。
- Git 交付范围为本次 31 个文件，目标 `origin/codex/ios-mobile-reader`；原有 8 个 PDF/移动文件和临时语料未暂存。未部署移动网页、未安装覆盖用户应用。
- 验证边界：自动任务/磁盘故障/AI 故障使用确定性注入测试；视觉检索使用隔离 userData 与 arXiv mock，不代表真实上游实时可用或真实 AI 服务已验证。没有启用用户的自动任务、没有向用户 AI 服务发起请求。实际 Windows 通知展示和原生 PDF 下载保存对话框尚需用户环境交互验证；已有本地论文到阅读器路径纳入打包后门禁。

## 2026-07-28：选段提问便利性与全文完整性发布门禁

### 当前结论

- 用户指出截图中标题 `Control Barrier Func` 被明显截断是正确的。根因不是手机 CSS，而是视觉检查使用的自包含 PDF 把长标题作为单行写出了 A4 页面边界；旧门禁只确认“存在标题块”，没有验证原文是否完整可见，因此脚本会对肉眼错误给出通过。
- 完整性规则必须覆盖所有阅读内容，不能只给标题打补丁。标题、正文、图注、表格标题、表头、单元格和公式说明都要满足“不漏字、不截断、不无依据拆并、不改变页内阅读顺序”；发现不可靠结构化结果时应保留更多原文，而不是输出漂亮但残缺的阅读流。
- 选段提问的核心便利性是减少重复输入，同时让用户在发送前能核对模型实际会收到什么。快捷问题不能自动请求，临时问答仍不应默认变成论文永久资产。

### 已完成操作

- 为结构化 PDF 文字重排新增整页词元覆盖率检查：对原始文字项与结构化阅读块做归一化和可重复词元计数，覆盖率低于 82% 时拒绝结构化结果并回退兼容重排，同时给出“文字完整度不足”诊断。
- 新增定向失败回归：模拟结构化结果只保留一个标题、丢掉正文和图注，确认旧实现会静默接受残缺结果；修复后自动回退，并保留页面末段。
- 公式完整性不只统计英文单词：单字母变量以及 `=`、`+`、`×`、`÷`、`≤`、`≥`、`∑`、`∫` 也参与覆盖率计算；新增 `D = A + F + S` 被损坏成 `D A F S` 时必须回退的定向回归。
- 重建手机视觉样本：长标题按两行居中写入 PDF；同一套期望常量同时生成标题、正文、图注、后续正文、表格标题和全部表格数据，避免测试输入与断言各写一份后漂移。
- 视觉脚本逐块检查精确文本与顺序，并对每个阅读块检查 `line-clamp`、`max-height` 和 `scrollHeight/clientHeight`；结构化表格必须包含全部表头及三行数据。标题漏词、正文截断、段落错序、图片/图注错位或任一表格单元格缺失都会失败。
- 选段问答增加四个快捷问题、来源页码、实际发送内容展开核对、回答一键复制及 Safari 复制回退。界面预览和实际请求统一调用 `buildAcademicSelectionQuestionPayload`，防止两套截断规则不一致。
- 快捷问题只填写输入框；问题改变时继续清除旧回答。实际发送内容包含有界选区、围绕选区的原文窗口、已有译文、论文标题与来源页码，论文内容仍被视为不可信引用材料。

### 验证记录

- `npm run dist` 通过：89 个测试文件、606 项测试通过，TypeScript、桌面 renderer、移动 renderer、Electron 和 NSIS 均构建成功。
- `npm run visual:check:mobile` 通过。人工复核：
  - `.tmp-mobile-visual-check/03b-reader-inline-figure-390x844.png`：两行标题完整，正文随后出现，图片位于图注之前；
  - `.tmp-mobile-visual-check/03c-reader-structured-table-390x844.png`：图注、后续正文、表格标题和三行数据完整且按序；
  - `.tmp-mobile-visual-check/06-reader-selection-ai-question-430x932.png`：快捷问题、回答、复制状态和重试按钮无遮挡；
  - `.tmp-mobile-visual-check/06a-reader-selection-ai-context-430x932.png`：标题、页码、完整原文段落和已有译文均可核对，无横向溢出。
- `npm run visual:check` 通过；人工查看 `.tmp-visual-check/home.png` 与 `whole-pdf-reader.png`，未发现本轮移动改动造成桌面重叠、遮挡或横向越界。
- Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,362,116 字节，SHA-256 为 `6C32E52F86A322773092D2A763497C40DE58FC14D8786699E4DACC99A6722F86`。
- Vercel 生产部署 `dpl_GPxoac66vDtVFjsaxTDkWCPjPbLs` 已绑定 `https://ftranslate-mobile.vercel.app`；入口 `assets/index-mfJHls2D.js`、问答逻辑 `assets/MobileApp-DQ92MDEq.js` 和移动样式实测 HTTP 200。固定地址的完整 `visual:check:mobile` 再次通过；实时 arXiv 在确定性回归中按参数跳过，随后独立请求生产 `/api/arxiv?search_query=all%3Arobot&start=0&max_results=1` 三次，结果为两次 HTTP 200（含 Atom feed 与论文条目）和一次上游超时 HTTP 503，未把瞬时波动伪报为全程稳定。

### 问题与风险

- 当前机器不存在此前真实语料目录 `D:\调研PDF\调研pdf\01_严格纳入_触觉模态`，本轮无法重新执行 12/13 篇真实论文的语料回归；不能把该项写成通过。自包含 PDF 能稳定验证本次失败模式，但不替代真实复杂论文抽查。
- 82% 覆盖率是“拒绝明显残缺结构化结果”的页面级安全网，不代表剩余 18% 可以随意丢失。精确视觉样本仍要求全部预期内容 100% 命中；真实论文中低覆盖会回退兼容重排并保留更多原文，之后仍可切换原 PDF 核对。
- 新的 `npm audit` 数据库报告完整工具链 25 个、生产依赖 9 个高危链，主要是旧版 `electron-builder` 及 `exceljs` 的压缩/文件遍历依赖。直接强制覆盖跨大版本 `archiver`、`minimatch` 或回退 `exceljs` 可能破坏 Excel 导出与 Windows 打包，本轮不做未经完整导入导出验证的依赖替换。
- AI 问答预览展示的是实际载荷字段，但模型服务商仍可能在服务端进行自己的长度限制或内容过滤；当前应用只能保证客户端发送前后一致。

### 禁止重复犯错

- 不得只确认“DOM 中存在一个标题/段落元素”就宣称内容完整；必须核对完整原文、顺序和实际可见高度。
- 不得用非法或已经写出页面边界的测试 PDF 证明移动排版正确；测试输入本身必须先满足真实 PDF 页面约束。
- 不得只为标题增加特例。任何完整性保护都必须覆盖正文、图注、表格和公式说明，并在结构化重排不可信时回退。
- 不得让快捷问题自动发送，也不得让 UI 展示的上下文与真实请求各自采用一套截断逻辑。
- 不得沿用历史 npm 审计结果描述当前依赖状态；每次发布必须重新审计并如实记录新的上游公告。

## 2026-07-24：选段 AI 问答对抗式审查与修复

### 当前结论

- 基线测试通过不代表真实边界可靠。本轮从选区长度、上下文截断、KaTeX DOM、问题编辑、接口失败和提示词注入六条路径对抗式检查，确认存在会让入口消失、上下文错误或界面误导的缺陷。
- 最小修复原则是保留现有“选区 → 明确输入问题 → 明确发送”的交互，不增加自动请求、云端存储或聊天历史，只修正发送内容和界面状态。

### 已修复问题

- 选区上限由 800 调整为 1,600 个字符，使常见完整科研段落仍能显示“翻译 / 向 AI 提问”；超过上限继续拒绝，避免误选整页。
- 原文上下文从“固定截取段落开头”改为“围绕选区生成有界窗口”。选区靠近超长段落末尾时仍在 1,600 / 3,200 字符窗口内，翻译和问答都不会失去当前句附近证据。
- 问题文本变化时立即清除旧回答与旧错误，按钮恢复“发送问题”，不再让旧答案停留在新问题下方。
- 中文译文节点增加原始缓存文本属性；选区上下文优先读取原始译文，不读取 KaTeX 渲染后的重复 MathML / HTML 文本。
- 问答提示词增加资料与指令隔离：论文标题、选区、原文和已有译文都只作为不可信引用材料，不能执行其中要求忽略规则、泄露信息或更换角色的文字；只有 `question` 是用户问题。
- 请求错误按操作标记；网络异常、HTTP 非成功状态和空响应在问答场景显示“AI 问答请求失败 / AI 问答接口没有返回文本”，不再使用含混的翻译错误。

### 验证记录

- 新增失败回归后先确认旧实现确实失败：1,600 字符选区被拒绝、超长段落末尾选区不在上下文窗口、提示词缺少资料隔离。
- 修复后 `mobileTranslation.test.ts` 与 `mobileSelection.test.ts` 共 17 项通过；`npm run typecheck` 与 `npm run build:mobile` 通过。
- 本地完整 `npm run visual:check:mobile` 通过；脚本实际修改已回答的问题并确认旧回答消失，模拟空载荷 HTTP 502 并确认错误为 `AI 问答请求失败：HTTP 502`，随后验证错误清除、再次请求及关闭面板后的迟到响应不会恢复界面。
- 人工复核 `.tmp-mobile-visual-check/06-reader-selection-ai-question-430x932.png`：底部问答面板未遮挡标题和关闭操作，原文、问题、答案和发送按钮层级清楚，430px 页面无横向溢出。
- `npm run dist` 通过：89 个测试文件、603 项测试全部通过，TypeScript、桌面 renderer、Electron 和 NSIS 打包完成。安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,362,027 字节，SHA-256 为 `03E1AC3BED26C0CA8200856519D5709E81DA143D6E398DB6613760B34F89D8F2`。
- `npm run visual:check` 与 `npm audit --json` 通过，完整依赖树为 0 个已知漏洞。桌面视觉脚本覆盖工作台、论文库、研究表格、实验矩阵、PDF 阅读、arXiv 和设置，未发现本轮移动改动引起的桌面回归。
- Vercel 生产部署 `dpl_J9KjfA1UZe1znX916afxL3wkFDqF` 已绑定 `https://ftranslate-mobile.vercel.app`；入口 `assets/index-BCTeN03W.js` 和问答逻辑 `assets/MobileApp-kbd7jRRs.js` 返回 HTTP 200。固定生产地址完整移动回归通过，包括新增的旧回答清除、HTTP 502 问答错误和原始译文上下文断言；确定性视觉回归按参数跳过实时 arXiv，随后独立请求生产 `/api/arxiv?search_query=all%3Arobot&start=0&max_results=1` 返回 HTTP 200、Atom XML 和实际论文条目。

### 问题与风险

- 同一段文字在一个超长段落中重复出现多次时，本地窗口当前以第一次完全匹配为锚点；普通论文自然段影响很小，但异常 OCR 把多段粘成一段且重复句子时，仍应优先修复原文提取边界。
- 1,600 字符仍是有意上限，不支持把整页或跨多个原文块一次发送。后续若支持跨段问答，必须显式列出将发送的段落范围和总字符数。
- 提示词隔离能降低论文内嵌指令的影响，但不能提供数学意义上的模型安全保证；关键科研结论仍需核对所选原文和原 PDF。
- Vercel CLI 的临时安装仍输出其自身旧依赖弃用提示，但远端 `npm ci` 和本项目完整 `npm audit` 都是 0 个已知漏洞；这些提示属于部署工具链，不等同于网页生产依赖漏洞。

### 禁止重复犯错

- 不得用固定 `slice(0, limit)` 截断与选区相关的上下文；有界截断必须保留实际选区。
- 不得从 KaTeX 或其他富文本渲染 DOM 的 `textContent` 反推准备发送的原始论文数据。
- 不得在问题已经改变时继续展示旧回答，也不得把问答网络错误标成翻译错误。

## 2026-07-24：连续双语选段 AI 提问

### 当前结论

- 真实需求不是再增加一个独立聊天页，而是让研究者在手机连续阅读时针对正在看的原文立即追问，同时保留这段话的论文语境。
- 最小闭环为“同段选区 → 选择向 AI 提问 → 输入明确问题 → 带段落上下文请求 → 在当前面板查看回答”。问答不得改写原文或译文，也不应把临时问题默认为论文资产长期保存。

### 已完成操作

- 在现有 iPhone Safari 选区浮层中并列增加“向 AI 提问”，保留“翻译选中内容”的原有入口；翻译完成后仍可继续就同一选区提问。
- 新增科研选段问答提示词和请求函数，发送所选英文、所在完整自然段、已有译文、论文标题及用户问题；要求术语准确、证据边界清楚、信息不足时明确说明，禁止编造未提供的全文内容。
- 新增移动底部问答面板：包含原文预览、问题输入、回答、错误和重试状态；回答支持现有公式显示。用户关闭面板后请求 ID 立即失效，迟到结果不会恢复已关闭界面。
- 复用本机翻译配置与 API Key 持久化，不新增云端存储；问答结果不写入论文、译文或 IndexedDB 缓存。
- 移动视觉脚本增加双入口、完整上下文载荷、真实问答、回答证据边界和迟到响应回归，并输出 `04-reader-selection-popover-390x844.png`、`05-reader-selection-popover-430x932.png` 与 `06-reader-selection-ai-question-430x932.png`。

### 验证记录

- 定向测试：`mobileTranslation.test.ts` 与 `mobileSelection.test.ts` 共 16 项通过。
- `npm run dist`：89 个测试文件、602 项测试通过；`typecheck`、桌面/移动 renderer、Electron、NSIS 均通过。
- `npm run visual:check:mobile`：本地完整回归通过；人工复核 390×844 / 430×932 选区与问答截图，无重叠、按钮截断或页面横向溢出。
- `npm run visual:check`：首次 npm 包装命令无错误文本退出；用 `node --trace-uncaught scripts/visual-check.mjs` 复查通过，随后重新执行标准命令也通过，未发现桌面界面回归。
- `npm audit --json`：0 个已知漏洞。
- 安装包：`dist/PDF Translation Reader Setup 0.1.12.exe`，148,362,028 字节，SHA-256 `90826C146F398A41A3741AE9C94BBF2289442DD7F575E922CA26B74E20058848`。
- Vercel 生产部署：`dpl_7Kw1PmPHh7QHmFroMVjEktUt2Lbf` 已绑定 `https://ftranslate-mobile.vercel.app`；入口 `assets/index-wr9ViK0b.js`、问答逻辑 `assets/MobileApp-HLH0JJtV.js` 与样式返回 HTTP 200。固定地址完整移动回归通过，实时 arXiv 检索按测试参数跳过，未伪报成功。

### 问题与风险

- 当前只允许在同一个英文原文块内选择，不能跨段混选，也不会对中文译文触发问答；这是为了保证发送上下文与证据定位可靠。若以后支持跨段问题，应显式展示将发送的多段范围，而不能静默拼接。
- 问答回答是当前面板内的临时结果，刷新或关闭后不恢复。后续如需要“保存为笔记”，应新增用户明确确认的写入动作，并记录论文、页码、原文选区和问题，不能自动缓存所有临时问答。
- 底层请求仍取决于用户配置的模型和网络；提示词能限制证据边界，但不能从技术上保证模型绝不产生错误，关键科研结论仍需核对原文和原始 PDF。
- Vite 仍提示 PDF.js 和桌面 Univer bundle 大于 500 kB；与本轮问答功能无直接回归，但首次加载性能风险仍在。
- 本机默认 `npx vercel` 使用的全局 npm 缓存存在文件缺失，首次发布因 `ENOENT` 中止；本轮改用独立临时 npm cache 后成功完成同一源码部署。后续发布应继续使用隔离 cache，或在获得用户授权后单独修复默认 npm 缓存，不能为此清理项目、浏览器或论文数据。

### 禁止重复犯错

- 不得在用户只完成文字选择时自动发送内容，必须等用户输入问题并明确点击发送。
- 不得把问答结果写回原文、译文或全文翻译缓存，也不得让迟到响应重新打开已关闭弹层。
- 不得只发送被截断的短选区而丢失所在完整自然段；也不得声称 AI 已读取未提供的论文全文。

## 2026-07-23：公式、Presentation 门禁与依赖风险收敛

### 当前结论

- 公式风险不应靠扩大 AI 猜测范围解决。可确定的分数、求和、范数、根式、幂和矩阵由本地规则恢复；无法通过 KaTeX 解析的结果必须显示原始文本，原 PDF/OCR 缓存和选词上下文始终保持不变。
- 桌面 Presentation 门禁此前同时包含测试样本不足和生成器缺陷：单页假 PDF 无法为实验/结果页提供真实证据；生成器又会让带 `/` 的英文片段绕过中文清洗，并把含摘要的论文信息页误报为页面类型错位。
- 依赖风险不能只检查生产包。定向补丁后，完整依赖树与生产依赖树均为 0 个已知漏洞，且桌面、移动、Electron 和 NSIS 构建全部通过。

### 已完成操作

- 公式显示增加高置信度结构恢复：简单分数、带界求和、范数幂、根式、简单幂和完整矩形矩阵；KaTeX 改为遇到解析错误抛出并回退到转义原文，不再渲染 `katex-error`。
- Presentation 自包含视觉 PDF 扩展为 8 页学术样本，覆盖完整论文章节和实验要素；视觉脚本新增质量门文本与失败截图，失败时可以直接看到具体页码和规则。
- 修复 Related Work 中 `RL / MPC / ...` 被 `/` 误判为公式的问题；论文信息页存在标题/来源元数据时允许附带摘要；来源页脚按“页码 + 章节”去重。
- 使用 npm `overrides` 升级有公告的传递依赖补丁，不使用 `--force` 或跨主版本自动修复；重新生成 lockfile 后完整审计归零。

### 验证记录

- `npm run dist`：89 个测试文件、601 项测试通过；`typecheck`、桌面 renderer、Electron、NSIS 均通过。
- `npm run visual:check`：通过；人工复核 `.tmp-visual-check/presentation-page.png`，质量状态为通过，无横向溢出、遮挡或重复来源标签。
- `npm run build:mobile` 与本地 `npm run visual:check:mobile`：通过；人工复核 `.tmp-mobile-visual-check/08b-reader-scanned-latex-390x844.png`，数学定义正确重排，原文仍可复制，页面无横向溢出。
- 生产地址 `FTRANSLATE_MOBILE_VISUAL_URL=https://ftranslate-mobile.vercel.app/` 的完整移动回归通过；实时 arXiv 检索按测试参数跳过，未伪报为线上检索成功。
- `npm audit --json` 与 `npm audit --omit=dev --json`：均为 0。Vercel `npm ci` 审计同样为 0。
- 安装包：`dist/PDF Translation Reader Setup 0.1.12.exe`，148,362,115 字节，SHA-256 `CBC5F8033D4AE2B28F1FC620223D846D7A57BDF85288B68AE0D281ADE0750F5F`。
- Vercel 生产部署：`dpl_DnsW916N12WkBsR1dFdzgnYjAYNv`，固定地址 `https://ftranslate-mobile.vercel.app`，入口 `assets/index-DwrpeyvH.js` 返回 HTTP 200。

### 问题与风险

- 本地规则只处理结构明确的常见公式；复杂多层矩阵、跨行公式、严重 OCR 错字仍保留原文并依赖原 PDF 核对，不能保证自动恢复。
- 用户先前提供的真实 PDF 目录在本轮验证时已不存在，显式语料命令因此跳过；需要路径恢复后才能重跑同一批真实文件。现有单元与视觉回归不能替代对所有极端论文版式的语料测试。
- Vite 仍提示部分桌面 bundle 大于 500 kB；这是性能和首次加载体积风险，不是本轮功能错误，后续应单独做按页面动态拆包，避免在稳定性修复中混入大规模重构。
- 生产视觉回归因 arXiv 上游可用性不稳定而设置 `FTRANSLATE_SKIP_LIVE_ARXIV=1`；PDF 导入、公式、OCR、缓存、翻译、选词、改名标签和删除流程均已线上验证，但实时检索仍需在上游恢复时补测。

### 禁止重复犯错

- 不得把 KaTeX 的错误样式当作成功公式；解析失败必须回退原文。
- 不得用只有标题的一页假 PDF 证明 Presentation 质量门有效。
- 不得把测试跳过写成通过，也不得只报告 `--omit=dev` 审计而隐藏完整工具链风险。
- 不得为通过门禁而给无证据页面伪造页码、实验结果或中文结论。

## 2026-07-23：连续双语科研公式改为 LaTeX / KaTeX 显示

### 当前结论

- 上一轮已经把 TouchDreaming 中被拆开的公式说明恢复为完整自然段，但独立公式和段内变量仍以普通字符显示，`t + τ`、`ℓ = 1`、损失项下标与公式编号无法形成论文级数学排版。
- 不能把 OCR/PDF 原文直接改写成 LaTeX 后写回缓存，否则会改变 `sourceHash`、破坏已有译文匹配，并让选词翻译读取 KaTeX DOM 中重复的 MathML/HTML 文本。正确边界是“原始数据不变，只在阅读显示层派生 LaTeX”。

### 已完成操作

- 新增移动端科研公式格式化层：`formula` 块将常见希腊字母、上下标、集合、损失项和公式编号转换为展示 LaTeX；段落只识别高置信度的 `D / A / F / S / o_t` 定义并转换为行内 LaTeX，普通英文、标题和图注保持原样。
- 移动运行时加载 KaTeX 样式，原文与译文统一通过安全的 `MathText` 渲染；已有 `$...$`、`$$...$$`、`\\(...\\)` 和 `\\[...\\]` 结果直接复用，解析失败时由既有渲染器显示转义后的原文。
- 原文容器保存 `data-source-text`，选词上下文优先读取该属性，不从 KaTeX 生成的 DOM 反推原文。公式块支持内部横向触摸滑动，页面级宽度保持不变。
- 移动视觉脚本增加 OCR 科研定义夹具、KaTeX 节点、原始数据保留和横向溢出断言；选词回归改为通过 `TreeWalker` 查找真实文本节点，不再假设段落首个子节点必然是纯文本。

### 对抗式验证记录

- 新增测试覆盖 TouchDreaming 集合定义、展示型 loss 公式、公式编号、已有 LaTeX 透传，以及标题/图注不被误改。全量测试 89 个文件、596 项全部通过，`npm run typecheck` 和 `npm run build` 通过。
- `npm run visual:check:mobile` 通过。390×844 截图 `.tmp-mobile-visual-check/08b-reader-scanned-latex-390x844.png` 中，`D = {(o_t, A_t, F_{t:t+τ}, S_{t:t+τ})}` 已由 KaTeX 重排；原始 OCR 字符串仍完整保留，正文和根页面无横向溢出。
- 同一移动回归继续通过英文选词翻译、Safari `selectionchange`、全文 OCR/翻译分离、刷新恢复、API Key 缓存、改名标签和删除论文，证明公式 DOM 包装没有破坏既有交互。
- 桌面 `npm run visual:check` 仍被既有 Presentation 内容质量门拦截：测试草稿第 2/7/8 页缺少可追溯页码，第 3/4 页中文 bullet 少于 2 条；失败与本次移动端公式显示无关，未伪报为通过。
- `npm run dist` 成功：89 个测试文件、596 项测试通过，TypeScript、桌面 renderer、Electron 和 NSIS 打包完成。`dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,853 字节，SHA-256 为 `1109D18D9026A096292AC8A029D5E1EF7E631A60084D36670F18D53395F03BF5`。
- Vercel 部署 `dpl_B3tSkTtMr6Yqco91EYm3cpJpqxQo` 已绑定 `https://ftranslate-mobile.vercel.app`；首页、`assets/index-ilZs51Vt.js`、`MobileApp-C8rnMWWN.js` 与 KaTeX CSS 均返回 HTTP 200。固定生产地址随后通过完整确定性移动回归，公式场景没有只在本地通过。

### 剩余风险

- PDF 文字层没有 LaTeX 语义。当前只自动转换高置信度科研模式；复杂矩阵、分式、多行对齐和严重 OCR 错符号仍保留原始文本，并以“原始 PDF”作为视觉核对基准。
- KaTeX 重排不能纠正 OCR 已经识别错的数学字符。后续应以真实失败公式扩充规则和测试，不能用大范围 AI 猜测静默替换论文公式。
- `npm audit --omit=dev` 当前报告 2 个传递依赖告警：`exceljs / electron-builder` 链中的 `brace-expansion` 高危 DoS，以及 `@univerjs → @grpc/proto-loader` 链中的 `protobufjs 7.6.4` 中危 DoS；本轮未用不受控 `npm audit fix` 扩大公式改动，需另立依赖升级任务并重跑打包/表格功能。

## 2026-07-19：公式上下标碎片与说明段落误拆修复

### 当前结论

- 用户截图不是字体或翻译问题，而是 PDF 文字层把上下标 `h / ℓ=1 / τ` 作为小字号、偏离正文基线的独立文字项；旧行聚类只参考候选行第一个文字项，恰好先读到上标时会低估容差，使下标掉成独立行。
- 第二个根因是含大量数学符号的英文定义句被归类为纯展示公式，导致同一个 `Objective` 定义在公式块与正文块之间反复切断。

### 已完成操作

- 行聚类改为使用候选行已经收集到的最大文字高度计算基线容差，把同一公式的上标、正文和下标合回一行；没有放宽到使用当前超大文字项，避免 IEEE drop cap 被错误吸入上一行。
- 新增“含行内公式的自然语言 prose”识别：至少四个英文词且以英文说明句开头时保留为段落；紧凑展示公式继续单独显示。
- 本地原文提取缓存版本从 `10` 提升到 `11`，旧论文重新打开时自动重建，不删除 PDF、译文、API Key、标签或进度。
- 新增 TouchDreaming 第 7 页坐标级回归，覆盖三个上下标集合定义、连续说明和“不得产生独立 `ℓ=1` 块”的断言。

### 对抗式验证记录

- 定向单元测试 88/88 通过；其中既验证本次公式段落，也验证纯展示公式仍独立、IEEE drop cap 仍正确恢复。
- `T TouchDreaming 2026.4.14.pdf` 14/14 页生产提取完成；第 7 页的 `Objective. Let dataset...` 到 `prediction horizon τ.` 已成为单一 paragraph，原先 7 个碎块不再出现。
- 13 篇真实论文共 150/150 页完成，全部直接读取文字层、0 OCR、0 未匹配图表、0 可修复断词；最大正文块 1874 字，未超过 2500 字安全门。
- `npm run visual:check:mobile` 通过；390×844 手机截图中连续阅读、原始 PDF、图表定位、结构化表格、选词翻译、退出恢复和缓存均正常，无横向页面溢出。
- 桌面 `npm run visual:check` 仍被既有 Presentation 质量门拦截：测试草稿第 2/7/8 页缺少可追溯页码、第 3/4 页中文 bullet 少于 2 条。失败发生在未修改的组会 PPT 场景，与本次移动端 PDF 提取无关；失败截图与状态保留在 `.tmp-visual-check/`，本次不扩大范围修改桌面 PPT 逻辑。
- `npm run dist` 成功重建 `dist/PDF Translation Reader Setup 0.1.12.exe`；Vercel 生产部署 `dpl_G2eKqfiWNMDa58jZ5vxf9mco73yF` 已就绪并绑定固定域名，线上首页与 `assets/index-CtScDDi1.js` 均返回 HTTP 200。

### 剩余风险

- 纯数学展示公式的上下标目前会按阅读顺序恢复为可选择文本，但连续阅读仍是纯文本而非 LaTeX 重排；原 PDF 模式继续作为公式视觉核对基准。
- Node/PDF.js 真实语料回归会报告 `standardFontDataUrl` 警告，但所有页面和断言均完成；该警告来自测试环境的标准字体资源配置，不是本次提取失败。

## 2026-07-19：移动端论文表格结构化重制与保守兜底

### 当前结论

- 用户截图中的 Table I 被整片 PDF 裁切显示，连下方正文也一起进入图片。这不是移动阅读需要的结果：该表具有完整文字层和稳定列坐标，应重制为可选择、可横向滑动的语义表格，而不是放大一张模糊截图。
- 表格重制不能只追求数量。真实语料对抗式检查发现公式密集的 Reward terms 和部分多级表头会把数据行误当表头；这类结果外观整齐但语义错误，必须回退到原 PDF 裁切。当前策略为“文字层结构化优先，置信度不足时原图兜底”。

### 已完成操作

- `MobileTranslationEntry` 新增可持久化的 `figureTable`；图表缓存版本提升到 `3`，使旧论文在保留 PDF、译文、API Key 和阅读进度的前提下自动重建图表索引。
- 表格分析按物理行聚类文字项，依据稳定行估计列数和列中心，合并跨行表头与跨行单元格，并使用表头完整度、单元格覆盖率、平均长度、数值表头、重复结构词和公式密度做置信度校验。
- 修复窄列间距被当作同一单元格的问题；结构化表格不再受截图最小高度门限制，只有两行的小表也能正常显示。
- 连续阅读新增语义化 `<table>`：表头与首列保持可见，表格区域独立横向滚动，窄屏页面不横向溢出；可靠表格不再加载 PDF canvas，公式/复杂布局仍使用原裁切。
- 真实 PDF 语料报告新增每页 `structuredTableCount`、表题、表头和行数据，便于发现“数量通过但内容错误”的假阳性。

### 对抗式验证记录

- `T TouchDreaming 2026.4.14.pdf` 14/14 页完成、0 OCR、0 未匹配图表。Table I 精确恢复 5 列 11 行；Table II、III、IV、V 也完成结构化重制，Table IV 的 4 行双组 `Parameter / Range` 均正确分列；公式密集的 Table VI 被置信度门拒绝并保留原图。
- 新增定向测试覆盖多行表头、窄列间距、两行小表、公式伪表格和数值行误作表头；结构化数据进入缓存后可按相同列数恢复。
- 390×844 移动视觉回归确认：表格含 4 个真实列头和 3 行数据、区域宽度不超过阅读页、内部 `scrollWidth` 大于可视宽度、没有 canvas、页面级横向溢出为 0。截图为 `.tmp-mobile-visual-check/03c-reader-structured-table-390x844.png`。
- 12 篇真实语料最终复跑覆盖 136/136 页、3880 个阅读块、0 OCR、0 未匹配图表；9 张普通表格通过置信度门完成重制。对抗式检查发现的 3 张数值行误作表头不再计入成功，而是保留原 PDF，避免错误结构进入阅读缓存。
- `npm run dist` 通过：88 个测试文件、592 项测试全部通过，TypeScript、桌面 renderer、Electron 和 NSIS 打包完成。`dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,484 字节，SHA-256 为 `23B6932A8DEB9B2CBCC0D30797B9875F60D75E16AB399F20D38B54A4617A555C`。
- 本地与固定生产地址的 `npm run visual:check:mobile` 均通过；线上回归使用固定地址并跳过实时 arXiv 上游，只验证本次确定性的导入、表格重制、翻译、缓存、OCR、改名和删除链路。`npm audit --omit=dev --json` 为 0 个生产漏洞。
- `$env:VISUAL_CHECK_PORT='9345'; npm run visual:check` 仍被仓库既有 Presentation 内容质量门拦截：第 2/7/8 页缺可追溯页码来源，第 3/4 页中文 bullet 少于 2；与本次移动端表格代码无关，未伪报为通过。
- Vercel 生产部署 `dpl_2TX6nWA6uPsZiNn6JBScvdMgDb8T` 已绑定 `https://ftranslate-mobile.vercel.app`；固定地址返回 HTTP 200，入口资源为 `assets/index-B6iyilJl.js`，随后通过生产移动视觉回归。

### 剩余风险

- PDF 文字层不携带 HTML 表格语义，复杂合并单元格、旋转表头、跨页表格和公式矩阵无法保证可靠重建；这些版式继续显示原 PDF 裁切，不伪报为结构化成功。
- 结构化表格目前重建原文和阅读布局，不单独生成整表中文版本；表题仍按普通图注进入全文翻译。后续若增加表格翻译，需要保持行列键稳定并单独设计术语与数值不可改写校验。
- Node 真实语料回归仍会输出 PDF.js `standardFontDataUrl` 警告；页面文字和结构化表格结果未受影响，但它属于测试环境字体资源提示。Vercel 完整开发依赖安装报告 5 个工具链告警，本地生产依赖审计为 0，二者不混为同一结论。

### 下一步

- 保持真实论文语料回归，优先根据错误样本提高可靠重建覆盖率，而不是放宽置信度门追求更多表格数量。
- 后续评估跨页表续接和结构化表格双语翻译，前提是数值、单位、符号和引用标记能够逐单元格校验。

## 2026-07-18：12 篇真实论文对抗式提取回归与 v10

### 当前结论

- 继续只拿单篇或合成 PDF 看首屏，无法证明段落、双栏、图表和最后一页稳定。本轮把用户新提供的 12 篇论文全部接入移动端真实生产提取链，共覆盖 136 页、IEEE/arXiv 版式、双栏首页、算法框、长参考文献、多图表和不同字号。
- 所有论文都具有可读文字层；136 页均走 `structured text`，OCR 页数和 Safari compatibility 页数均为 0。因此这批文件若在 iPhone 上显示“本地 OCR”，根因仍应优先检查 Safari/PDF.js 兼容路径或旧缓存版本，而不是认定手机上传改变了 PDF。
- 对抗式抽查确实发现了多类结构错误：WT-UMI 第 2 页四个无首行缩进自然段曾粘成 3756 字大块；PhysTouch3D 第 19 页 References 曾粘成 2919 字块；WBBT 第 7 页算法框混入未结束正文，第 12 页编号行内小节被上一段重新吞并；EIT 第 1 页较早开始的双栏正文被首页居中区交错排序。上述错误均已形成规则和测试，而不是只针对文件名打补丁。

### 已完成操作

- 用当前页真实相邻行距估计自然段间隔，代替过宽的固定字体高度阈值；保留普通行内换行、跨栏续写和同段连接词，同时按可见基线空隙恢复没有首行缩进的自然段。
- 增加强连字符续写修复，使跨 `paragraph / formula / caption / layout` 分类边界的断词也可重连；科研复合前缀白名单加入 `non`，避免把正确的 `non-interpenetration` 错删连字符。
- 首页 front matter 只接收页面中线附近的早期行，左右栏正文不再因处于页面前 18% 而被逐行交错；算法标题、十进制句首、编号行内小节和无方括号参考文献增加独立分类/拆分规则。
- 编号行内小节不仅在初次切块时拆开，也在后续段落合并阶段设置反向保护；新增“上一段本身未完句”测试，避免 `Table II summarizes the` 再次吞并 `2) Real-Time Online Parameter Estimation...`。
- 新增 `scripts/mobile-pdf-corpus-check.test.ts` 和 `npm run test:mobile:corpus`。回归逐页检查最后一页是否落盘、是否意外 OCR、是否产生空页、是否仍有同页可修复断词、最大正文块是否超过 2500 字，以及每个具有文字图注的图表是否仍紧贴对应图注。
- `MOBILE_LOCAL_OCR_VERSION` 从 9 提升到 10，触发已有浏览器论文从保存的原 PDF 重建本地原文；不会删除论文、API 配置或原 PDF。

### 对抗式验证记录

- 真实语料最终结果：12/12 篇、136/136 页完成，3875 个阅读块；0 OCR 页、0 compatibility 页、0 个同页可修复断词，最大正文块 1803 字。最后一页全部完成，未再出现卡在 `14/14` 一类收尾问题。
- 共识别 113 个图表区域，其中 112 个带有可匹配文字图注，全部按 `captionHash / Fig.-Table 编号` 解析到图注相邻的 ±0.25 排序位置，0 个图注错配；1 个区域的 PDF 本身没有可提取文字图注，保留原图但不能声称有文字锚点。
- 人工渲染核对 WT-UMI 第 2/5/6 页、WBBT 第 7/12 页、EIT 第 1 页和 SelfCap 第 1 页：确认无缩进段落的真实间距、算法框位置、编号小节、首页双栏起点和跨页连字符，再与诊断报告中的阅读块逐项对照。
- 定向结构/移动提取/图表/缓存测试共 123 项通过；`pdfTextStructure` 当前 70 项通过。`npm run typecheck`、`npm run build:mobile` 和 `npm run visual:check:mobile` 通过。
- 390×844 与 430×932 截图人工复核：连续双语保持小说式纵向阅读；图片在图注锚点附近，英文下方显示中文；选词浮层、顶部模式栏和底部状态栏无横向溢出。`.tmp-mobile-visual-check/audit.json` 的 body/root `scrollWidth` 均为 390，`clipped` 为空。
- `npm run dist` 全量通过：88 个测试文件、588 项测试通过，TypeScript、桌面 renderer、Electron 和 NSIS 打包完成。`dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,574 字节，SHA-256 为 `8031BB5FB0B9F9BB859A3C7A505F322A4C5D846DE0AC13B604715A050C8E3521`；生产依赖审计为 0 个漏洞。
- Vercel 部署 `dpl_5gqVsF2Ru6GQ41jzU9ZSmtzj7dgB` 已绑定固定地址 `https://ftranslate-mobile.vercel.app`，HTTP 200，入口资源 `assets/index-BQ23_pIJ.js`。固定生产地址再次通过完整移动回归，包括实时 arXiv 20 条结果、标题翻译、同源 PDF 下载/保存、失败检索清旧结果、原图锚定、选词翻译、OCR/翻译分离、刷新恢复与跨页术语账本。

### 剩余风险

- 当前真实语料回归在 Windows/Node 的 PDF.js 环境运行，能证明 PDF 本身和共享提取算法，不等同于 iPhone Safari 真机内存、WebKit 流读取和 IndexedDB 持久化压力测试；生产视觉脚本覆盖了 Safari 兼容模拟与刷新恢复，但仍需用户手机复验 v10 自动重建。
- 页末连字符可能需要下一页或浮动图表后的内容才能判断，当前只把“同一页已经存在明确小写续写却没重连”判为失败；跨页语义边界继续由已有跨页合并与用户点击后的 AI 双视图重排兜底。
- 复杂表格内文字会尽量从小说式正文中排除并保留原表图。无文字图注、非常规 `Fig./Table` 编号或纯矢量算法框仍可能缺少稳定语义锚点，必须保留原始 PDF 作为核对视图。
- `$env:VISUAL_CHECK_PORT='9356'; npm run visual:check` 仍被仓库既有 Presentation 内容质量门拦截：第 2/7/8 页缺少可追溯页码来源，第 3/4 页中文 bullet 少于 2 条。该失败与手机 PDF 提取代码无关，但意味着本轮不能声称桌面全站视觉门通过。

## 2026-07-18：移动端对抗式稳定性审查与选词翻译

### 当前结论

- 选词翻译此前已有浮层入口，但只依赖 `pointerup/touchend`，没有真实点击翻译的自动化覆盖；iPhone 拖动原生选区手柄后可能不再触发，且关闭浮层或改选新词时，旧请求响应可能用闭包中的旧状态重新打开浮层。
- 全文翻译按钮只依赖异步 React state 禁用，快速双击存在同一事件周期内启动两套请求的窗口；整页校验失败后逐段翻译若再次失败，原实现还会丢失真正的逐段错误。
- 设置弹窗允许在“保存并开始翻译”场景提交空 API Key，保存后会再次进入缺 Key 分支，形成重复弹窗。上述问题均已按真实状态链修复，而不是只改提示文案。

### 已完成操作

- 新增 `mobileSelection.ts`，统一选区文本清理、英文检测和基于 `visualViewport` 的浮层定位；选区必须位于同一个 `.mobile-block-original`，不能从英文跨入中文或跨自然段。
- 阅读器监听 Safari `selectionchange`，90 ms 合并重复事件；拖动选区手柄会更新当前词。滚动仅关闭自定义浮层而不破坏原生选区，触摸结束后可按新位置重新显示；返回、切换 PDF 和手动关闭会同时清除原生选择。
- 选词请求改用 `translateAcademicSelection()`：输入论文标题、所在英文段落和已有中文段落，提示词只返回当前语境中的简洁中文。当前阅读会话按 `Base URL + model + selection + paragraph` 缓存最近 100 项，模型或段落不同不会串用。
- 使用单调递增请求序号隔离选词请求。关闭浮层、换词或卸载阅读器都会使旧序号失效，迟到响应只完成网络收尾，不能更新 UI。浮层补充语义化 dialog/status/alert、可见“选词翻译”标签、40 px 主按钮和 36 px 关闭热区。
- 全文翻译新增同步 `translationRunRef`，同一事件周期内第二次点击立即返回；主流程用 `try/catch/finally` 保证任何异常都释放按钮和停止状态。逐段兜底失败时保留并显示实际网络错误，已完成页面仍在本机。
- 设置增加输入归一化和校验：配置了 Key 时 Base URL 必须是有效的 HTTP(S) 地址且模型不能为空；待执行翻译时 Key 必填，手动设置仍可清空 Key 以删除本地记录。

### 对抗式验证记录

- 定向测试覆盖选区清理、英文判断、390×844 底部选区定位、Safari visual viewport 偏移、科研选词提示词及设置校验；全量 `npm run dist` 为 88 个测试文件、580 项测试全部通过，TypeScript、桌面 renderer、Electron 和 NSIS 打包通过。
- 本地及固定生产地址的 `npm run visual:check:mobile` 均通过。脚本真实点击“翻译选中内容”，确认请求包含论文标题和所在段落；随后仅触发 `selectionchange` 更新到下一段，证明不依赖额外 pointer/touch 事件。
- 竞态回归会在第二次选词请求发出后立即关闭浮层，并把 mock 响应延迟 180 ms；响应返回后浮层没有复活。全文翻译按钮在同一浏览器任务内连续点击两次，3 页只产生 3 次整页请求，没有重复调用。
- 390×844 与 430×932 截图人工复核：浮层左右至少保留 11 px、未超出上下可视区，关闭按钮未遮挡选词，正文、图表、工具栏和底部状态无横向溢出或关键重叠。截图为 `.tmp-mobile-visual-check/04-reader-selection-popover-390x844.png` 与 `05-reader-selection-popover-430x932.png`。
- 生产回归同时通过实时 arXiv 20 条检索、标题翻译、导航状态保留、真实 PDF 同源下载与 IndexedDB 入库、失败检索清空旧结果、原图定位、OCR/翻译分离、术语跨页缓存、改名标签和删除闭环。
- `$env:VISUAL_CHECK_PORT='9344'; npm run visual:check` 仍仅被仓库既有 Presentation 内容门拦截：第 2/7/8 页缺页码来源，第 3/4 页中文 bullet 不足 2；与手机代码无关，未伪报为通过。
- Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,642 字节，SHA-256 为 `6CBE403EA7AA5861DDF4947CF2DC13C63C83B284850DB98244172E150862D9BD`。`npm audit --omit=dev --json` 显示生产依赖 0 个漏洞。
- Vercel 生产部署 `dpl_BAzQ78W6fjD36Zhbx8YK2j3XVj6X` 已绑定 `https://ftranslate-mobile.vercel.app`，固定地址返回 HTTP 200，入口资源为 `assets/index-BZmxYODf.js`；该生产地址随后通过完整移动回归。

### 剩余风险

- iOS 系统选区菜单和手柄仍由 Safari 控制，应用不能把单次轻点无歧义地解释为“选择某个英文单词”；当前采用系统标准的长按/双击选择，避免把正常滚动和点击误判为付费 API 请求。
- 选词缓存只保留在当前阅读组件内，刷新后会重新请求；这是为了避免零散查询无限写入论文缓存。全文译文、论文、API 配置和阅读进度仍按既有规则持久化。
- `CapacitorHttp` 当前不能在所有网页环境中真正中止已发出的兼容接口请求；关闭浮层可以保证迟到结果不更新 UI，但服务端可能已经完成一次计费请求。
- Vercel 完整开发依赖安装仍报告 5 个工具链审计告警；移动网页生产依赖的本地 `npm audit --omit=dev` 为 0，未把两者混为同一结论。

## 2026-07-18：科研术语账本与全文连贯翻译

### 当前结论

- 仅增强“准确翻译”提示词不能保证全文连贯，因为移动端按页调用模型，后页看不到前页已经确定的术语译法、专名首次出现位置和指代上下文。
- 本轮把翻译闭环改为可持续的跨页上下文：每页仍只请求一次，但同时携带论文标题、前 4 个双语段落和之前页面累积的专有名词账本；AI 返回当前页双语段落及新术语，客户端逐页缓存并传给下一页。

### 已完成操作

- 增强整页与逐段兜底提示词：普通科研术语必须使用领域通行译名并保持一致；方法、模型、数据集、系统、算法、模块、软件、自定义概念和缩写等专有英文名词，全文第一次使用 `English（中文释义）`，之后只保留完全相同的 `English`。
- 新增 `documentContext.documentTitle / introducedTerms / previousBilingualParagraphs`。前文双语段落只用于术语、语气、逻辑关系和指代衔接，提示词明确禁止重复输出前文。
- 每页严格 JSON 响应新增 `terminology`。只有英文名确实存在于当前页原文的术语才会进入账本；客户端后处理还会删除已介绍术语的重复中文括注，并补齐当前页首次术语的标准格式。
- `MobileTranslationEntry.introducedTerms` 随译文持久化，刷新后可恢复跨页术语账本；`MOBILE_AI_PAGE_REFLOW_VERSION` 提升到 `2`，已有 v1 译文会进入一次重新对照，而不会删除 PDF、提取结果或 API 配置。

### 验证记录

- 术语提示词、上下文载荷、旧版本迁移、JSON 术语解析、首次/后续格式后处理和持久化解析的定向测试通过；全量 `npm run dist` 为 87 个测试文件、574 项测试通过，TypeScript、移动/桌面 renderer、Electron 构建和 NSIS 打包通过。
- `npm run visual:check:mobile` 通过并验证真实跨页请求：第 1 页显示 `Vision Safety Policy（视觉安全策略）`，第 2、3 页只显示 `Vision Safety Policy`；后两页请求均收到前页术语账本和双语上下文，刷新后 6 个双语块、术语格式和 API Key 均恢复。
- 人工复核 `.tmp-mobile-visual-check/08b-reader-scanned-bilingual-390x844.png`：390×844 下英文专名、中文括注、正文、顶部工具栏和底部状态栏无横向溢出或关键内容重叠。
- `$env:VISUAL_CHECK_PORT='9343'; npm run visual:check` 仍只被既有 Presentation 质量门拦截：第 2/7/8 页缺少页码来源，第 3/4 页中文 bullet 数不足 2；与本轮手机翻译上下文无关。
- `npm run dist` 通过；`dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,639 字节，SHA-256 为 `59C355AABBCF6D4EEB2B01D1C6B051F1FAFF92AF6012EAFCF6852DAAB06725DB`。`npm audit --omit=dev --json` 显示生产依赖 0 个漏洞。
- Vercel 生产部署 `dpl_4wEhPziUNjw6EBNnR1nqyxWuLXDq` 已绑定 `https://ftranslate-mobile.vercel.app`；缓存穿透请求返回 HTTP 200，入口资源为 `assets/index-rEkEA5z0.js`。固定生产地址的应用链路视觉回归通过，覆盖 PDF 导入、原图定位、逐页翻译、跨页术语首次/后续格式、API Key/译文刷新恢复、改名标签和 IndexedDB 删除。验证期间实时 `/api/arxiv` 上游返回 HTTP 503，因此本轮线上回归明确跳过实时检索；本地完整回归已通过，但不把当前 arXiv 源站状态伪报为成功。
- 生产视觉回归在清除临时 legacy 论文时暴露 localStorage 删除与应用规范化写回的竞态；测试脚本改为在同一个浏览器任务内写入空数组并立即 `location.reload()`，不给旧页面异步回写窗口。该修改只提高测试隔离稳定性，不改变用户论文清理逻辑。

### 剩余风险

- 上下文最多携带 80 个术语和前 4 个双语段落，以控制 DeepSeek 请求长度；超过上限时先保留当前页英文原文确实再次出现的旧术语，再按最近使用顺序补齐，避免关键译法因固定截断丢失。
- 专名识别仍由语言模型结合论文语境判断，客户端只能验证英文名确实出现在原文并约束显示格式，不能在没有领域词典的情况下证明每个中文释义都是唯一标准译名。
- 整页 AI 安全门失败后会退回逐段翻译；该页仍能参考前文上下文，但无法像成功的整页 JSON 响应一样可靠地产生新的结构化术语账本。

## 2026-07-18：逐段 + 连续全文双视图 AI 兜底

### 当前结论

- 之前虽然已有整页 AI 重排函数，但只对 `origin=ocr/vision` 页面触发；PDF 文字层页面无论段落质量如何都只逐段翻译，确实没有完整兑现“AI 重排作为兜底”。
- 本轮不再依赖本地阈值先猜测异常页。因为用户点击全文翻译后本来就需要调用 AI，所以每页用一次双视图请求同时完成结构核对与翻译：逐段结构负责保真，连续全文负责暴露错误边界，AI 只整合确有异常的位置。

### 已完成操作

- `buildAcademicPageReflowPrompt()` 同时发送 `blocks` 和 `continuousText`；系统提示明确两者是同一页的重合视图，禁止重复输出、补写内容或随意改变正确段落。
- 全文翻译由“每段一个请求”调整为“每页一个双视图请求”。AI 整页结果通过 token 多重计数覆盖率和长度比例安全门后才替换本页；校验失败则保留本地结构并逐段翻译。
- 新增 `MOBILE_AI_PAGE_REFLOW_VERSION=1`。旧译文也会进入一次“待 AI 对照”，成功页面逐页缓存版本；失败页面不标记完成，允许下次重试。
- 图注定位增加规范化全文与 `Fig./Figure/Table + 编号` 两级语义键，AI 校正图注文字或改变段落哈希后，原图仍跟随图注。

### 验证记录

- 双视图 prompt、旧译文版本迁移、漏文拒绝、图注语义锚点等定向测试通过；全量 `npm test` 为 87 个测试文件、571 项通过，`npm run typecheck`、`npm run build:mobile` 和 `npm run build` 通过。
- 本地与固定生产地址的 `npm run visual:check:mobile` 均通过；浏览器 mock 明确验证每个翻译页面同时收到 indexed `blocks` 与完全相同的 `continuousText`，导入/OCR 阶段请求数保持不变，只有点击全文翻译后才逐页调用。人工复核 390×844 与 430×932 截图，未发现横向溢出、关键控件遮挡或图表脱离图注。
- `npm run dist` 通过；`dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,639 字节，SHA-256 为 `23F1741D0BCB23C1D342D8B1D26C000F8746A3D0E0D5319AA8F549FCCA897B68`。`npm audit --omit=dev --json` 显示生产依赖 0 个漏洞。
- Vercel 生产部署 `dpl_7yctRQVDZSDBRM4dWSrdopkX6Xbr` 已绑定固定地址 `https://ftranslate-mobile.vercel.app`；带缓存穿透参数验证返回 HTTP 200，入口资源为 `assets/index-LtSo75eJ.js`，随后对该线上地址完成整套手机视觉回归。
- `$env:VISUAL_CHECK_PORT='9342'; npm run visual:check` 仍只被既有 Presentation 质量门拦截：第 2/7/8 页缺少页码来源，第 3/4 页中文 bullet 数不足 2；该失败与本轮手机阅读器改动无关，未被掩盖或改写为通过。

### 剩余风险

- 双视图会让单次请求中的英文输入接近两倍；普通论文单页可控，但极端密集附录页仍可能触发用户所选模型的上下文限制。安全门失败时不会覆盖原文，并退回逐段翻译。
- AI 能修复输入文本中的段落和阅读顺序，不能从纯文字恢复未被本地提取到的图片像素、公式几何或彻底缺失的文字；这些仍以原 PDF 视图核对。
- 桌面 Presentation 视觉质量门的 5 项既有问题仍待单独修复；本轮不扩大范围修改无关 PPT 内容。

## 2026-07-18：段落双向纠错与图注锚点重排

### 当前结论

- 本轮问题不是单向“段落合并过度”，而是段落边界双向不稳定：首行缩进以错误的上一行坐标为基准会漏拆真实段落；双栏、连接词、连字符和 `Fig.` 缩写又会误拆同一段。
- 图片错位的确定根因是：图表区域先按原始正文块序号缓存，图内文字排除后正文块重新编号，但图片仍使用旧序号。正文变化越大，图注与图片距离越远。
- 修复采用稳定语义锚点而非继续微调旧序号：段落以版面证据双向合并/切分，图表以 `captionHash` 对当前正文顺序实时重定位。

### 已完成操作

- 段落切分改为相对整段左边界识别首行缩进，并加入参考文献编号、项目符号、论文行内小标题和 PDF 单行内嵌小标题识别。
- 同段续接覆盖同栏普通换行、双栏续写、lowercase 续写、连接词/介词结尾、科研复合词连字符和 `Fig.` / `Eq.` / `Sec.` 缩写；跨布局断开的章节标题也会恢复。
- Figure 在当前图注之前插入，Table 在当前表题之后插入；旧缓存中的 `order` 仅在找不到图注时兜底，不再作为正常定位依据。
- 本地提取缓存升级至 v9，使已保存 PDF 自动重建新段落结构；新增双向段落、普通多句不误拆、引用跨行、图表旧序号重定位等回归测试。

### 对抗式验证记录

- `T TouchDreaming 2026.4.14.pdf` 14/14 页走实际生产提取链；第 6 页 2398 字误合并块已分回四个论文语义段，同段跨栏续写仍能合并。
- 共检查 13 个 Figure/Table：修复前第 4 页相差 7 个块、第 13 页最多相差 15 个块；修复后全部与 `captionHash` 对应图注保持 `0.25` 排序距离。
- 定向结构与图表测试 4 个测试文件、136 项通过；全量 `npm test` 为 87 个测试文件、568 项全部通过，`npm run typecheck`、`npm run build:mobile` 和 `npm run build` 均通过。
- 本地及生产地址的 `npm run visual:check:mobile` 均通过；自动化覆盖原图位于图注之前、段落双语、退出/切换恢复、导入后仅提取而不翻译、明确点击后才翻译、API Key 与全文缓存恢复。人工复核 `.tmp-mobile-visual-check/03b-reader-inline-figure-390x844.png` 与 `08d-reader-scanned-novel-430x932.png`，390/430px 下未发现重叠、横向溢出或卡片化阅读回退。
- `$env:VISUAL_CHECK_PORT='9341'; npm run visual:check` 的桌面构建与页面采集完成，但仍被仓库已有的组会 PPT 内容门阻断：第 2/7/8 页缺页码来源，第 3/4 页中文 bullet 数不足；该失败与手机阅读器改动无关，未伪报通过。
- `npm run dist` 通过；Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,727 字节，SHA-256 为 `C1DAA4D7A1788153C873E21DF4FB4F9A49F92B5F801F19F68FCAEA399213D652`。`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。
- Vercel 生产部署 `dpl_5yxzTjwbU7jbhCRPfQm3csqRJGf7` 已绑定固定地址 `https://ftranslate-mobile.vercel.app`；带缓存穿透参数实测 HTTP 200，入口资源为 `assets/index-CoJJ1sTE.js`，并对该生产地址再次完成手机视觉回归。

### 剩余风险

- 论文中的算法伪代码、公式矩阵和坐标轴文字仍可能被 PDF.js 暴露为碎片；这类非正文区域不应通过激进语义猜测强行拼成自然段。
- 当前段落双向纠错覆盖同一 PDF 页内的普通换行、双栏和布局断块；自然段恰好跨 PDF 页时仍按页保存为两个阅读块，后续需要在不破坏逐页缓存和图表锚点的前提下增加跨页续接。
- iPhone Safari 真机字体度量与桌面 PDF.js 基准可能存在差异；仍需用同一篇 Touch Dreaming 在真机刷新 v9 缓存，核对 PDF.js 返回坐标与桌面回归是否一致。

## 2026-07-18：连续双语忠实提取与十三篇真实论文回归

### 当前结论

- “提取质量差”的主因不全是 OCR：带文字层论文此前复用了面向 AI 分析的过滤器，并在双栏排序、跨行表题、作者单位、公式和正文内 `Fig.` 引用上发生语义误判。
- 手机阅读已切换为独立的忠实提取器；只有图表区域内的单元格/图内标签按几何位置排除，作者、单位、短科研片段、图注和参考文献不再因分析规则被丢弃。
- 本地提取缓存升级到版本 `6`，图表缓存保持版本 `2`。旧缓存会自动失效并从原 PDF 重新提取，不要求用户删除论文或清除 Safari 网站数据。

### 已完成操作

- 新增阅读专用的双栏重排、首页前置内容排序、跨行章节标题合并、段落连续性判断、科研复合词断行修复和独立公式识别。
- 支持 `TABLE I` 无标点的 IEEE 表题、两行表题和带单位续行的表题；表格裁切按真实正文边界结束，单元格文字不会混入小说式正文。
- 图表区域在正文重排前按几何坐标排除原始文字；完整图注保留。正文内部换行后的 `Fig.` 引用会结合上一行上下文判断，不再误建图表裁切区。
- 第一页数字作者单位、机构脚注按普通正文处理；跨行大章节标题和图注会恢复成一个块，参考文献继续保留。
- 清除 PDF 内嵌字体产生的 C0 控制字符，并恢复 IEEE 正文首字母下沉被 PDF.js 错放到下一行的问题；双栏中间插入另一栏文本时也会按同栏坐标寻找首行。
- 阅读器按实际缓存逐页统计来源，明确显示“PDF 文字层 N 页”“本地 OCR N 页”或两者的混合页数；通用原文缓存不再显示成“OCR 缓存”。

### 真实 PDF 验证

- `T-BAL_CoP-ESP32_2025.12.24.pdf`：7/7 页文字层完成；两行 `TABLE I` 表题完整，表格保留为原图，3 条伺服公式独立于说明正文，图 7 两行图注完整。
- `T-DATA_HumanoidVTA_2025.10.28.pdf`：4/4 页文字层完成；跨栏 `TABLE I` 与表名合并，表格单元格不进入正文，`III... DATASET` 合并为一个章节标题，正文内 `Fig. 2. This result...` 保持正文而非伪图注。
- `T-HRI_SGR_2025.3.5.pdf`：8/8 页文字层完成；作者机构脚注不再成为大标题，图注、章节和参考文献保留。
- 扩展为用户提供的 13 篇真实论文，共 122/122 页全部结束且来源均为 `text`，OCR 页数为 0；总计提取 1,570 个阅读块和 136 个原图区域，无空页、替换字符或隐藏控制字符。
- `T TouchDreaming 2026.4.14.pdf`：14/14 页文字层完成、155 个阅读块、13 个原图区域、OCR 0 页；与此前测试副本的文件大小和 SHA-256 完全一致，排除“手机上传改变 PDF”的假设。
- 真实文件探针覆盖 1.55–61.58 MB、4–15 页论文，验证后从仓库删除，不提交用户 PDF、用户绝对路径或临时探针。

### 验证记录

- 13 篇真实 PDF 全页生产链路探针：122/122 页来源均为 `text`、OCR 0 页；无空页、替换字符、隐藏控制字符或失败文件。Touch Dreaming 单篇为 14/14 文字层页、155 个阅读块、13 个原图区域。
- `npx vitest run --dir src renderer/lib/pdfTextStructure.test.ts renderer/mobile/mobileExtractionSource.test.ts renderer/mobile/mobileTypes.test.ts`：3 个测试文件、70 项测试通过；另用真实 TACT 页面验证首字母下沉恢复为 `IN order ... tasks`。
- `npm test` / `npm run build` / `npm run dist`：全量 87 个测试文件、551 项测试全部通过；TypeScript、桌面 renderer、Electron 主进程与 NSIS 打包均成功。
- `npm run build:mobile` 与 `npm run ios:sync`：通过；最新网页资源已同步到 Capacitor iOS 工程，3 个原生插件声明保持完整。
- `npm run visual:check:mobile`：通过；人工复核 `.tmp-mobile-visual-check/03b-reader-inline-figure-390x844.png` 与 `08b-reader-scanned-ocr-only-390x844.png`，分别明确显示“PDF 文字层 1 页；未启动本地 OCR”和“本地 OCR 3 页”，390px 下无文字遮挡、按钮冲突或横向溢出。
- `npm run visual:check`：桌面全页面视觉回归通过；人工复核 `.tmp-visual-check/whole-pdf-reader.png`，共享 PDF 结构改动未破坏桌面阅读器。
- Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,362,066 字节，SHA-256 为 `82DAA3A9CD80DDFC5662B508BCF8DAC6C5470009BF0B664DD0F4C00C7A1CA85D`。
- `npx vercel --prod`：部署 `dpl_5L4GfoyTspC26hgqzpck1q71zHBK` 已完成并绑定 `https://ftranslate-mobile.vercel.app`；固定地址和本轮 `assets/index-DFMeFBSh.js` 均实测 HTTP 200。
- `npm audit --omit=dev --json`：生产依赖 0 个已知漏洞；Vercel 完整开发依赖安装仍报告 5 个审计告警，不进入移动网页生产运行依赖。

### 剩余风险

- 数学公式当前保留 PDF 文字层可读文本，不做 LaTeX 结构重建；复杂矩阵、多行推导仍以原 PDF 图像核对为准。
- 无文字层扫描件仍取决于 iPhone 本地 Tesseract 质量；AI 重排只在用户点击翻译后作为保守兜底，不会在导入阶段自动改写英文。
- Safari 被系统彻底冻结或进程被杀后无法继续执行网页 JavaScript，但已完成页面会逐页保存，重开后从首个缺页续跑。

## 2026-07-17：连续双语恢复原图与 OCR 末页收尾

### 当前结论

- 连续双语的数据流已从“纯文字列表”扩展为“文字块 + 原 PDF 图表区域”的单一阅读流；图片不经过 DeepSeek，原 PDF 不被覆盖。
- OCR 停在最后一页的根因不是第 14 页内容本身，而是页面保存完成后仍无上限等待 Tesseract worker 或 PDF.js document 销毁。单页和收尾均已加入时间边界；已有完整页面覆盖的旧任务会直接完成，不再重跑最后一页。
- 旧缓存按 `figureExtractionVersion` 迁移。首次打开已完成 OCR 的旧论文时逐页补提图表并写入原论文翻译缓存；无图论文也记录完成版本，避免每次打开重复扫描。

### 已完成操作

- 新增 `mobilePdfFigures.ts`：识别 `Fig. / Figure / Table` 图注，结合 PDF 绘制指令与版面边界确定图表裁切区；位图优先使用实际绘制并集，纯矢量图使用图注锚点裁切。
- 连续阅读器把图表与原文段落按页内 order 合并，接近视口时才从本地 PDF 渲染；图中坐标轴、图例等误提文字会从正文流隐藏，正文图注继续保留。
- OCR 每页处理上限为 120 秒、每页缓存写入上限为 30 秒，worker/document 清理上限为 2.5 秒；最后一页写入后显示收尾状态。刷新后若 `visionOcrProcessedPages` 已覆盖全部页面且存在正文缓存，则直接修复为 completed。
- OCR/AI 重排的文字页写入和图表页写入相互独立，AI 重排某页不会删除该页已缓存图表。

### 验证记录

- `npx vitest run src/renderer/mobile/mobilePdfFigures.test.ts src/renderer/mobile/mobileLocalOcr.test.ts src/renderer/mobile/mobileTypes.test.ts`：4 个测试文件、38 项测试通过。
- 用用户截图对应的 arXiv `2604.13015v1`（14 页）做临时真实 PDF 验证：14 页图表分析在约 2 秒内结束；首页位图、纯矢量架构图、第 9 页 Fig. 6 / Fig. 7 与第 14 页图表均被定位，测试后已删除临时 PDF，未加入仓库。
- `npm run build:mobile`：通过。
- `npm run visual:check:mobile`：通过；新增矢量图夹具验证原图位于图注前、画布实际渲染、工具栏显示图表数量且无横向越界。人工检查 `.tmp-mobile-visual-check/03b-reader-inline-figure-390x844.png`，390×844 下图表、图注、原文和操作栏无重叠或横向溢出。
- `npm run build`：85 个测试文件、516 项测试全部通过，TypeScript、桌面 renderer 与 Electron 主进程构建通过。
- `npm run visual:check`：桌面端视觉回归通过；移动端共享依赖变更没有破坏桌面工作台。
- `npm run ios:sync`：通过；最新移动网页资源已同步到保留的 Capacitor iOS 工程，3 个原生插件声明保持完整。
- `npm run dist`：通过；Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,795 字节，SHA-256 为 `37E19257D256B5A6424494D7700D8BAFC3134A930EDC10AB54036D52CE3DB36D`。
- `npx vercel --prod`：生产部署 `dpl_2yMJj3g8AJwfpzLfQtF4bZasmcC2` 已完成并重新绑定固定地址 `https://ftranslate-mobile.vercel.app`；随后 HTTP 验证返回 200，首页引用本轮 `index-Cks0MXl6.js`。首次 CLI 下载因本机 npm 缓存缺失 `ajv` 内容失败，运行 `npm cache verify` 修复索引后重试成功，未清除项目或浏览器数据。

### 问题与风险

- PDF 图表定位依赖可识别的英文图注或表题。整页扫描件没有文字层时仍能 OCR 正文，但无法可靠地把整页像素自动分割成每一幅独立图；此类文件继续以“原始 PDF”作为完整图像核对入口。
- iOS Safari 把网页挂到系统后台后可能暂停 JavaScript，普通网页无法保证浏览器被彻底退出后仍持续计算；当前保证的是逐页落盘、重开续跑和完整覆盖后自动收尾，而不是绕过 iOS 后台限制。
- 图表按需渲染会短暂占用一个 PDF 页画布，页面缓存上限为 3 页；仍需在 50 MB / 100 页论文上继续做 Safari 内存压力验证。

## 2026-07-14：iPhone 局域网网页阅读

### 当前结论

- 当前交付优先级已从 IPA 自签切换为局域网网页：Windows 本机启动移动 Web，iPhone Safari 通过同一 Wi-Fi 访问，不需要 App Store、Apple Developer 账号、Sideloadly 或 7 天续签。
- 最小闭环仍严格限制为 PDF 阅读与段落/选词翻译、arXiv 检索、浏览器本地论文库；不做账号、云同步、桌面互通或 Android。
- Windows 只提供静态网页并同源转发 arXiv Atom/PDF 请求；论文文件、阅读进度和译文由 Capacitor Web 存储保存在当前 Safari。翻译 API Key 不经过 arXiv 代理，只在当前网页内存中使用。
- 现有 Capacitor iOS/IPA 代码和工作流保留，但不是当前使用入口，避免将来需要原生包装时返工。

### 已落地能力

- `npm run serve:mobile`：构建 `dist-mobile/` 后在 `0.0.0.0:4174` 启动局域网网页；`npm run dev:mobile` 也已允许同网段手机访问。
- `vite.config.ts`：仅在 mobile 模式提供固定目标的 `/api/arxiv` 与 `/api/arxiv-pdf` 代理，解决 Safari 无法直接跨域访问 arXiv Atom API、带 `.pdf` 地址重定向的问题。
- `mobileWeb.ts`：把 arXiv 查询与 PDF 地址映射到当前网页同源代理；非 arXiv PDF 不会被任意转发。
- 移动端提示已从“App 沙盒”改为“当前浏览器”，明确 Safari 存储边界与 API Key 生命周期。
- 移动视觉脚本支持加载真实 HTTP 地址，可在网页源环境验证 IndexedDB/Preferences、本地 PDF 导入和翻译交互。

### 验证记录

- `mobileWeb.test.ts`：3 个代理地址测试通过，覆盖查询参数保留、arXiv PDF 固定转发和非 arXiv 地址不代理。
- `npm run typecheck`：通过。
- `npm run build:mobile`：通过；PDF.js 主 chunk 约 699 kB，仍有大 chunk 警告。
- `npm run ios:sync`：通过；网页适配改动已同步到保留的 Capacitor iOS 工程，未破坏 3 个原生插件声明。
- `npm run dist`：通过；全部 80 个测试文件、465 个测试通过，TypeScript、桌面 renderer/Electron 和 NSIS 打包均成功。安装包为 144,261,714 字节，SHA-256 为 `DC9FD6CCE8BA8862F89278D8A240DF25B151EB2304FE33C90004DBC4FE73709A`。
- `$env:VISUAL_CHECK_PORT='9336'; npm run visual:check`：桌面全页面视觉回归通过，确认移动网页入口和共享 `index.html` meta 调整未破坏桌面界面。
- 本地 HTTP 烟雾验证：`/` 返回 200；`/api/arxiv` 返回 200 `application/atom+xml` 且包含论文条目；`/api/arxiv-pdf/pdf/1706.03762` 返回 200 `application/pdf`，长度 2,215,244 字节。
- `$env:FTRANSLATE_MOBILE_VISUAL_URL='http://127.0.0.1:4174/'; npm run visual:check:mobile`：通过；真实网页源下完成浏览器 PDF 存储、段落解析、内联翻译与选词浮层。390px 审计中 body/root 宽度均为 390，无越界元素。
- 人工查看 `.tmp-mobile-visual-check/` 全部 5 张截图：论文库、arXiv、长标题、中文内联段落、选词浮层和底部状态栏没有明显重叠、遮挡、截断或横向滚动；截图透明合成显示已用像素抽样复核，内容背景实际为 `#f7f9fc/#f8fafc`。
- 当前机器 WLAN 地址为 `192.168.0.104`，本轮服务已在 `http://192.168.0.104:4174/` 监听；该地址只作为本轮真机入口，后续以 Windows 实际输出为准。

### 问题与风险

- 电脑必须开机、服务必须运行且手机与电脑在同一局域网；这不是公网网站。
- Safari 浏览器数据按 origin 隔离；电脑 IP 或端口变化会形成新论文库视图。清除网站数据、使用无痕模式或系统存储压力也可能导致论文丢失，必须保留原 PDF。
- 当前是 HTTP 局域网页面，翻译 Key 只允许由浏览器直连用户配置的 HTTPS 接口；若第三方 OpenAI 兼容接口未开放 CORS，网页翻译会失败，当前不通过不加密的局域网代理转发密钥。
- 尚未在用户真实 iPhone Safari 上验证 Windows 防火墙、路由器客户端隔离、Safari 存储配额和大 PDF 内存表现。

### 下一步

1. 用户用 iPhone Safari 打开本轮局域网地址，完成一次“导入 PDF → 阅读 → 翻译一段 → 关闭并重新打开网页”的真机验证。
2. 在路由器为 Windows 电脑设置 DHCP 地址保留，避免浏览器 origin 因 IP 变化而切换。
3. 用 50 MB、200 页 PDF 做 Safari 内存压力测试，并增加论文库导出/恢复，降低浏览器数据被清理的风险。
4. 只有需要离开同一 Wi-Fi 访问时，再增加 HTTPS 公网部署和受控服务端代理；暂不恢复 IPA 自签为首选路径。

## 2026-07-13：iPhone 本地论文阅读版

### 当前结论

- 已从 `codex/arxiv-ui-night-optimization` 创建 `codex/ios-mobile-reader` 分支。
- 已新增独立移动端构建入口和 Capacitor 8 iOS 工程，首版范围严格限制为论文库、arXiv 检索、PDF 阅读与翻译。
- 移动端采用本地沙盒数据，不实现账号、云同步、桌面互通或 Android；后续三端同步不得反向污染当前本地 MVP。
- 不进行 App Store 上架。已准备 Ad Hoc `.ipa` 构建脚本、ExportOptions 和 HTTPS 安装页模板；最终签名、真机安装与 IPA 产出仍需要 macOS + Xcode + Apple Developer 证书和已登记 UDID。
- 用户已选择免费个人自用路线：GitHub Actions 的 macOS 26 runner 生成未签名 IPA，再由 Windows Sideloadly 使用个人 Apple ID 重签并安装；不购买开发者会员。

### 已落地能力

- `src/renderer/mobile/`：独立的三入口移动 App、论文库、arXiv、PDF/段落双语阅读和平台存储/网络适配层。
- 论文 PDF 存入 Capacitor Filesystem；论文索引存入 Preferences；段落译文按论文写入独立缓存文件。
- PDF 阅读复用 PDF.js；段落双语模式复用现有论文结构提取逻辑，把中文直接放在英文段落下面。
- 用户选择单词或短语后才显示翻译浮层；长文本限制在视口内。
- 移动端不再要求导入已有双语 PDF；普通 PDF 直接重排为连续段落并生成内联中文。Windows `pdf2zh`/Python sidecar 不迁入 iOS。
- arXiv 使用共享查询构造与 Atom 解析逻辑，通过 Capacitor HTTP 请求，带 24 小时本机缓存和最小请求间隔；PDF 使用 File Transfer 下载到 App 沙盒。
- `ios/`：iOS 15+ 原生工程与 Swift Package 插件声明；Windows 生成的反斜杠路径通过 `scripts/normalize-capacitor-spm-paths.mjs` 自动修复。
- `distribution/ios/`：Ad Hoc 导出配置、OTA manifest 模板和 iPhone HTTPS 安装页。
- `.github/workflows/ios-unsigned.yml` 与 `scripts/build-ios-unsigned.sh`：手动云端构建未签名 IPA，并输出 SHA-256，供 Sideloadly 个人自签。

### 验证记录

- 2026-07-13：GitHub Actions 首次云端构建成功（run `29223652350`，2 分 09 秒），已产出 `FTranslate-unsigned-ios` artifact；随后将 `checkout`、`setup-node`、`upload-artifact` 升级至 Node 24 对应的 v6，消除 Node 20 弃用告警。
- 2026-07-13：升级后的云端构建再次成功（run `29223837787`，1 分 32 秒，无 annotation）；下载后的 `FTranslate-unsigned.ipa` 为 2,859,203 字节，SHA-256 为 `f16c647771999ab1159c8d2dbbaeb300807b459cb57cc1fe8ae3f17b2c629692`，与随附校验文件一致，且归档中存在 `Payload/App.app/App` 与根 `Info.plist`。

- `npm test`：测试入口已改为 `vitest run --dir src`，只扫描当前仓库根目录；当前 80 个测试文件、465 个测试全部通过，不再误扫 `.worktrees/*/src`。
- `npm run typecheck`：renderer 与 Electron main TypeScript 检查通过。
- `npm run build:mobile`：通过；输出 `dist-mobile/`。PDF.js 主 chunk 约 699 kB，worker 约 2.33 MB，存在 Vite 大 chunk 警告但不阻断运行。
- `npm run ios:sync`：通过；移动 Web 资源、Capacitor 插件和本地 Swift Package 路径已同步。
- `npm run visual:check:mobile`：通过；自动完成本地 PDF 导入、段落解析、会话翻译、内联译文和选词浮层，`audit.json` 显示 390px 视口下 body/root `scrollWidth` 均为 390，未发现越界元素。
- `npm audit --omit=dev --json`：生产依赖 0 个漏洞。已把 Vite 定向更新到同主版本补丁 `7.3.6`、`concurrently` 更新到 `9.2.4`；开发工具链仍有 5 个传递依赖告警，不进入移动 App 生产包，未执行大范围 `npm audit fix`。
- `$env:VISUAL_CHECK_PORT='9334'; npm run visual:check`：桌面源码视觉回归通过；默认 `9333` 端口曾被异常退出的 Windows 调试句柄占用，改用独立端口后覆盖全部既有页面并通过。
- `npm run dist`：Windows NSIS 安装包重建成功；`dist/PDF Translation Reader Setup 0.1.12.exe` 当前为 144,261,714 bytes，SHA-256 为 `DC9FD6CCE8BA8862F89278D8A240DF25B151EB2304FE33C90004DBC4FE73709A`。
- `$env:VISUAL_CHECK_PACKAGED='1'; $env:VISUAL_CHECK_PORT='9335'; npm run visual:check`：打包后的 Windows 应用视觉回归通过，确认移动入口改造没有破坏安装包内桌面界面。
- 视觉截图：`.tmp-mobile-visual-check/01-library-empty-390x844.png`、`02-arxiv-idle-390x844.png`、`03-reader-inline-translation-390x844.png`、`04-reader-selection-popover-390x844.png`、`05-reader-selection-popover-430x932.png`。

### 视觉对抗式审查

- 第一轮发现 arXiv 空区域出现离屏合成黑块、双语页底部分页显示 `1 / ?`、选词浮层长文本靠近关闭按钮。
- 已为移动滚动面板补实体背景、从段落最大页码同步页数、对选词源文本启用单行截断；视觉脚本改用前台软件光栅并限制为当前设备视口，排除 Chromium 超视口截图的合成黑块。
- 最终复验确认：论文库和 arXiv 页面无黑块；段落中文位于英文下方；分页显示 `1 / 1`；选词浮层在 390×844 和 430×932 下均无横向越界；底部导航和阅读状态栏未遮挡主要动作。

### 问题与风险

- 当前机器是 Windows，不能运行 Xcode、iOS Simulator、Apple 代码签名或真机安装，因此不能声称 `.ipa` 已签名可下载。
- Ad Hoc 分发必须有 Apple Developer Program、分发证书、App ID、包含目标 UDID 的 Provisioning Profile；设备数量受 Apple 年度上限约束。
- 手机段落翻译需要网络和用户自己的 OpenAI 兼容接口；已缓存译文可离线阅读，但尚未集成设备端本地大模型。
- 整本保版式双语 PDF 仍由桌面 `pdf2zh` 流程承担；手机端以普通 PDF 的连续段落双语阅读为主，并保留原 PDF 核对视图。
- 移动构建仍会产出少量桌面分支引用的 KaTeX/品牌资源；不影响功能，但后续可拆为完全独立 HTML 入口以减小 IPA。
- 目前未做 iOS 原生 UI 测试、真实弱网 arXiv 请求、超大 PDF 内存压力和 100+ 论文库性能测试。
- 免费个人签名每 7 天过期一次；只有在电脑和 iPhone 可连接时 Sideloadly 才能自动刷新。错过刷新后 App 暂时无法打开，但使用同一 Apple ID 与 Bundle ID 覆盖安装可继续使用；删除 App 会删除本地沙盒论文数据。
- 原 `vitest run src` 会把 `.worktrees/*/src` 也当作位置过滤结果，导致其它分支测试污染当前构建；已改为 `vitest run --dir src`，后续不得恢复为模糊位置参数。

### 下一步

1. 在 Windows 使用 Sideloadly 和专用免费 Apple ID 安装，验证首次 USB 安装、Wi-Fi 自动刷新和覆盖安装后的论文库保留情况。
2. 验证免费签名第一个 7 天周期内的自动刷新，并记录刷新失败时的恢复步骤。
3. 用 50 MB、200 页和扫描型 PDF 做内存/首屏耗时压力测试，再决定是否按页懒解析。
4. 如果后续需要公开分发，再转 Apple Developer Program、TestFlight 或 App Store；当前不使用 Ad Hoc 设备额度。
5. 在移动 MVP 稳定后再定义三端同步协议；同步对象至少包括论文身份、文件版本、阅读位置、段落哈希和译文冲突策略。

本文件用于记录 FTranslate 的长期计划、当前阶段目标、问题台账和防重复犯错事项。每次操作前必须先阅读本文件、`README.md` 和 `DESIGN.md`。

## 1. 产品定位

FTranslate 当前应从“PDF Translation Reader / 科研论文工作台”升级为：

> 面向高校实验室、AI 创业团队和园区科创企业的本地化 AI 科创研发工作台。

核心目标：

- 把论文、代码、实验、模型运行状态和研发知识沉淀为可追踪、可验证、可复用的研发闭环；
- 服务“AI 应用创新·数智天河”板块二方向 3：AI 科创工具；
- 避免只做材料生成、入口包装或普通 AI 问答。

## 2. 第一性原理判断

AI 科创团队的真实瓶颈：

1. 论文、代码、数据集、实验结果、报错日志和 idea 分散。
2. 读懂论文不等于能复现，知道 idea 不等于知道怎么验证。
3. baseline、消融、失败原因和评价指标难以追踪。
4. 普通 AI 输出缺少证据链和实验闭环。
5. 小团队无法承担复杂 MLOps、私有部署和工程平台成本。

因此，本项目的核心不是“多一个聊天机器人”，而是：

> 将非结构化研发材料编译成可执行、可追踪、可验证的研发对象。

## 3. 长期功能蓝图

### 3.1 AI 科创项目空间

目标：从“单篇论文/单个 PDF”升级为“研发项目”。

项目应关联：

- 研究目标；
- 论文；
- 代码仓库；
- 数据集或环境；
- baseline；
- proposed method；
- 实验记录；
- 报错日志；
- 模型运行状态；
- 知识图谱；
- 决策历史。

### 3.2 Paper-to-Method 论文方法编译器

目标：导入论文后生成结构化方法卡，而不是只给摘要和翻译。

结构化字段：

- problem；
- input / output；
- model architecture；
- loss function；
- training objective；
- constraints；
- dataset / environment；
- baseline；
- evaluation metrics；
- claimed contribution；
- limitation；
- reproduction risk；
- evidence source：页码、段落、公式、图表 caption。

### 3.3 Paper-to-Code 复现映射器

目标：把论文方法和代码实现对应起来。

需要分析：

- `README.md`；
- `requirements.txt` / `environment.yml` / `pyproject.toml` / `setup.py`；
- `train.py` / `main.py` / `run.sh`；
- `configs/`；
- `scripts/`；
- checkpoints、datasets、logs。

输出：

- 最小运行入口；
- 环境安装路径；
- smoke test 命令；
- 完整训练命令；
- 评估命令；
- 论文模块与代码文件映射；
- 依赖风险和复现风险。

### 3.4 实验矩阵与消融设计器

目标：把研究 idea 转化为可执行实验矩阵。

边界：实验矩阵不是研究表格改名，也不是覆盖 Univer 自由工作簿。研究表格继续承担自由整理、临时分析和人工编辑；实验矩阵是从方法卡、论文证据和用户 idea 派生出来的结构化实验设计层。

核心字段：

- baseline；
- proposed method；
- ablation；
- controlled variables；
- seeds；
- metrics；
- expected result；
- failure diagnosis；
- run status。

优先支持 RL / PINNs / 路径规划 / 安全约束 / CBF / MPC / 机器人导航等研究方向。

### 3.5 AI Runtime Center

目标：展示本地 AI 能力和任务运行状态，贴合 AI 科创工具方向。

优先覆盖：

- NLLB worker 状态；
- Argos 状态；
- pdf2zh 状态；
- CUDA / CPU fallback；
- 当前任务队列；
- 缓存命中率；
- 失败日志；
- 模型路径检测；
- API provider 状态。

后续扩展：

- LoRA / fine-tune 任务状态；
- embedding index 状态；
- 实验进程监控。

### 3.6 Evidence Graph 证据知识图谱

目标：从普通知识图谱升级为研发证据图谱。

节点：

- Paper；
- Claim；
- Method；
- Equation；
- Figure；
- Dataset；
- Code File；
- Experiment；
- Metric；
- Error Log；
- Decision。

边：

- paper claims method；
- method implemented by code；
- experiment tests claim；
- metric supports result；
- error blocks reproduction；
- decision based on evidence。

### 3.7 Research Autopilot

目标：把 AI 问答升级为多智能体研发推进。

角色：

- Literature Agent：找论文、比较方法；
- Method Agent：抽取方法结构；
- Repro Agent：分析代码和运行入口；
- Experiment Agent：设计 baseline 和消融；
- Debug Agent：定位报错；
- Runtime Agent：检查模型和任务状态；
- Decision Agent：建议下一步最小实验。

原则：Agent 输出必须写入项目空间和证据链，不能只停留在聊天记录里。

## 4. 阶段计划

### 阶段 0：项目治理

- [x] 建立 `AGENTS.md` 项目协作规则。
- [x] 建立 `PLAN.md` 长期计划和问题台账。
- [x] README 增加“AI 科创研发工作台”长期方向说明。
- [x] 建立 `DESIGN.md`，明确当前 UI 不作为最终参考，后续 UI 以未来科研工作台设计规范为准。

### 阶段 1：定位重构 MVP

- [x] 首页和导航从“PDF 翻译器”升级为“AI 科创研发工作台”表达。
- [x] 按 `DESIGN.md` 重建首页、导航和核心工作台布局，不以当前界面作为最终视觉参考。
- [x] 增加项目空间的数据结构和入口。
- [ ] 将论文库、研究表格、知识图谱、PDF 阅读、AI 问答关联到项目空间。
  - 2026-06-29 已完成入口级关联：项目空间首页可进入实验矩阵、证据图谱、论文库、PDF 阅读和组会输出，并从论文库生成项目快照。
  - 待完成深度关联：AI 问答、方法卡、实验矩阵和证据图谱输出需要写回项目空间实体。
- [x] 保持旧数据兼容，不破坏当前 localStorage 数据。

### 阶段 2：论文方法编译

- [x] 从 PDF 文本、图表 caption、用户笔记中生成方法卡。
- [x] 方法卡字段绑定证据来源。
- [ ] 支持多论文方法对比。
- [ ] 将方法卡写入研究表格或项目空间结构化数据。
- 2026-06-30 已建立 Paper-to-Method MVP 设计规格：`docs/superpowers/specs/2026-06-30-paper-to-method-mvp-design.md`。实现前以该规格为设计闸门，优先完成“方法卡 + 字段级证据链 + 人工确认 + 写回项目空间”的最小闭环。
- 2026-06-30 已完成方法卡数据与抽取核心：新增 `src/renderer/lib/methodCards.ts` 和单元测试，支持 PDF 文本、Figure / Table caption、阅读笔记到字段级 evidence source 的本地抽取；尚未接入三栏 UI、项目空间 hook 或研究表格写回。
- 2026-07-01 已新增 `src/renderer/hooks/useMethodCards.ts`，支持从 `pdfTranslationReader:methodCards` 读取方法卡并按当前项目过滤；方法卡审查 UI 和写回入口仍未完成。
- UI handoff：方法卡审查三栏 UI 由其他代理执行，本轮不修改 UI。后续 UI 应包含左侧章节 / 图表 / 公式证据列表，中间字段级方法卡编辑与确认，右侧 evidence locator、原文片段、置信度和写回位置；必须复用 `methodCards.ts` 和 `useMethodCards.ts`，不得新增不可追踪 AI 文案入口。

### 阶段 3：实验矩阵

- [x] 建立从方法卡派生实验矩阵的本地数据核心。
- [x] 在研究表格之外新增独立实验矩阵视图，允许与研究表格跳转，但不覆盖自由表格。
- [x] 支持 baseline / proposed / ablation / metric / seed / status 字段的核心数据结构。
- [ ] 提供 AI 生成实验设计，但必须要求用户确认。
- [ ] 支持导出 Excel / Markdown。
- 2026-06-30 已新增 `src/renderer/lib/experimentMatrix.ts` 和单元测试，可把证据绑定的 `MethodCard` 转换为 baseline / proposed / ablation 实验行，并生成独立 `实验矩阵` workbook；尚未接入 UI、项目空间持久化或导出入口。
- 2026-06-30 已建立 Paper-to-Experiment 证据驱动实验设计闭环规格：`docs/superpowers/specs/2026-06-30-paper-to-experiment-design.md`。实现前以该规格为闸门，优先完成“方法卡审查 UI + 实验矩阵独立页面 + 项目空间持久化 + Markdown/Excel 导出”的最小闭环。
- 2026-06-30 已建立 Paper-to-Experiment 第一批核心实现计划：`docs/superpowers/plans/2026-06-30-paper-to-experiment-core.md`。该计划先落地实验矩阵项目级持久化、安全合并、行编辑、Markdown 导出、workbook 导出和 `useExperimentMatrix` hook；UI 页面另行计划。
- 2026-06-30 已完成 Paper-to-Experiment 第一批核心能力：新增实验矩阵项目级持久化、重新生成安全合并、行编辑、Markdown 导出、workbook 导出和 `useExperimentMatrix` 存储 hook；尚未接入 UI 页面。
- 2026-07-01 已建立并执行独立实验矩阵页面计划：`docs/superpowers/plans/2026-07-01-experiment-matrix-page.md`。侧栏“实验矩阵”进入结构化实验设计页，侧栏“研究表格”保留 Univer 自由表格；页面支持项目摘要、实验组 / 状态 / 关键词筛选、高密度表格、右侧实验详情、状态切换和 Markdown 复制。Excel 文件导出入口未接入，仍只保留 workbook 核心能力。
- 2026-07-01 已建立并执行方法卡到实验矩阵桥接计划：`docs/superpowers/plans/2026-07-01-method-card-to-matrix-bridge.md`。实验矩阵页新增当前项目方法卡桥接摘要和“从方法卡合并”动作，只合并有证据定位的 baseline / proposed / ablation 实验行，并保留用户已编辑行。
- 2026-07-01 已优化 1366px / 1440px 实验矩阵桌面布局：主表保留实验组、论文、假设、方法和指标，状态与证据定位由右侧详情承载，减少底部横向滚动条对扫描体验的干扰。
- UI handoff：实验矩阵后续 UI 由其他代理执行，本轮不再改 UI。后续 UI 只接现有 `experimentMatrix.ts` / `experimentMatrixBridge.ts` 数据，不把研究表格伪装成实验矩阵；需要支持显式确认、编辑差异提示、Markdown / Excel 导出入口和运行状态列。

### 阶段 3.5：可持续运行 Demo

- [x] 提供无需打开 Electron UI 的小 demo，稳定展示论文证据到方法卡、实验矩阵和本地 seed 数据的闭环。
- 2026-07-01 已建立 headless research loop demo 实施计划：`docs/superpowers/plans/2026-07-01-headless-research-loop-demo.md`。目标命令为 `npm run demo:research-loop`，输出到 `demo-output/research-loop/`，用于评审、其他代理和后续自动化回归。
- 2026-07-01 已完成 `npm run demo:research-loop`：内置安全强化学习导航样例会生成字段级证据绑定方法卡、baseline / proposed / ablation 三行实验矩阵、Markdown 导出和 localStorage seed。`demo-output/` 已加入 `.gitignore`，避免把演示生成物提交进仓库。

### 阶段 4：本地 AI Runtime Center

- [ ] 设置页或独立页面展示 NLLB / Argos / pdf2zh / API provider 状态。
- [ ] 展示任务队列、缓存命中、失败日志。
- [ ] 增加环境检测命令和可复制修复建议。
- 2026-07-01 已完成阶段 4 实施计划：`docs/superpowers/plans/2026-07-01-runtime-center-mvp.md`。第一批实现应先做 Runtime Center 快照数据层、IPC、renderer helper 和 hook；UI 只消费 `runtime-center:snapshot` / `runtime-center:check`，不得自行探测环境或显示 API key。
- 2026-07-01 已完成阶段 4 第一批功能实现：新增 `src/main/runtimeCenter.ts`、`runtime-center:snapshot` / `runtime-center:check` IPC、`window.electronAPI.getRuntimeCenterSnapshot()` / `checkRuntimeCenter()`、`src/renderer/lib/runtimeCenter.ts` 和 `useRuntimeCenter`。快照只暴露 provider / baseURL / model / hasApiKey 等安全摘要，不暴露 API key、完整 prompt 或缓存内容；本轮不改 UI。
- UI handoff：Runtime Center 页面由其他 UI 代理接入 `useRuntimeCenter`，主区域展示 capability table、task queue 和 next actions，右侧 Inspector 展示故障详情与可复制修复命令。UI 不得重新调用 NLLB / pdf2zh 检查函数，也不得把 API key、完整 prompt 或缓存内容写入界面。

### 阶段 5：代码复现映射

- [ ] 支持导入本地代码仓库路径。
- [ ] 自动读取关键文件并生成技术栈总结。
- [ ] 识别最小运行入口、训练入口、评估入口。
- [ ] 支持粘贴报错日志并生成定位建议。
- 2026-07-01 已完成阶段 5 实施计划：`docs/superpowers/plans/2026-07-01-paper-to-code-mapping-mvp.md`。第一批实现应先做只读仓库扫描、manifest / entry / config 识别、项目空间链接、本地存储和方法卡到代码证据映射；严禁自动执行用户仓库代码。
- 2026-07-01 已完成阶段 5 第一批功能实现：新增只读 `scanCodeRepository`、`code-repository:select` / `code-repository:scan` IPC、`useCodeRepositories`、`buildPaperToCodeMapping`、`linkCodeRepositoryPath` 和 `npm run demo:code-repo`。扫描器会忽略 `.git`、`node_modules`、`dist`、数据集、模型、日志和 checkpoint 等目录，并且不会自动运行用户仓库代码。
- 2026-07-08 已完成阶段 5 第二批非 UI 功能：新增 `diagnoseReproductionLog`，支持把粘贴的复现失败日志解析为结构化 issue、证据行、相关入口文件、依赖清单、配置文件和下一步建议；`npm run demo:code-repo` 现在额外输出 `reproduction-diagnosis.json`。该能力只分析日志文本，不执行 `python`、`pip`、`conda` 或任何仓库脚本。
- 2026-07-09 已完成阶段 5 第三批非 UI 功能：新增 `buildReproductionRunPlan` 和 `renderReproductionRunPlanMarkdown`，把仓库扫描结果与日志诊断组合成 manual-only 复现运行计划；计划会区分 `environment-mutating`、`repo-execution` 和 `read-only` 命令，标记阻塞 issue、证据文件和人工确认要求；`npm run demo:code-repo` 现在输出 `reproduction-run-plan.json` 与 `reproduction-run-plan.md`。该能力仍然只生成计划，不执行任何命令。
- 2026-07-09 已完成阶段 5 第四批非 UI 功能：新增 `buildReproductionTaskPackage` 和 `renderReproductionTaskPackageMarkdown`，把方法卡、Paper-to-Code 映射、复现日志诊断、manual-only 运行计划和实验矩阵行合并成 15 分钟复现任务包；任务包会输出质量门、下一步动作、人工确认要求、被阻塞实验行和证据路径；`npm run demo:code-repo` 现在输出 `reproduction-task-package.json` 与 `reproduction-task-package.md`。该能力是可交接任务对象，不执行 `python`、`pip`、`conda`、`npm`、shell 脚本或 notebook。
- 2026-07-10 已完成阶段 5 第五批非 UI 功能：复现任务包新增 `readinessAudit`，按 `verified` / `assumption` / `blocked` / `missing` 审查方法卡、Paper-to-Code 映射、日志诊断、manual-only 运行计划和实验矩阵；同时输出人工确认负担、环境修改命令数、仓库执行命令数、阻塞步骤数、失败模式和验收标准；`npm run demo:code-repo` 的质量门现在要求样例能明确暴露阻塞与假设，而不是只生成任务包文件。
- UI handoff：Paper-to-Code 页面由其他 UI 代理接入 `selectCodeRepository`、`scanCodeRepository`、`useCodeRepositories` 和 `buildPaperToCodeMapping`。页面必须显示文件树摘要、manifest、entry command、smoke-test candidate、method-to-code mapping 和风险；不得自动运行 `python`、`pip`、`conda`、`npm`、shell 脚本或 notebook。

## 5. 当前已知风险

1. 当前项目仍以 PDF 翻译和论文工作台为主，产品叙事需要避免被评委理解成普通翻译器。
2. `src/renderer/App.tsx` 和 `src/main/main.ts` 文件较大，新增功能时容易继续扩大单文件复杂度。
3. 研究表格、论文库、AI 助手、知识图谱之间已有 localStorage 状态，迁移必须谨慎。
4. 本地模型和 Python sidecar 容易受 Windows 路径、CUDA、环境变量影响，需要可视化检测和失败恢复。
5. 任何 AI 输出都必须绑定证据来源，否则会退化为普通聊天工具。

## 6. 防重复犯错清单

- 不要把产品改造成“参赛材料生成器”；参赛材料只能是辅助输出，不是核心产品。
- 不要只改首页文案或增加入口来伪装转型；必须形成研发闭环。
- 不要把当前 UI 当作未来 UI 的参考基准；后续设计以 `DESIGN.md` 的科研工作台规范为准。
- 不要用装饰性卡片堆叠做首页或项目空间；顶层 pane 可以保留质感，但内部指标、行动和风险应优先使用行态、表格、时间线和分隔线。
- 不要把“减少卡片”误解为粗糙线框表格；需要同时保留清晰层级、克制阴影、合理留白和操作焦点。
- 不要大规模重构当前代码；优先小步迁移和兼容现有数据。
- 不要重复实现成熟开源库已有能力；先评估开源方案和 license。
- 不要让 AI 生成不可追溯结论；重要结论必须能回到 PDF、代码、实验或日志证据。
- 不要为了跑通演示而跳过错误、吞异常或删除核心逻辑。
- 不要在代码任务完成后只停留在测试或普通构建；必须运行 `npm run dist` 重建 Windows 安装包，确保可安装产物同步到最新源码。

## 7. 问题台账

| 日期 | 问题 | 根因 | 处理状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 2026-06-29 | 缺少项目级协作规则和长期计划文件 | 计划主要存在于聊天记录，后续容易脱离方向 | 已建立 `AGENTS.md` 和 `PLAN.md`，并把 `DESIGN.md` 加入固定入口 | 后续每次改动前先读 README、PLAN 和 DESIGN，并更新本文件 |
| 2026-06-29 | 当前 UI 质量不足，不能作为未来界面参考 | 早期界面围绕 PDF 翻译和功能入口堆叠，尚未形成 AI 科创研发闭环的统一设计系统 | 已建立 `DESIGN.md`，明确采用 IBM / Carbon + Mintlify + Supabase + Cursor 的组合参考 | 后续 UI 改造先按 `DESIGN.md` 设计项目空间、导航、实验矩阵、Runtime Center 和证据链页面 |
| 2026-06-29 | `visual:check` 仍按旧首页模块卡、旧按钮文案和旧 logo 样式检查 | 首页已迁移为项目空间工作台，视觉脚本仍耦合旧模块卡入口 | 已改为检查 research workbench 结构，并让研究表格场景按稳定侧栏 section 进入 | 后续 UI 改名时优先使用 data attribute / section，不依赖中文按钮文案 |
| 2026-06-30 | 首页视觉出现卡片式堆叠，去卡片后又一度变成粗糙线框表格 | 视觉约束只检查结构和横向溢出，没有把卡片密度、内部滚动、文字重叠和整体质感纳入对抗式审查 | 已把 AGENTS 写入 UI 修改后视觉对抗式审查规则；首页改为“研发流程看板 + Inspector”，只保留 4 张真实流程对象卡；`visual:check` 增加 Workflow Board、对象卡裁切和风险行裁切断言 | 后续 UI 修改必须人工查看 `.tmp-visual-check/` 截图，避免在“卡片堆叠”和“廉价线框”两个极端之间摆动 |
| 2026-07-01 | 首页和实验矩阵状态色仍有亮蓝、亮绿、亮黄塑料感 | 早期语义色直接使用高饱和 blue / green / yellow badge，实验矩阵主按钮也沿用亮蓝 CTA，和科研控制台气质不符 | 已把首页和实验矩阵主操作收敛为深石墨色，状态 badge 改为低饱和灰绿、雾灰蓝和蓝灰；右侧三段内容合并为单一 Inspector；`visual:check` 增加状态 badge 饱和度、单一 Inspector、流程卡文本重叠和实验矩阵主按钮 / badge 高饱和断言 | 后续状态表达优先使用低饱和底色、细边框、状态线和深色文字，不再用亮蓝/亮绿/亮黄或棕色旧纸感做默认状态块 |
| 2026-06-30 | 默认视觉检查一度被 PDF native 图像提取长任务阻塞 | `visual:check` 把 UI 布局回归和重型 PDF 图像提取功能验证绑在一起，导致 UI 改动被无关长任务卡住 | 已拆分默认 UI 视觉检查和严格 native 图像检查；默认模式验证 caption-only / 页面裁剪面板布局，严格模式使用 `VISUAL_CHECK_REQUIRE_NATIVE_FIGURES=1` | 后续需要专项验证 PDF 内嵌图像提取时再启用严格模式，并单独记录性能和失败原因 |
| 2026-06-30 | “研究表格升级为实验矩阵”容易被理解为把自由表格改名或替换 | 阶段计划表述不够精确，混淆了 Univer 自由工作簿和结构化实验设计层 | 已明确实验矩阵是从方法卡派生的独立 workbook / 视图，研究表格继续保留自由编辑用途 | 后续 UI 实现必须把实验矩阵作为项目空间的结构化实验层，不能破坏或覆盖现有研究表格 |
| 2026-07-01 | 实验矩阵详情面板人工复查发现 Evidence 与后续字段穿插 | 右侧详情用 CSS grid 的 `minmax(0, 1fr)` 限高承载字段列表，字段内容超过该行后与证据面板相互挤压，脚本只检查横向溢出未覆盖纵向穿插 | 已把详情面板改为纵向 flex 流式滚动，并把实验矩阵 eyebrow 收敛为中性灰；`visual:check` 输出 `.tmp-visual-check/experiment-matrix.png`，人工复查确认无重叠 | 后续右侧 Inspector / Detail 面板优先使用自然文档流 + 面板滚动，避免在可变文本列表上使用会截断内容的 grid 行高 |
| 2026-07-01 | 实验矩阵页面能展示已有行，但用户无法从当前项目方法卡触发生成 | 数据核心和页面之间缺少项目级方法卡读取与桥接动作，导致 Paper-to-Method 到 Paper-to-Experiment 闭环断开 | 已新增 `useMethodCards` 和 `experimentMatrixBridge`，页面显示方法卡数量、可合并行数和证据定位数，并通过现有安全 merge 合并 | 后续补方法卡审查 UI，避免用户只能依赖 localStorage 种子数据进入桥接 |
| 2026-07-01 | 侧栏选中态仍有高饱和紫蓝回潮，实验矩阵 1366px 表格底部横向滚动条影响质感 | 全局覆盖选择器一度挂在不存在的 `.app-sidebar` 祖先上，打包渲染仍命中旧 `.app-sidebar-link.active`；实验矩阵试图在 835px 表格 viewport 中展示全部字段 | 已把侧栏选中态收敛为石墨 / 蓝灰，并在 `visual:check` 增加 `sidebarActiveStyles.maxChannelDelta` 断言；实验矩阵在 1440px 以下隐藏表格状态 / 证据列，交给右侧详情显示 | 后续 App Shell 和主操作必须先过低饱和检查；桌面窄宽不要为了字段完整性牺牲首屏扫描体验 |
| 2026-07-01 | UI 与功能工作可能互相踩踏 | 多个代理会并行推进 UI 和功能；如果本轮继续改 UI，会增加冲突和重复视觉审查成本 | 本轮明确不改 UI 组件、样式和视觉脚本；只把 UI handoff 计划写入 `PLAN.md`，功能侧做 headless demo | 其他代理改 UI 前必须先读本文件、`README.md` 和 `DESIGN.md`，并围绕现有数据层接线 |
| 2026-07-01 | 阶段 4/5 如果直接做 UI，容易再次变成入口包装而非研发闭环 | Runtime Center 和 Paper-to-Code 都有 UI 表达需求，但真正不可压缩的核心是可验证数据对象：运行时快照、任务状态、仓库扫描结果和代码证据映射 | 本轮只完成两个阶段的实施计划，明确先实现数据层、IPC、hook、headless demo 和验证，再交给 UI 代理接线 | 后续执行阶段 4/5 时，必须先按计划写测试和纯函数数据模型；UI 不得绕过这些数据合同 |
| 2026-07-01 | `demo:code-repo` 首次未识别 `train_ppo.py` | scanner 初版只匹配 `train.py` 这类精确入口，未覆盖复现仓库常见的 `train_*` / `train-*` 命名 | 已按系统化调试添加 `train_ppo.py` 回归测试，并扩展入口命名规则；`npm run demo:code-repo` 重新通过，`qualityPassed=true` | 后续入口识别继续优先增加测试样例，不要只凭文件名猜测执行命令；仍禁止自动执行仓库代码 |
| 2026-07-10 | `npm run dist` 首次在 Vite renderer build 阶段内存分配失败 | `node.exe` 报 `memory allocation of 13122180 bytes failed`；同轮 `npm run build` 已通过，说明代码测试和类型检查不是根因，更像重复构建时的 Node heap / 瞬时内存压力 | 已使用 `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist` 重跑通过，并生成 `dist/PDF Translation Reader Setup 0.1.12.exe` | 后续若 `dist` 在 Vite transform 阶段出现同类内存错误，先带 `NODE_OPTIONS` 重跑；如频繁复现，再评估是否把 heap 参数固化到打包脚本 |

## 8. GitHub 开源复用扫描记录

| 日期 | 项目 | License / 风险 | 可复用方向 | 本项目处理 |
| --- | --- | --- | --- | --- |
| 2026-06-29 | `WangQrkkk/PaperQuay` | AGPL-3.0，不能在未接受 AGPL 传染要求前直接复制代码 | local-first AI 研究论文工作台、Agent 化论文管理、Electron + React + SQLite 产品形态 | 只参考产品结构和本地优先思路，不复制代码 |
| 2026-06-29 | `Future-House/paper-qa` | Apache-2.0，可作为后续 Python sidecar 候选 | 面向科学文献的 citation-grounded RAG / QA | 后续 Paper-to-Method 和证据问答阶段评估接入 |
| 2026-06-29 | `docling-project/docling` | MIT，可作为后续文档解析候选 | PDF / Office 文档结构化转换、版面解析、表格抽取 | 后续替换或增强 PDF 结构化抽取时优先评估 |
| 2026-06-29 | `renee-jia/scholar-loop` | MIT，偏研究工作流原型 | 文献阅读、实验、批判和写作循环的 autonomous research loop | 参考 workflow，不在第一阶段引入依赖 |

结论：第一阶段只落地项目空间数据模型和 UI 迁移，不引入新依赖。后续若进入 Paper-to-Method、Paper-to-Code 或证据 RAG，再优先评估 `paper-qa` 和 `docling` 这类 permissive license 项目。

## 9. 验证记录

| 日期 | 改动 | 验证命令 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-06-29 | 新增 `AGENTS.md`、`PLAN.md` | 未运行代码测试 | 文档-only 修改 | 需通过 `git diff` 人工检查 |
| 2026-06-29 | 新增 `DESIGN.md`，同步 README 和 PLAN 的 UI 设计方向 | `git diff -- README.md PLAN.md DESIGN.md`、`git status --short --branch` | 已检查 | 文档-only 修改，不触发代码构建 |
| 2026-06-29 | 首页和导航迁移为 AI 科创项目空间；新增项目空间快照模型；视觉检查改为验证 research workbench | `npm test -- src/renderer/lib/researchProjects.test.ts src/renderer/components/AppSidebar.test.ts src/renderer/components/HomePage.test.ts`、`npm run typecheck`、`npm run build`、`npm run visual:check` | 通过 | `npm run build` 已刷新 `dist-renderer` / `dist-electron`；`visual:check` 输出在 `.tmp-visual-check` |
| 2026-06-30 | `AGENTS.md` 增加代码任务完成后必须重建安装包原则 | `git diff -- AGENTS.md PLAN.md`、`git diff --check -- AGENTS.md PLAN.md` | 已检查 | 文档-only 修改，不运行代码测试、不重建安装包 |
| 2026-06-30 | 新增 Paper-to-Method MVP 设计规格，并登记为阶段 2 实现闸门 | `git diff --check -- PLAN.md docs/superpowers/specs/2026-06-30-paper-to-method-mvp-design.md`、`Select-String -Path docs\superpowers\specs\2026-06-30-paper-to-method-mvp-design.md -Pattern 'TBD|TODO|待定|未定|\?\?\?'` | 已检查 | 文档-only 修改，等待人工 review 后再进入功能实现 |
| 2026-06-30 | 新增 Paper-to-Experiment 证据驱动实验设计闭环规格，并登记为阶段 3 实现闸门 | `git diff --check -- PLAN.md docs/superpowers/specs/2026-06-30-paper-to-experiment-design.md`、`Select-String -Path docs\superpowers\specs\2026-06-30-paper-to-experiment-design.md -Pattern 'TBD|TODO|待定|未定|\?\?\?'` | 已检查 | 文档-only 修改，不运行代码测试、不重建安装包 |
| 2026-06-30 | 新增 Paper-to-Experiment 第一批核心实现计划 | `git diff --check -- PLAN.md docs/superpowers/plans/2026-06-30-paper-to-experiment-core.md`、`Select-String -Path docs\superpowers\plans\2026-06-30-paper-to-experiment-core.md -Pattern 'TBD|TODO|待定|未定|\?\?\?'` | 已检查 | 文档-only 修改，不运行代码测试、不重建安装包 |
| 2026-06-30 | 新增 Paper-to-Method 方法卡数据核心、证据抽取和序列化保护 | `npm test -- src/renderer/lib/methodCards.test.ts`、`npm run typecheck`、`npm run dist` | 通过 | 61 个测试文件、409 个测试通过；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`；本步无 UI 修改，未运行视觉检查；构建仍有既有大 chunk 和 Node deprecation warning |
| 2026-06-30 | 新增从方法卡派生实验矩阵的本地数据核心 | `npm test -- src/renderer/lib/experimentMatrix.test.ts`、`npm run typecheck`、`npm run dist` | 通过 | 62 个测试文件、412 个测试通过；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`；本步无 UI 修改，未运行视觉检查；构建仍有既有大 chunk 和 Node DEP0190 warning |
| 2026-06-30 | 新增 Paper-to-Experiment 第一批核心能力：项目级实验矩阵持久化、安全合并、行编辑、Markdown/workbook 导出和 `useExperimentMatrix` 存储 hook | `npm test -- src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.test.ts`、`npm run typecheck`、`npm run dist` | 通过 | 63 个测试文件、420 个测试通过；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`；本步无 UI 页面修改，未运行视觉检查；构建仍有既有大 chunk 和 Node DEP0190 warning |
| 2026-06-30 | 首页去卡片堆叠后的视觉精修、UI 对抗式审查规则、导师 caption 证据回填和视觉脚本默认/严格模式拆分 | `npm run build`、`npm run visual:check`、`npm run dist`、`$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`、`git diff --check` | 通过 | 首页截图输出 `.tmp-visual-check/home.png`；默认和打包产物视觉检查均通过；安装包输出 `dist/PDF Translation Reader Setup 0.1.12.exe`；严格 native 图像提取需单独用 `VISUAL_CHECK_REQUIRE_NATIVE_FIGURES=1` 验证 |
| 2026-06-30 | 首页改为研发流程看板 + 右侧 Inspector；视觉脚本增加 Workflow Board、对象卡裁切和风险行裁切断言 | `npm run typecheck`、`npm run build`、`npm run visual:check`、`npm run dist`、`$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check` | 通过 | 首页截图输出 `.tmp-visual-check/home.png`；人工审查确认 2x2 流程对象卡、右侧焦点/动作/风险完整可见，无横向溢出、内部滚动条、重叠、对象卡裁切或风险行裁切；安装包输出 `dist/PDF Translation Reader Setup 0.1.12.exe`；构建仍有既有大 chunk 和 Node DEP0190 warning |
| 2026-07-01 | 新增独立实验矩阵页面，拆分“实验矩阵”和“研究表格”入口，补充视觉脚本覆盖 | `npm test -- src/renderer/lib/experimentMatrixView.test.ts src/renderer/components/AppSidebar.test.ts src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.test.ts`、`npm run typecheck`、`npm run build`、`npm run visual:check`、`npm run dist` | 通过 | 64 个测试文件、424 个测试通过；`visual:check` 输出 `.tmp-visual-check/experiment-matrix.png`、`.tmp-visual-check/home.png`、`.tmp-visual-check/research-sheet.png`；人工复查发现并修复详情面板 Evidence 与字段穿插；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`；构建仍有既有大 chunk 和 Node DEP0190 warning |
| 2026-07-01 | 首页和实验矩阵低饱和视觉精修，降低亮蓝/亮绿/亮黄塑料感 | `npm test -- src/renderer/lib/experimentMatrixView.test.ts`、`npm run build`、`npm run visual:check`、`npm run dist`、`$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check` | 通过 | 64 个测试文件、424 个测试通过；首页截图 `.tmp-visual-check/home.png` 确认单一 Inspector、流程卡文本重叠 0、状态 badge 通道差 4/12；实验矩阵截图 `.tmp-visual-check/experiment-matrix.png` 确认主按钮通道差 12、badge 通道差 6/12、横向溢出限制在表格 viewport；安装包已重建为 `dist/PDF Translation Reader Setup 0.1.12.exe`；构建仍有既有大 chunk、package author 缺失、duplicate dependency references 和 Node DEP0190 warning |
| 2026-07-01 | App Shell 侧栏低饱和修正、方法卡到实验矩阵桥接入口和 1366px 实验矩阵表格视觉优化 | `npm run build`、`npm run visual:check`、`npm run dist`、`$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check` | 通过 | 66 个测试文件、430 个测试通过；视觉检查确认侧栏选中态 `maxChannelDelta=36`，首页无横向/纵向溢出，实验矩阵方法卡桥接摘要、右侧详情、主按钮和 badge 均通过；人工查看 `.tmp-visual-check/home.png` 和 `.tmp-visual-check/experiment-matrix.png`，确认实验矩阵底部横向滚动条已消失；安装包已重建为 `dist/PDF Translation Reader Setup 0.1.12.exe`；构建仍有既有大 chunk、package author 缺失、duplicate dependency references 和 Node DEP0190 warning |
| 2026-07-01 | 新增方法卡到实验矩阵桥接：项目级方法卡读取、候选行摘要和“从方法卡合并”动作 | `npm test -- src/renderer/hooks/useMethodCards.test.ts src/renderer/lib/experimentMatrixBridge.test.ts src/renderer/lib/experimentMatrix.test.ts src/renderer/hooks/useExperimentMatrix.test.ts`、`npm run typecheck`、`npm run build`、`npm run visual:check`、`npm run dist`、`$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check` | 通过 | 66 个测试文件、430 个测试通过；视觉检查确认实验矩阵方法卡桥接带显示 `1 张方法卡 · 可合并 3 行实验`，无页面横向溢出，按钮和 badge 保持低饱和；人工复查 `.tmp-visual-check/experiment-matrix.png` 和 `.tmp-visual-check/home.png` 未见重叠、截断或桥接带挤压；安装包已重建为 `dist/PDF Translation Reader Setup 0.1.12.exe`；仍有既有大 chunk、package author 缺失、duplicate dependency references 和 Node DEP0190 warning |
| 2026-07-01 | 新增 headless research loop demo：论文证据 -> 方法卡 -> 实验矩阵 -> Markdown / localStorage seed 的可持续运行闭环 | `npm test -- src/renderer/lib/researchLoopDemo.test.ts`、`npm run demo:research-loop`、`npm test -- src/renderer/lib/researchLoopDemo.test.ts src/renderer/lib/methodCards.test.ts src/renderer/lib/experimentMatrix.test.ts src/renderer/lib/experimentMatrixBridge.test.ts`、`npm run typecheck`、`npm run build`、`npm run dist` | 通过 | 67 个测试文件、433 个测试通过；`npm run demo:research-loop` 写出 `demo-output/research-loop/README.md`、`research-loop-summary.json`、`method-card.json`、`experiment-matrix.md` 和 `local-storage-seed.json`，质量门 `qualityPassed=true`、证据源 7 个、实验行 3 行；本轮不改 UI，未运行 `npm run visual:check`；工作树中存在其他代理的 UI/视觉改动，未纳入本次功能提交 |
| 2026-07-01 | 完成阶段 4 Runtime Center 和阶段 5 Paper-to-Code Mapping 的实施计划 | `git diff --check -- README.md PLAN.md docs/superpowers/plans/2026-07-01-runtime-center-mvp.md docs/superpowers/plans/2026-07-01-paper-to-code-mapping-mvp.md`、`Select-String -Path docs\superpowers\plans\2026-07-01-runtime-center-mvp.md,docs\superpowers\plans\2026-07-01-paper-to-code-mapping-mvp.md -Pattern 'TBD|TODO|待定|未定|\?\?\?'` | 已检查 | 文档-only 修改；未运行代码测试、`npm run build`、`npm run dist` 或 `npm run visual:check`。本轮不改 UI，不暂存其他代理的 UI/视觉改动 |
| 2026-07-01 | 完成阶段 4 Runtime Center 数据层和阶段 5 Paper-to-Code 映射核心实现 | `npm test`、`npm run typecheck`、`npm run demo:code-repo`、`npm run build`、`npm run dist` | 通过 | 74 个测试文件、447 个测试通过；`demo:code-repo` 输出 `demo-output/code-repository/repository-scan.json`、`repository-summary.md` 和 `paper-to-code-mapping.json`，质量门 `qualityPassed=true`；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`。本轮未改 UI 组件、样式或视觉脚本，未运行 `npm run visual:check`；工作树中仍有其他代理的 UI/视觉改动，不能纳入本轮提交 |

| 2026-07-08 | 新增 Paper-to-Code 复现失败日志诊断：`diagnoseReproductionLog` 和 `demo:code-repo` 诊断输出 | `npx vitest run src/renderer/lib/reproductionLogDiagnostics.test.ts`、`npm test`、`npm run typecheck`、`npm run demo:code-repo`、`npm run build`、`npm run dist` | 通过 | 75 个测试文件、449 个测试通过；`demo:code-repo` 输出 4 个文件，新增 `reproduction-diagnosis.json`，质量门 `qualityPassed=true`、`diagnosisStatus=blocked`、`diagnosisIssueCount=1`；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`。本轮未改 UI，未运行 `npm run visual:check`；仍有既有 large chunk、package author、duplicate dependency references 和 Node DEP0190 警告 |
| 2026-07-09 | 新增 Paper-to-Code manual-only 复现运行计划：`buildReproductionRunPlan`、Markdown 渲染和 `demo:code-repo` 运行计划输出 | `npx vitest run src/renderer/lib/reproductionRunPlan.test.ts src/renderer/lib/reproductionLogDiagnostics.test.ts`、`npm test`、`npm run typecheck`、`npm run demo:code-repo`、`npm run build`、`npm run dist` | 通过 | 76 个测试文件、451 个测试通过；`demo:code-repo` 输出 6 个文件，新增 `reproduction-run-plan.json` 和 `reproduction-run-plan.md`，质量门 `qualityPassed=true`、`runPlanStatus=blocked`、`runPlanStepCount=2`；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`。本轮未改 UI，未运行 `npm run visual:check`；工作区仍有其它 UI/动效改动未纳入本轮提交；仍有既有 large chunk、package author、duplicate dependency references 和 Node DEP0190 警告 |
| 2026-07-10 | 新增 Paper-to-Code 15 分钟复现任务包：`buildReproductionTaskPackage`、Markdown 渲染和 `demo:code-repo` 任务包输出 | `npx vitest run src/renderer/lib/reproductionTaskPackage.test.ts src/renderer/lib/reproductionRunPlan.test.ts`、`npm test`、`npm run typecheck`、`npm run demo:code-repo`、`npm run build`、`npm run dist` | 通过 | 77 个测试文件、454 个测试通过；`demo:code-repo` 输出 8 个文件，新增 `reproduction-task-package.json` 和 `reproduction-task-package.md`，质量门 `qualityPassed=true`、`taskPackageStatus=blocked`、`taskPackageChecklistCount=5`；`npm run dist` 已重建 `dist/PDF Translation Reader Setup 0.1.12.exe`。本轮未改 UI，未运行 `npm run visual:check`；工作区仍有其它 UI/动效改动未纳入本轮提交；仍有既有 large chunk、package author、duplicate dependency references 和 Node DEP0190 警告 |
| 2026-07-10 | 优化 Paper-to-Code 复现任务包可实现性审查：新增 `readinessAudit`、失败模式、验收标准和 demo 自检门槛 | `npx vitest run src/renderer/lib/reproductionTaskPackage.test.ts src/renderer/lib/reproductionRunPlan.test.ts`、`npm test`、`npm run typecheck`、`npm run demo:code-repo`、`npm run build`、`$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist` | 通过 | 77 个测试文件、454 个测试通过；`demo:code-repo` 输出 `taskPackageReadiness=blocked`、`taskPackageBlockedSteps=2`、`qualityPassed=true`；首次 `npm run dist` 在 Vite build 阶段出现 Node 内存分配失败，带 `NODE_OPTIONS` 重跑通过并重建 `dist/PDF Translation Reader Setup 0.1.12.exe`。本轮未改 UI，未运行 `npm run visual:check`；仍有既有 large chunk、package author、duplicate dependency references 和 Node DEP0190 警告 |

## 10. 2026-07-01 全局 UI 收口记录

### 设计决策

- 本轮不再争论“完全去卡片”或“全卡片”，而是采用克制工作台方案：顶层 pane 和真实对象卡片可以保留，但指标、状态、辅助队列和空状态不再拆成装饰卡片堆叠。
- 旧页面统一采用中性灰白画布、深石墨主按钮、低饱和 badge、灰蓝边框和克制阴影，避免蓝/绿/黄/紫塑料感回潮。
- 针对“全灰黑太单调”的问题，新增蓝灰、鼠尾草绿、雾灰蓝、石板灰和灰紫作为低饱和研究色相；这些颜色只承担页面方向、状态线、图谱节点、active 状态和轻量提示，不再做大面积塑料色块，也不再使用明显棕色作为默认强调色。
- arXiv 检索结果态的备选论文库改为摘要条，不展开列表，不遮挡结果卡片；空状态保留 3 条候选和 `+1 篇` 汇总，但去掉紫色渐变光晕。

### 视觉对抗式审查

- 自动检查：`npm run build` 已通过，74 个测试文件、447 个测试通过；`npm run visual:check` 已通过，并刷新 `.tmp-visual-check/`。
- 人工截图审查：已查看 `.tmp-visual-check/home.png`、`experiment-matrix.png`、`knowledge-graph.png`、`arxiv-search-results.png`、`settings-page.png`。
- 审查结论：未发现关键页面明显重叠、遮挡、横向溢出或高饱和蓝绿黄紫状态色回潮；知识图谱已刷新为低饱和节点色，设置页内部 active 导航不再是纯黑块，arXiv 结果态队列未遮挡卡片。
- 剩余风险：组会 PPT、论文导师和 PDF 阅读仍有较多面板与列表结构，后续可继续做组件级统一；Vite 大 chunk 警告仍为既有构建风险，不在本轮 UI 收口内解决。

### 安装包验证结果

- `npm run dist` 已完成，安装包输出为 `dist/PDF Translation Reader Setup 0.1.12.exe`。
- `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check` 已通过，打包产物内 UI 与本轮低饱和收口一致。
- 仍保留既有构建警告：Vite 大 chunk、`package.json` author 缺失、electron-builder duplicate dependency references、Node DEP0190。上述警告不影响本轮 UI 验证结果，但后续应单独治理。

## 11. 2026-07-08 克制动效系统记录

### 设计决策

- 本轮动效目标是“更明显但克制”：让页面切换、面板层级、按钮反馈、状态变化和知识图谱选中更清楚，但仍保持科研控制台气质。
- 不引入 GSAP。当前需求可用 CSS transition / keyframes 覆盖，引入 GSAP 会增加依赖、打包体积和 Windows 安装包风险；后续只有复杂时间线或拖拽编排再单独评估。
- 全局视图切换默认约 260ms，使用 fade + translate + 轻 scale；页面顶层 pane 使用 45ms / 80ms stagger，只作用于 opacity / transform / filter，不改变布局尺寸。
- Ready / Planned / Draftable 等状态 badge 只在 hover 或视图切换时出现一次性 sheen，不做持续闪烁。
- 知识图谱节点进入使用 circle 内部 scale-in，选中节点使用低饱和 halo 呼吸；不对 SVG `<g>` 直接改 CSS transform，避免覆盖节点坐标。
- 所有动效必须支持 `prefers-reduced-motion: reduce` 降级。

### 可视化预览

- 真实应用热更新预览：`http://127.0.0.1:5173/`，由 `npm run dev` 启动。
- 动效前后对比稿：`.superpowers/brainstorm/ui-motion-comparison/index.html`，本地服务地址 `http://127.0.0.1:8765/`。

### 视觉对抗式审查要求

- `visual:check` 已增加动效基线断言：检查 `prefers-reduced-motion`、`ft-view-enter`、`ft-panel-enter`、`ft-status-sheen`、知识图谱 `ft-node-pop` / `ft-graph-halo` 是否进入构建产物。
- 视觉审查仍必须人工查看 `.tmp-visual-check/home.png`、`experiment-matrix.png`、`knowledge-graph.png`、`arxiv-search-results.png`、`settings-page.png`，确认没有重叠、遮挡、横向溢出、布局抖动、高饱和回潮或持续闪烁。

### 待验证命令

```powershell
npm run build
npm run visual:check
npm run dist
$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check
```

### 剩余风险

- 静态截图无法完整证明 hover 触感和时间曲线质量，需要结合 `5173` 热更新预览和 `8765` 对比稿人工体验。
- 如果用户系统启用减少动画，视觉脚本会只验证规则存在，不强制计算样式保持 220ms-280ms。
- 组会 PPT、论文导师和 arXiv 仍可能存在局部旧样式 selector 覆盖，后续改动必须继续用视觉对抗式审查兜底。

## 12. 2026-07-08 首页卡片化工作台修正

### 设计决策

- 用户明确反馈“当前界面太丑，不行就把卡片弄回来”。本轮停止继续追求去卡片化，把首页修正为高级卡片化研发工作台。
- 中心区保留 4 张真实流程对象卡，但去掉“卡片里套厚重卡片”的笨重感：外层 board 承载结构，流程 lane 变轻，真正的研发对象卡负责视觉重点。
- 左侧项目概览和最近论文恢复柔和卡片层级；右侧 Current Focus / Next Actions / Decision Queue 保留 Inspector 语义，但内部改为更舒服的任务卡和风险卡。
- 视觉脚本不再用 `cardLikeCount > 8` 拦截首页，而是放宽到 24，并继续检查重叠、遮挡、裁切、横向溢出、高饱和回潮和动效规则是否存在。

### 待验证

- 需要重新运行 `npm run build`、`npm run visual:check`、`npm run dist` 和打包产物视觉检查。
- 人工重点查看 `.tmp-visual-check/home.png`：确认首页不再是灰条表格感，流程卡完整、右侧风险卡可读、底部命令条不挤压，1366px / 1440px 下无横向溢出。

## 13. 2026-07-09 arXiv 性能与动效修正

### 设计决策

- 本轮优先修复用户截图中的 arXiv 折叠详情问题：右侧详情折叠不能只隐藏内容并保留大块空白列，必须变成窄 rail，并让搜索区与结果区扩展到 rail 前。
- arXiv 结果卡增加克制动效：搜索状态细扫描条、结果卡 18ms stagger 进入、hover 低饱和层级变化、详情面板进入动画；不引入 GSAP。
- 结果卡使用 `content-visibility: auto` 和 CSS containment 做原生渲染性能隔离，降低每页 50 / 100 / 200 张卡片时的非可视内容布局压力。
- `visual:check` 新增 arXiv 折叠详情断言：自动点击“收起详情”，检查详情 rail 约 54px，且结果区宽度必须大于展开详情时的宽度。

### 已验证

- `npm run build`：通过，76 个测试文件 / 451 个测试通过，typecheck、renderer build、electron build 通过。
- `npm run visual:check`：通过，新增 `.tmp-visual-check/arxiv-search-detail-collapsed.png`；人工查看后确认折叠详情不再留下大白块，结果区扩展到 rail 前。

### 安装包验证

- `npm run dist`：通过，77 个测试文件 / 454 个测试通过，安装包输出 `dist/PDF Translation Reader Setup 0.1.12.exe`。
- `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`：通过，打包产物内 UI 的首页、arXiv 折叠详情、设置页和图谱页截图均已刷新。
- 仍有既有 Vite large chunk、`package.json` author 缺失、electron-builder duplicate dependency references 和 Node DEP0190 警告；不影响本轮 UI 验证，但后续应单独治理。

## 14. 2026-07-10 棕色强调色修正

### 设计决策

- 用户反馈棕色观感偏丑。本轮取消设置页、Planned 状态、arXiv 高优先级/收藏、PPT 预览和首页风险标签里的棕色旧纸感，把原 amber token 实际映射为冷调雾灰蓝 / 石板灰。
- 变量名暂不大规模重命名，避免牵动大量样式引用；语义上 `amber` 不再代表棕色，而是保留为“等待/计划/辅助强调”的低饱和冷调 token，后续可在集中清理 CSS token 时统一改名。
- `visual:check` 设置页场景新增 `warmBrownAccentValues` 断言，直接检查计算后的 RGB，防止 active nav、eyebrow、checkbox 等强调色回到低饱和棕色。

### 已验证

- `npm run build`：通过，77 个测试文件 / 454 个测试通过，typecheck、renderer build、electron build 通过。
- `npm run visual:check`：通过；设置页 `warmBrownAccentValues=[]`，active nav 为 `rgb(52, 65, 84)`，首页 Planned badge 为 `rgb(238, 242, 246)`；人工查看 `.tmp-visual-check/home.png`、`settings-page.png`、`arxiv-search-results.png`、`presentation-page.png` 和 `arxiv-search-detail-collapsed.png`，未见棕色回潮、重叠、遮挡或横向溢出。

### 安装包验证

- `npm run dist`：通过，77 个测试文件 / 454 个测试通过，安装包输出 `dist/PDF Translation Reader Setup 0.1.12.exe`。
- `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`：通过；打包产物内 `settings.warmBrownAccentValues=[]`，首页、设置页、arXiv 和 PPT 截图均已人工复查，未见棕色旧纸感回潮、重叠、遮挡或横向溢出。
- 仍有既有 Vite large chunk、`package.json` author 缺失、electron-builder duplicate dependency references 和 Node DEP0190 警告；不影响本轮 UI 验证，但后续应单独治理。

## 15. 2026-07-10 主界面工作台精修

### 设计决策

- 用户继续要求优化主界面，并指出首页在缩小窗口后会折叠、遮挡和需要过多滑动。本轮不再大幅改变产品信息架构，而是把首页收敛为“分段指标 + 真实流程对象卡 + 连续 Inspector”的研发 cockpit。
- 左侧项目 KPI 从四张小卡改为一个分段指标块，减少卡片式堆叠，同时保留扫描效率和项目状态感。
- 中心 Workflow Board 保留 Paper-to-Method、Paper-to-Code、实验矩阵和 Runtime Center 四张真实流程对象卡，增加低饱和流程轨迹、轻量 hover 层级和进入过渡；动效仍只使用 CSS，不引入 GSAP。
- 右侧 Inspector 压缩 Current Focus 的重复按钮，Next Actions 保证三条动作完整可见，Decision Queue 保留三条风险缺口；窄宽和矮窗口下优先压缩说明文字，不允许动作行被下一段标题裁切。
- `visual:check` 新增 `clippedNextActionCount` 断言，防止未来首页右侧“下一步”再次被裁切但脚本误判通过。

### 已验证

- `npm run build`：通过，77 个测试文件 / 454 个测试通过，typecheck、renderer build 和 electron build 均通过。
- `npm run visual:check`：通过；首页 `clippedNextActionCount=0`、`nextActionOverlapCount=0`、`clippedRiskCount=0`、`workflowCardTextOverlapCount=0`；人工查看 `.tmp-visual-check/home.png`，确认三条 Next Actions 和三条风险卡完整可见，无明显重叠、遮挡、横向溢出或棕色回潮。

### 安装包验证

- `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist`：通过，77 个测试文件 / 454 个测试通过，安装包输出 `dist/PDF Translation Reader Setup 0.1.12.exe`。
- `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`：通过；打包产物内首页 `clippedNextActionCount=0`、`nextActionOverlapCount=0`、`clippedRiskCount=0`，人工查看 `.tmp-visual-check/home.png` 确认左右三栏未折叠成上下堆叠，三条下一步和三条风险均在首屏可见。
- 仍有既有 Vite large chunk、`package.json` author 缺失、electron-builder duplicate dependency references 和 Node DEP0190 警告；本轮只记录，不在主界面精修中治理。

## 16. 2026-07-12 聚焦型 Research OS 全局设计重构

### 设计决策

- 用户选择大幅重构，第一批覆盖首页、全局侧栏与 App Shell、PDF 阅读器和 AI 助手，采用浅色优先方案。
- 设计方向确定为“聚焦型 Research OS”：当前科研任务优先，次要信息渐进披露，统一上下文栏、检查器、组件 token 和状态动效。
- Taste Skill 用于反模板化与视觉纪律；Impeccable 用于产品界面层级、状态、可访问性、响应式和跨页面一致性。
- 正式规格位于 `docs/superpowers/specs/2026-07-12-focused-research-os-design.md`。

### 当前状态

- 已完成需求收敛、三套视觉方向对比和方案 B 确认。
- 本轮仅写设计规格，尚未修改运行时代码、运行测试、重建安装包或执行视觉回归。
- 下一步在规格确认后编写分阶段实施计划，再按 App Shell、首页、PDF 阅读器、AI 助手和视觉收口顺序执行。
- 用户补充视觉偏好：允许紫蓝渐变、局部玻璃材质、柔和发光和更丰富的动效。规格已将动效强度从 5 调整为 7，但仍要求效果服务层级、状态或空间关系，避免所有面板玻璃化和无意义持续动画。

### 2026-07-12 实施结果

- 全局侧栏已按 Research OS 工作流重新分组，保留全部既有导航回调和本地运行状态。
- 首页、PDF 阅读器与 AI 助手新增统一语义类和蓝紫焦点材质；PDF.js、翻译、笔记、AI 请求和本地持久化逻辑未改动。
- AI 助手只有 `isBusy` 真实生成状态触发持续焦点动效，减少动画模式会立即降级。
- `npm run build` 通过：169 个测试文件、1043 个测试全部通过，TypeScript、renderer 和 Electron build 通过。
- `npm run visual:check` 通过；人工查看 `home.png`、`whole-pdf-reader.png` 和 `ai-assistant.png`，未发现重叠、遮挡、关键操作裁切或页面横向溢出。
- 视觉脚本修正了装饰性光晕被 `overflow-x: hidden` 裁剪时的假阳性；仅真实可见或可滚动的横向溢出才判失败。

## 17. 2026-07-15 iPhone 公网网页部署

### 第一性原理与设计决策

- 真实问题是让个人 iPhone 随时打开论文阅读器，而不是继续处理 iOS 签名、App Store 或要求 Windows 电脑常开。
- 最小闭环仍限定为论文库、arXiv 检索、PDF 阅读、英文段落下方内联中文翻译和选词翻译；账号、云同步、Android 与三端互通继续留在后续阶段。
- 采用 Vercel Hobby 托管独立 Vite 移动网页，并由单个 `/api/arxiv` Serverless Function 转发 arXiv Atom 检索。接口固定上游域名，只允许受限查询参数和最多 50 条结果，避免形成开放代理。
- arXiv PDF 改用无重定向且允许跨域的 `https://arxiv.org/pdf/<id>` 地址由 Safari 直接加载，避免把大 PDF 经由 Serverless Function 转发。
- PDF、论文元数据、阅读位置和译文仍存入当前浏览器的 IndexedDB / localStorage；翻译 API Key 只保留在页面内存。Vercel 不承担用户数据同步或密钥保存。
- 公网域名与原局域网地址属于不同浏览器 Origin，因此原局域网页中的论文库不会自动迁移到公网网址；首版接受重新导入 PDF，后续三端互通阶段再设计正式迁移与同步协议。

### 本轮验证状态

- 已新增 Vercel 构建配置、受限 arXiv 查询代理和参数校验测试；移动端 arXiv PDF URL 已改为浏览器直连。
- `npm run ios:sync` 已通过，最新移动网页资源已同步到 Capacitor iOS 工程；`npm run visual:check:mobile` 已通过并刷新 `.tmp-mobile-visual-check/`。
- 已人工查看论文库、arXiv、段落内联翻译和选词浮层截图；390px / 430px 宽度下未发现明显重叠、遮挡或横向溢出，中文译文位于对应英文段落下方，选词浮层只在选中文本后出现。
- `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dist` 已通过：81 个测试文件、468 个测试全部通过，TypeScript、renderer、Electron build 和 NSIS 安装包构建成功；安装包为 `dist/PDF Translation Reader Setup 0.1.12.exe`。
- 桌面 `npm run visual:check` 已执行但未形成全量通过：默认 15.6 MB 外部论文在 10 分钟门限内未完成；改用可控短 PDF 后首页、实验矩阵、研究表格和 PDF 阅读/图表页面完成截图，随后被组会 PPT 的内容质量门拒绝。人工复查本轮生成的 `home.png`、`whole-pdf-reader.png` 和 `whole-pdf-figures.png` 未见明显布局回归；本次代码未修改桌面 UI，但全量视觉门仍记为待恢复问题，不能声称通过。
- 已完成 Vercel OAuth、创建并关联 `xhunmanoid/ftranslate-mobile`，固定生产地址为 `https://ftranslate-mobile.vercel.app`。
- 首次部署暴露两项问题并已修复：仓库扫描范围过大时使用 `.vercelignore` 排除桌面安装包、iOS 工程、临时目录和工作树；Node 24 把保留 ESM import 的函数输出按 CommonJS 加载时，改用显式 `.mjs` 函数与共享校验模块。
- 公网实测通过：首页返回 200 并带 `nosniff` / `no-referrer`，`/api/arxiv` 返回 200 Atom feed 和论文条目，`max_results=200` 返回 400，POST 返回 405。
- 针对固定生产地址运行 `npm run visual:check:mobile` 已通过；人工复查 arXiv、段落内联译文和选词浮层截图，未发现明显布局回归。
- `npm audit --omit=dev --json` 显示生产依赖已知漏洞为 0；Vercel 完整安装日志中的 5 个漏洞来自开发/构建依赖，暂不自动执行可能破坏锁定版本的 `npm audit fix`。

### 2026-07-15 移动端对抗式审查修复

- 数据恢复：移动论文记录改为逐字段规范化，旧记录缺少作者、分类、时间或 PDF kind 时补安全默认值；不可恢复记录被隔离，不再把整个论文库拖入白屏。移动入口新增错误边界，未捕获渲染异常会显示保留数据的重载提示。
- 来源一致性：本地 PDF 保存 SHA-256 内容指纹，arXiv 保存带版本来源标识。同一来源重复保存保留页码、页数和双语 PDF；来源变化时重置进度并清空旧段落译文、解绑旧双语 PDF。
- 下载与导入边界：单个 PDF 上限 64 MB；网页 arXiv 下载支持取消、45 秒超时、Content-Length / Content-Type / 流式累计大小检查，并在写入前验证 `%PDF-` 文件头和 PDF.js 文档结构。根据 iPhone Safari 实测报错，网页 PDF 改由独立 IndexedDB 保存原始 `ArrayBuffer`，不再向 Capacitor Filesystem 写入 Safari 不支持持久化的 Blob URL；读取和删除仍兼容旧 Filesystem 数据。
- Safari 下载链路：iPhone 真机在修复 Blob 存储后继续报 `Load failed`，定位为生产网页仍直接请求 `arxiv.org`，不同论文的 CORS/重定向行为不一致。网页 PDF 地址现统一映射到当前 origin 的 `/api/arxiv-pdf/*`；Vite 本地代理和 Vercel 外部 rewrite 都只允许转发到固定 `https://arxiv.org/pdf/*`，并修正 `/api/arxiv` 抢先匹配 PDF 路径的路由顺序。
- 检索状态：新检索开始即清空旧结果，检索期间锁定查询与筛选输入，失败后保持空结果，不再把上一查询论文留在错误消息下方。
- 检索网关稳定性：生产实测 Atom 上游约 25.8 秒超时返回 502，立即重试还会触发 429，因此不再连续重试同一接口。公网代理现对查询词、分类、排序和结果数做边界校验后，单次请求 arXiv 官网搜索页面并转换为现有 Atom 数据结构；官网失败时返回明确的 503 与稍后刷新提示，不再只暴露 `HTTP 502`。
- 翻译缓存：缓存记录加入 Base URL；更换端点或模型后对应译文标记为待更新，“翻译本页”会重新生成。每个已有段落均显示“重新翻译”入口，移除 600 条静默淘汰上限，并显示批量翻译成功/失败统计。
- arXiv 翻译：检索结果新增“译标题”和“译摘要”，共用阅读器的 OpenAI 兼容翻译设置；中文结果直接显示在对应英文下方，并随论文一起存入本地论文库。未配置 API Key 时点击翻译会先打开设置，保存后继续原请求。
- 检索会话连续性：`MobileArxivScreen` 在底部导航切换和进入阅读器时保持挂载，仅隐藏界面，因此查询词、结果、卡片译文和滚动位置不会因返回论文库或阅读器而丢失；完整网页刷新仍按当前本地 MVP 边界重新建立检索会话。
- 论文库管理：移动论文记录新增独立 `customTitle` 与规范化 `tags`，管理面板支持改名、最多 12 个标签和删除；自定义信息参与本地检索、重复保存同一来源时保留，且不覆盖原始标题。Safari 删除改为一次读取 IndexedDB 键后批量删除，避开游标事件回调异常；论文索引先移除、文件随后清理，文件清理失败只提示残留风险，不再让论文卡在列表中。
- 原始 PDF 模式：移动入口不会加载桌面 `global.css`，此前 PDF.js 依赖的 `.pdf-js-viewer-container { position: absolute }` 只存在于桌面样式；Chromium 在容器尚未进入布局时偶然绕过构造检查，而 iPhone Safari 切换到“原始 PDF”会稳定抛出 `The container must be absolutely positioned`。移动 CSS 现明确设置相对定位外壳、绝对定位滚动容器和四边 `inset: 0`；视觉脚本会真实切换到原始 PDF、等待 canvas 渲染并检查计算样式。
- 阅读性能：共享 `PdfViewer` 只在调用方需要提取结果时解析全文，移动端切换原始 PDF 不再重复执行第二次无消费者的全文抽取；选词浮层增加视口高度约束。
- 验证已收口：`npm run dist` 通过（83 个测试文件、484 项测试；TypeScript、桌面生产构建、Windows NSIS 安装包均成功），`npm run ios:sync` 成功；本地和生产地址的 `npm run visual:check:mobile` 均通过。生产 `/api/arxiv` 实测返回 200、`official-search` 和 20 篇结果，首篇完整摘要为 1,433 字符；线上对抗脚本确认可恢复旧记录、标题中文紧邻英文显示、在论文库与检索页之间往返后查询词、20 条结果和标题译文保持一致、失败检索清空 20 条旧结果，并把真实 arXiv PDF 经生产同源代理下载、写入 IndexedDB、读回后打开阅读器。论文管理面板完成改名与 3 个标签保存，删除后对应 IndexedDB PDF 键不存在；段落内嵌翻译和旧配置重译也正常。新增原始 PDF 专项回归已在生产地址实际点击模式开关、等待 PDF canvas 渲染，并确认 viewer 外壳计算样式为 `relative`、滚动容器为 `absolute` 且四边 `0px`。视觉审查的 390px 宽页面 `bodyScrollWidth` / `rootScrollWidth` 均为 390，无裁切项；原始 PDF 截图为 `.tmp-mobile-visual-check/03a-reader-original-pdf-390x844.png`。生产部署 `dpl_DqzBp4Jmivt6dqStJTHewZ9VJ8yV` 已绑定 `https://ftranslate-mobile.vercel.app`。剩余验证仅为 iPhone Safari 真机强制刷新后再切换一次“原始 PDF”，确认 WebKit 实际环境与自动化浏览器一致。

### 2026-07-15 连续双语阅读与手机 PDF 缩放

- 第一性原理：手机阅读的核心不是导入另一份“双语 PDF”，而是用户只上传普通 PDF，就能得到适合单手纵向滚动的英文段落—中文译文连续文章；原 PDF 只承担公式、图表与版式核对，但必须能真正放大看清。
- 阅读流改造：移除移动阅读器的“双语 PDF”模式和显眼导入入口；“段落双语”改为“连续双语”，不再按当前页分页渲染，而是按原页序显示全文段落、页分隔线并随滚动更新阅读页码。自定义论文名也同步用于阅读器标题。
- 翻译闭环：增加“翻译全文/翻译剩余”和“停止”，中文结果逐段保存后直接排在英文下面；接口失败或用户停止时保留已成功部分。未配置 API Key 时先打开会话设置，保存后自动继续原全文或单段任务；已有缓存仍按 Base URL 与模型判断是否需要更新。
- 原 PDF 能力：共享 `PdfViewer` 增加双指距离缩放与缩放锚点；移动工具栏提供适宽、减小、百分比、放大和“双指缩放”提示。适宽比例由实际容器宽度、当前页面渲染宽度与比例计算，不依赖固定 iPhone 尺寸。
- 自动验证：`pdfInteraction.test.ts` 新增双指比例、上下限和适宽计算测试；`npm run dist` 通过（83 个测试文件、486 项测试），TypeScript、桌面生产构建和 Windows NSIS 安装包均成功。`npm run ios:sync` 通过。移动视觉脚本实际改变缩放比例、确认触摸缩放类与 `touch-action`、检查原 PDF 容器定位，并断言中文块位于对应英文块下方且阅读模式仅有两个；脚本同时覆盖无 API 配置先设置和已有配置直接翻译两条路径。
- 视觉对抗式审查：人工查看 `.tmp-mobile-visual-check/03-reader-inline-translation-390x844.png`、`03a-reader-original-pdf-390x844.png` 和 `03b-reader-stale-translation-390x844.png`。390px 下未发现页面级横向溢出、按钮遮挡或译文弹窗；放大后的 PDF 横向滚动被限制在 viewer 内。剩余真机风险是 Safari 对 React 双指 `touchmove` 的手势细节仍需实际两指操作确认。
- 公网发布：Vercel 生产部署 `dpl_4PCUguAcSr44NZxtoX8jCa4thyRx` 已重新绑定 `https://ftranslate-mobile.vercel.app`。固定生产地址的完整移动检查通过：arXiv 20 条结果、中文标题、导航状态保留、真实 PDF 下载入库、原 PDF 缩放控件、连续全文翻译、旧配置提示、改名标签和 IndexedDB 删除闭环均成功。

### 2026-07-15 扫描 PDF 本地 OCR 兜底

- 根因：用户真机导入的 PDF 没有可提取文字层。PDF.js 能正常显示页面，但 `getTextContent()` 返回空，原“连续双语”只能显示提示，无法形成上传普通 PDF 后直接阅读的闭环。
- 设计修正：最初采用图片模型直接识别并翻译，但用户实际使用 DeepSeek 纯文本模型，该路径不成立。现改为 PDF.js 在当前浏览器把页面渲染为最长边约 1800px 的 JPEG，由随应用提供的 Tesseract.js worker、WASM 核心和英文数据在手机本地 OCR；随后仅把识别出的纯文字交给现有 DeepSeek 翻译函数。页面图片不发送给 DeepSeek、FTranslate 或 Vercel。
- 实现：`mobileLocalOcr.ts` 负责受控页面渲染、单 worker 连续逐页 OCR、版面段落优先提取、断行/行尾连字符修复、稳定段落哈希和缓存恢复。每页先用 `origin: ocr` 和空译文保存识别原文，再调用 `translateAcademicText` 生成中文并覆盖同一记录；这样 DeepSeek 失败时原文仍保留，之后可用“翻译剩余”继续。旧 `origin: vision` 缓存仍可读取，现有 `visionOcrLastPage` / `visionOcrCompleted` 字段作为兼容数据继续保存进度。
- 数据一致性：修复 `MobileApp` 连续保存多个段落时闭包捕获旧 `translations` 的问题，改用最新缓存引用累积合并；否则全文翻译或一页 OCR 返回多个段落时，后写入项可能覆盖前项。来源 PDF 变化时 OCR 页码与完成状态一并失效。
- 专项验证：`mobileLocalOcr.test.ts` 覆盖 OCR 断行与行尾连字符修复、版面段落优先、标题/图注分类、稳定顺序、旧缓存兼容和移动渲染上限；移动视觉脚本注入本地 OCR 文本并让 DeepSeek mock 明确拒绝图片请求，断言图片请求为 0、纯文本请求至少 2 次，同时验证生成 2 个双语段落和退出重开恢复。真实浏览器 OCR 冒烟使用运行时生成的纯图片 PDF，首次暴露 Tesseract.js 7 直接传语言二进制会在初始化 100% 后卡住，改为固定同站 `assets/ocr/eng.traineddata.gz` 的标准 `langPath` 后通过，实际识别出 `VISION SAFETY POLICY` 和完整正文。人工查看 `.tmp-mobile-visual-check/08a-reader-scanned-pdf-390x844.png` 与 `08b-reader-scanned-bilingual-390x844.png`，未见遮挡、横向溢出或弹窗式段落译文。
- 全量验证：本地 OCR 修正后的 `npm run dist` 通过（84 个测试文件、492 项测试），TypeScript、renderer/Electron 生产构建和 Windows NSIS 安装包均成功；`npm run ios:sync` 通过，约 7 MB 的同站 OCR worker、英文数据与 WASM 核心连同移动资源、3 个 Capacitor 插件同步到 iOS 工程；最终 `npm run visual:check:mobile` 通过，`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。图片预览器曾把 `08b` 正文下方误显示为黑块，直接读取 PNG 对应区域的 RGBA 像素为不透明 `#f8fafc`，确认实际产物没有黑色空区。
- 公网发布：本地 OCR 与“连续双语”点击修正版最终由 Vercel 生产部署 `dpl_6whh1Hch2J5MJQiFUzhSd5QbJwbv` 绑定固定地址 `https://ftranslate-mobile.vercel.app`。公网逐项确认 worker（111,307 bytes）、英文数据（2,952,873 bytes）和 WASM 核心（3,896,484 bytes）均返回 200；针对带缓存破除参数的固定地址再次运行完整移动检查通过：真实 arXiv 检索与 PDF 同源下载、IndexedDB 保存、连续段落翻译、“原始 PDF → 连续双语”直接启动本地 OCR、DeepSeek 纯文本翻译、退出重开缓存恢复、改名标签和删除闭环均成功。
- 真机无响应修复：旧图片模型版本可能给论文留下 `visionOcrCompleted: true` / `visionOcrLastPage`，但没有任何 OCR 段落；连续双语此前错误信任该标记，形成 `0 / 0` 空白页，且继续识别会从旧页码之后开始。现以“存在可恢复 OCR 段落”为完成标记生效前提，零段落状态强制从第 1 页重新识别；直接段落提取抛错也进入本地 OCR 兜底。从“原始 PDF”点击“连续双语”会立即启动本地 OCR 或打开翻译设置。专项单元测试覆盖旧完成标记与有效断点两种状态，移动视觉脚本已实际执行“原始 PDF → 连续双语”点击并生成 2 个上下排列的双语段落。
- 本轮验证：84 个测试文件、494 项测试全部通过，TypeScript、桌面 renderer/Electron 生产构建、移动构建和 `npm run ios:sync` 均通过；本地与固定生产地址的 `npm run visual:check:mobile` 均通过，人工复查扫描识别前后截图未见新增遮挡或横向溢出。`npm run dist` 首次在 NSIS 阶段因 C 盘只剩约 0.08 GB、无法创建 164,576,304-byte mmap 而失败；没有删除用户文件，改将 `TEMP` / `TMP` 指向项目内 `.tmp-electron-builder` 后，electron-builder、NSIS 安装包和 block map 均成功生成。`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。

### 2026-07-15 小说式连续双语阅读

- 用户反馈与根因：旧界面虽然实现英文下方紧跟中文，但 14px 正文、英文两端对齐、页分隔线、蓝色译文结构线、标签和每段常驻“重译”按钮仍像调试工作台；长英文在窄屏被拉出异常词间距，无法达到“像刷小说一样阅读”的目标。
- 视觉与交互修正：正文改为白底、英文 21–24px 衬线体、中文 20–23px 无衬线体和自然左对齐；删除正文卡片边界、页分隔线、蓝色结构线及已完成译文的标签/按钮，只在缺失、过期或正在翻译的段落保留恢复操作。向下滚动超过阈值后自动隐藏标题、模式、处理工具栏和底部状态，上滑或回到顶部恢复，原始 PDF 模式不受影响。
- 对抗式视觉回归：移动视觉脚本用一组真实长度的英文/中文安全抓取段落检查 390×844 与 430×932，自动断言正文字号不低于 20px、两种语言均非 `justify`、没有正文边框/左侧线/页分隔/标签/已完成段落按钮、沉浸模式四组界面栏确实隐藏、恢复后页面无横向溢出。截图输出为 `.tmp-mobile-visual-check/08b-reader-scanned-bilingual-390x844.png`、`08c-reader-scanned-immersive-390x844.png` 和 `08d-reader-scanned-novel-430x932.png`。
- 全量验证：项目内临时目录承载 electron-builder 后，`npm run dist` 成功完成 84 个测试文件、494 项测试、TypeScript、桌面 renderer/Electron 构建和 Windows NSIS 安装包；`npm run ios:sync` 成功同步移动资源与 3 个 Capacitor 插件；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。本地与公网移动视觉检查均通过。
- 公网发布：Vercel 生产部署 `dpl_EzSp3SifWg414ne9EB8BE77AqKbj` 已绑定 `https://ftranslate-mobile.vercel.app`。带缓存破除参数 `?v=20260715-novel-reader` 的固定地址返回 200，并通过真实 arXiv 检索、标题翻译与状态保留、PDF 同源下载入库、原始 PDF、连续双语、本地 OCR、DeepSeek 纯文本翻译、缓存恢复、改名标签和删除闭环。

### 2026-07-15 紧凑字号与 OCR 前页恢复

- 真机反馈：21–24px 英文和 20–23px 中文在 iPhone 上仍过大；扫描论文处理到第 3 页时前页看似消失，退出阅读器或切换原 PDF 后正文也会丢失。
- 根因：阅读器由 `view === 'reader'` 条件挂载，返回论文库会直接卸载其 `blocks` 和滚动状态；同一论文重新打开会重新读取 PDF 并重建阅读器。OCR 虽逐段保存，但整页包含十余段时会反复覆盖整份 JSON，且缺少按论文串行写入与重新打开前的写入等待。Safari 对不断插入的译文还会应用滚动锚定，把视口推向后页，使前页更像被删除。
- 修复：阅读器与检索页一样在会话内保持挂载，同一论文从论文库或底部“阅读”返回时直接复用原组件；原始 PDF/连续双语切换恢复双语滚动位置。每页 OCR 原文一次性批量进入缓存，译文更新使用按论文隔离的内存快照和 Promise 写入队列；重新读取前等待该论文未完成写入。`translations` 每次变化都会重新从持久化结构恢复完整 OCR 块列表，并关闭正文滚动锚定。
- 字号：英文和中文正文统一降至 17–19px，标题降至 21–24px，图注为 15–17px；仍保持白底、英文衬线、中文无衬线、自然左对齐与下滑沉浸模式。
- 回归：移动脚本生成三页扫描 PDF，第 2 页仍延迟处理中时切到原 PDF、切回、退出阅读器并从底部“阅读”返回，断言第 1 页仍存在；三页完成后整页 reload，再从 IndexedDB 恢复第 1–3 页共 6 个双语块。390×844 与 430×932 同时断言正文计算字号在 16.5–20px、无横向溢出、无两端对齐和常驻段落按钮。
- 对抗式补强：常驻阅读器首次使视觉脚本在论文库里误选隐藏的旧阅读器，现所有 PDF 操作限定到未隐藏的活动层，并在刷新后等待目标论文行完成异步加载。差异审查还发现同一 arXiv ID 更新源文件时可能误走快速返回，现快速返回同时校验 `sourceRevision` / `contentHash` 源文件指纹，不会复用旧 PDF 内存。
- 旧缓存缺页迁移：最终审查发现旧版本可能只成功落盘第 3 页，却留下 `visionOcrLastPage: 3`；仅按最高页码续跑会永久跳过第 1–2 页。现断点计算改为合并“实际存在的 OCR 缓存页”和新版 `visionOcrProcessedPages`，从第一个缺页续跑；每个完成 OCR 的页面都会写入已处理页集合，空白页也不会被反复识别。专项测试覆盖“只剩第 3 页从第 1 页恢复”“连续 1–3 页从第 4 页继续”和“空白页显式覆盖”三种情况。
- 全量验证：`npm run dist` 通过（84 个测试文件、497 项测试、TypeScript、桌面 renderer/Electron 和 Windows NSIS 安装包）；`npm run ios:sync` 同步最新移动资源和 3 个 Capacitor 插件；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。本地与最终生产地址的移动回归均通过。
- 公网发布：最终 Vercel 部署 `dpl_6jeMe7tr2Yxb96wZtLAbKBRTXQnF` 已绑定 `https://ftranslate-mobile.vercel.app`。带缓存参数 `?v=20260715-ocr-gap-recovery-final` 通过真实 arXiv 检索/PDF 入库、OCR 中途切换与退出恢复、三页完成后整页刷新恢复 6 个双语块、紧凑字号、改名标签和删除闭环；首缺页迁移由专项单元测试覆盖。

### 2026-07-16 本机完整缓存与 OCR 段落完整性

- 用户要求：API Key 与 Base URL/模型一起缓存；导入 PDF、OCR 原文和译文在退出或刷新后继续存在；OCR 不能把一个单词或一个原文段落拆成多个双语块。
- 根因：`saveTranslationPreferences` 只序列化 Base URL 与模型，主动丢弃 API Key；OCR 只要拿到 `blocks[].paragraphs` 就无条件优先使用，部分扫描页返回“一词一个 paragraph”时会直接生成大量碎片翻译。
- 实现：翻译配置本地记录升级为 `baseURL + model + apiKey`，兼容没有 Key 的旧记录，清空 Key 后保存即可删除；网页启动时申请持久存储。导入/arXiv PDF 继续以 IndexedDB `ArrayBuffer` 保存，OCR 原文与译文继续按论文串行落盘。OCR 新增碎片质量判断：版面段落明显过碎且与整页文本一致时使用整页自然段；跨段的 `inter-` + `action` 会重连为 `interaction`，只有整页文本同样无法提供结构时才保守合并碎片。
- 安全边界：API Key 不上传 FTranslate/Vercel，但浏览器 Preferences 不是 iOS Keychain；共享设备不应保存。清除 Safari 网站数据仍会删除论文库、PDF、译文和 Key，当前版本不提供账号或云同步。
- 回归：单元测试覆盖 Key 的序列化、旧配置迁移、损坏配置回退、一词一段回退与跨碎片断词修复；移动视觉脚本把第 1 页 OCR 版面故意拆成逐词结果，并在整页 reload 后检查导入 PDF、每页两个完整双语段落及 `visual-key` 均恢复。
- 视觉对抗式审查：`npm run visual:check:mobile` 在沙箱外真实 Electron 中通过；人工检查 `.tmp-mobile-visual-check/08b-reader-scanned-bilingual-390x844.png`、`08d-reader-scanned-novel-430x932.png`、`03-reader-inline-translation-390x844.png` 与 `06-library-paper-managed-390x844.png`，未发现单词独立成段、原文/译文错位、按钮遮挡、横向溢出或字号重新膨胀。测试运行器显式关闭硬件加速，避免受限 Windows 会话的 GPU 子进程干扰视觉回归。
- 完整验证：`npm run build` 与 `npm run dist` 通过（84 个测试文件、501 项测试、TypeScript、桌面 renderer/Electron 与 Windows NSIS 安装包）；`npm run visual:check`、`npm run visual:check:mobile` 通过；`npm run ios:sync` 已把最新移动资源同步至 iOS 工程；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。`npm run dist` 首次在受限沙箱内因 `rcedit-x64.exe: Access is denied` 失败，移出沙箱后同一命令成功，确认不是源码或安装包配置错误。
- 公网发布：Vercel 生产部署 `dpl_GxyM7FmcTeDRjVgX1nkcHmbLwGDW` 已重新绑定 `https://ftranslate-mobile.vercel.app`。直接对固定生产地址运行移动回归，完成真实 arXiv 检索/PDF 下载入库、逐词 OCR 伪输入纠错、退出切换、整页刷新后恢复原 PDF、6 个双语块与 `visual-key`，全部通过。

### 2026-07-16 导入后全文 OCR 与手动全文翻译分离

- 用户最终确认的交互是：导入或保存 PDF 后立即在当前设备后台 OCR 所有页面，但导入阶段不翻译；只有进入阅读页并明确点击“全文翻译”后，才调用 DeepSeek/OpenAI-compatible 纯文本接口。
- 实现：`MobilePaper` 新增带版本的本地 OCR 状态；应用级单任务队列逐篇、逐页 OCR，识别完一页即替换并保存该页原文，再写入页数和已处理页集合。任务不依赖阅读器挂载，切换原 PDF、退出阅读器或进入其他入口仍继续；旧版缓存会按 OCR 版本迁移并从实际首个缺页恢复。
- 翻译边界：后台 OCR 路径不读取 API Key，也不调用翻译函数。阅读器仅在 OCR 状态为完成且用户点击“全文翻译”后，按页排序、页内逐段翻译；每段立即落盘，因此每页完成时该页结果已经完整缓存，中止或失败不会丢失前页。
- 段落修复：过滤 `EE` 等 1–3 字母孤立大写标签、纯页码和 `age manipulation of` 这类无结束标点的短小写裁断片段；保留合法标题、公式、图注，并继续使用整页文本纠正“一词一段”和行尾连字符。
- UI：论文库显示“等待 OCR / 正在 OCR / OCR 已完成 / OCR 失败”；OCR 完成且尚无译文时显示“翻译全文”，不再为每个原文段落放置常驻翻译按钮。阅读器明确提示 OCR 阶段不调用 DeepSeek。
- 自动验证：新增 OCR 噪声过滤、OCR 页替换和状态迁移测试；`npm run build` 通过（84 个测试文件、503 项测试）。先执行 `npm run build:mobile` 后，`npm run visual:check:mobile` 通过，并明确断言扫描 PDF 导入 OCR 前后翻译请求数保持不变、切换/退出后 3 页 6 个原文块仍恢复、点击“全文翻译”后才新增 6 次纯文本请求、图片请求始终为 0。
- 视觉对抗式审查：人工检查 `.tmp-mobile-visual-check/08a-reader-scanned-ocr-running-390x844.png`、`08b-reader-scanned-ocr-only-390x844.png`、`08b-reader-scanned-bilingual-390x844.png` 和 `06-library-paper-managed-390x844.png`；正文保持 17–19px 小说式流式排版，无 `EE`、纯页码或短裁断片段独立成段，无段落按钮、横向溢出和模式切换白屏。检查发现翻译完成状态会被 OCR 完成提示覆盖，已移除错误依赖并改为保留翻译完成状态。
- 桌面视觉：`npm run visual:check` 首次因 CDP `Runtime.evaluate` 瞬时超时退出；确认无残留 Electron/Node 进程后同一命令重跑通过，未发现本次移动改动破坏桌面页面。
- 交付验证：`npm run dist` 通过，Windows NSIS 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,166 bytes，SHA-256 为 `DF15C14B12FDC25C8090FA778D2F2365FEAED5D1E58E00D99D6B5A3E43E0E0CB`；`npm run ios:sync` 通过，最新移动网页和 3 个 Capacitor 插件已同步到保留的 iOS 工程；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。
- 公网发布：Vercel 生产部署 `dpl_5dWgyBK6gSSk6Atwr52oJR9nT2iJ` 已重新绑定固定地址 `https://ftranslate-mobile.vercel.app`。对该固定地址带版本参数执行完整移动回归通过，包含真实 arXiv 检索、同源 PDF 下载入库、导入 OCR 零翻译请求、点击全文翻译后 6 次纯文本请求、退出和整页刷新恢复。

### 2026-07-16 论文首页 OCR 准确率与 AI 重排兜底

- 真机反馈：大图、长图注和双栏摘要共存的论文首页出现 `stem`、`mul :`、`ight-tolerance`、`pre` 等明显错字与裁断，图中文字还被混入连续正文。
- 根因不是单个字符串，而是旧管线对所有 PDF 一律把整页压到最长边 1800px 的 JPEG 后交给 Tesseract，并丢弃 OCR 坐标、置信度和文字块类型；同时既有文字层重排没有把行内 `Abstract—` 传播到右栏，浮点基线微小漂移还会误删同一行的右栏内容。
- 分层修复：每页先读取 PDF 文字层，按坐标恢复双栏并过滤摘要前的作者单位/图注噪声；无可靠文字层才使用最长边约 2600px 的 PNG、300 DPI Tesseract 参数以及坐标/块类型/置信度重排。OCR 缓存版本升级为 4，旧错误结果会自动重新处理。
- AI 边界：导入阶段仍不读取 API Key、不调用 DeepSeek。只有用户点击“翻译全文”且该页确实来自 OCR 时，才以一页一次请求执行保守校对、自然段重排和中文翻译；文字层页只翻译，不允许 AI 改写英文。JSON 结果要求英文—中文段落一一对应，提示词明确禁止补写输入中不存在的内容。
- 真实复现：下载官方 arXiv `2604.13015v1`，第一页 PDF.js 可读取 113 个文字项。修复前重排会混入图注残片并把摘要右栏归到作者单位；修复后第一页输出为一个完整 `Abstract` 段，左右栏顺序正确，图注/单位不再进入小说式正文，`whole-body` 与标点空格也被正确恢复。
- 完整验证：新增混合首页双栏、浮点基线漂移、科研复合词、OCR 坐标排序、图片块过滤和 AI JSON 兜底测试；`npm run build` 与 `npm run dist` 均通过（84 个测试文件、509 项测试，TypeScript、桌面 renderer/Electron 与 Windows NSIS 安装包成功），`npm run visual:check`、本地和固定生产地址的 `npm run visual:check:mobile` 均通过，相关桌面与 390px/430px 手机截图经人工复查未见新增重叠、遮挡、横向溢出或英文—中文错配。`npm run ios:sync` 已同步最新网页与 3 个 Capacitor 插件；安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,395 bytes，SHA-256 为 `EA258EF70DB973129C739EE107D18F9977252A4AB1644A664FD663D17EBFD5ED`；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。
- 公网发布：Vercel 生产部署 `dpl_GgPDX9xokkyTEzNUw8442BgGSy8s` 已绑定固定地址 `https://ftranslate-mobile.vercel.app`，带缓存破除参数访问返回 200。线上完整移动回归确认：导入仅提取不翻译、切换/退出后保留 3 页 6 个原文块、点击“全文翻译”后才产生 3 次按页 AI 请求、刷新后恢复 PDF/双语结果/API Key，并继续通过真实 arXiv PDF 下载入库、改名标签和 IndexedDB 删除闭环。

### 2026-07-17 iPhone Safari 文字层提取兼容修复

- 真机错误：`Dreamtouch 2026.4.14` 第 1 页直接显示“全文原文提取失败”，底部错误为 `undefined is not a function (near '...r of e...')`；原始 PDF 可打开，错误发生在直接读取文字层后的首个正文块落盘前。
- 根因复现：移动生产包中 `hashText` 被构建为 `for (const r of e)`，Safari 在该 PDF.js 文字对象路径上无法提供可用的字符串迭代器。新增一个显式移除 `Symbol.iterator` 的字符串对象回归用例后，旧实现稳定复现 `TypeError: value is not iterable`，与真机错误位置一致。
- 修复：`hashText` 改用 `String(value)` 与 UTF-16 下标/`charCodeAt(index)`，并移除同一重排路径的 `Array.prototype.at` 依赖。单页文字层读取或重排若仍抛出浏览器异常，会记录警告并自动改用本地 OCR，而不是把整篇标记为失败。
- 完整验证：专项 `pdfTextStructure` 与 `mobileLocalOcr` 测试通过（4 个测试文件、109 项测试）；`npm run build` 通过（84 个测试文件、510 项测试），`npm run build:mobile`、`npm run visual:check` 与本地/固定生产地址的 `npm run visual:check:mobile` 均通过。人工复查 390px OCR-only 与双语截图，未见新增重叠、截断、横向溢出或英中错配。构建产物检查确认旧的字符串 `for...of` 哈希循环已消失，UTF-16 下标循环已进入 `MobileApp-Dy0-l9yR.js`。
- 交付验证：`npm run dist` 与 `npm run ios:sync` 通过；Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,707 bytes，SHA-256 为 `A33D4BE4212F59D285ABDBC846B23A5D58A47F96CE4C6FAD7FF7346F729B777D`；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。Vercel 生产部署 `dpl_5oWyZQKoWynAoXBhJXYMzZYNDYei` 已绑定 `https://ftranslate-mobile.vercel.app`，线上 HTML 返回 200 并加载最新 `index-CiK3lVQU.js` / `MobileApp-Dy0-l9yR.js`，固定生产地址完整手机回归通过。

### 2026-07-17 OCR、删除与图表渲染异步竞态审查

- 对抗式审查发现四类既有测试未覆盖的异步问题：每页缓存超过 30 秒后 `Promise.race` 只结束外层等待，底层写入仍可能继续并把失败状态改回 `running`；删除论文会同步等待最长 120 秒的 OCR 当前页；PDF 图表加载失败没有销毁 loading task，失败页 Promise 还会永久污染三页缓存；阅读器销毁后迟到的页渲染仍可能向旧画布绘制。
- OCR 修复：每个页保存步骤在执行前后都核对当前 job、取消标记和论文是否仍存在；任何异常先把 job 失活，再记录失败状态；旧 job 的 `finally` 只能删除自身，不能误删未来重试任务。新增延迟写入取消回归，确认旧回调不能继续进入图表写入和进度提交。
- 删除修复：点击删除后先取消 OCR、移除论文索引并清空当前阅读状态，不再同步等待 OCR 完成；后台清理任务会等待 job 和最新串行写入队列真正结束，再二次删除论文目录。相同本地 ID 或 arXiv ID 在旧清理未结束时不会被直接复用，避免迟到写入污染重新导入的数据。
- 图表修复：加载文档失败会在 2.5 秒边界内销毁 PDF.js loading task；页面渲染失败会从缓存淘汰并允许下一次重试；淘汰、销毁和失败 Promise 都有拒绝分支，避免未处理异常；`renderRegion` 在异步页返回后再次核对 renderer 状态，不再向已销毁画布绘制。图表迁移在异步落盘后也会再次检查组件是否已取消，避免切换论文后的迟到状态更新。
- 自动验证：新增 4 项异步/资源回归，`npm test`、`npm run build` 与 `npm run dist` 均通过，共 85 个测试文件 / 520 项测试；`npm run ios:sync` 已同步最新移动资源和 3 个 Capacitor 插件，`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,791 bytes，SHA-256 为 `B3AFEAC9933B65163DF3186104EB66AD86B2467CD0E5C4892162BB5FBBE4245A`。
- 视觉对抗式审查：本地与固定生产地址的 `npm run visual:check:mobile` 均通过，覆盖真实 arXiv 检索/PDF 下载、原始图表插入、IndexedDB 删除、OCR 前页缓存、切换/退出、手动翻译、整页刷新与 API Key 恢复；人工查看 390px/430px 图表、OCR 运行和小说式双语截图，未发现图表挤压、按钮遮挡、横向溢出、字号回涨或英中错配。`npm run visual:check` 也通过，桌面页面未受移动端修复影响。
- 公网发布：Vercel 生产部署 `dpl_EfB2eTEo78kM1wPMBmMNMrqinkhv` 已绑定 `https://ftranslate-mobile.vercel.app`；固定地址返回 200 并加载 `assets/index-DqycejUs.js`，部署后的完整手机回归通过。

### 2026-07-17 OCR 快速首扫与论文库可靠落盘

- 真机反馈：扫描 PDF 的本地 OCR 速度偏慢，退出网页后论文似乎没有留在论文库中。
- OCR 根因与优化：此前所有扫描页都直接渲染为最长边约 2600px，再执行一次完整 Tesseract 识别；清晰页面和疑难页面承担相同像素成本。现改为约 2100px 快速首扫，像素量约为旧路径的 65%；整体置信度低于 70、没有保留有效段落或过滤后正文损失过大的页面，才自动回到 2600px 精扫。文字层优先、双栏重排、图表恢复与“导入时不翻译”的边界不变。
- 保存根因与修复：启动阶段用 `Promise.all` 异步读取论文库与翻译设置；如果用户在它完成前导入，稍后返回的旧空论文库会覆盖内存中刚落盘的论文。网页端论文索引现直接同步写入与 Capacitor Preferences 相同的 `localStorage` 键；所有论文库写入经串行队列提交，旧慢写入不能覆盖新进度；启动读取若发现期间已有本地改动，会合并旧库与当前库并再次落盘。导入 PDF 或 arXiv 论文成功后明确显示已保存提示，然后才继续后台提取。
- 回归验证：新增快速/精扫质量门、启动水合合并与串行写入顺序测试。`npm run build` 通过（85 个测试文件、523 项测试，TypeScript、桌面 renderer/Electron 构建成功）；`npm run build:mobile` 与 `npm run visual:check:mobile` 通过，自动执行导入、OCR 中途切换/退出、三页完成后整页刷新，确认 PDF、6 个原文/译文块和 API Key 均恢复。人工检查 `.tmp-mobile-visual-check/08a-reader-scanned-ocr-running-390x844.png` 与 `08b-reader-scanned-ocr-only-390x844.png`，保存提示无遮挡、正文无横向溢出。`npm run visual:check` 通过，桌面端未受影响。
- 交付验证：`npm run dist` 再次通过全部 523 项测试、TypeScript、桌面构建与 NSIS 打包；安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,361,791 bytes，SHA-256 为 `13FFA9D0700781FDF82EC9C95BBBD3D90A3468869BD80408370DE53690C962D3`。`npm run ios:sync` 已同步最新移动资源和 3 个 Capacitor 插件，`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。
- 公网发布：Vercel 生产部署 `dpl_4Zg9X6NdoXH29T9XY1pk6BPuGp4q` 已绑定固定地址 `https://ftranslate-mobile.vercel.app`；线上 HTML 返回 200 并加载 `assets/index-DhaU0PSE.js`。带缓存破除参数的固定地址完整移动回归通过，覆盖真实 arXiv 检索/PDF 下载、导入扫描件、OCR 中途退出、手动全文翻译、整页刷新后恢复 PDF/6 个双语块/API Key、改名标签与删除闭环。
- 运行边界：Safari 被切到系统后台或被系统冻结后，网页 JavaScript 仍可能暂停，纯静态网页无法保证关闭 Safari 后继续 OCR；本轮保证的是 PDF 和已经完成的逐页结果先保存，重新打开后从首个缺页续跑。2100px 路径的真机耗时仍需用原 14 页扫描件测量；质量不足页会多做一次识别，换取不牺牲疑难页准确率。

### 2026-07-18 OCR 内存、精扫截断与启动恢复对抗式修复

- 对抗式审查新增发现三类数据问题：2600px 精扫会无条件覆盖已有的 2100px 首扫，即使精扫为空或只识别出更短片段；论文库与 API 配置用同一个 `Promise.all` 恢复，其中一项读取失败会丢弃另一项的成功结果；论文库串行写入会保存每个中间 OCR 进度快照，长论文可能把 Safari 写入队列越积越长。
- OCR 质量与性能修复：快速结果和精扫结果现在按置信度、正文保留量、平均段落长度、碎片比例共同评分，并加入正文骤减保护，空白或截断精扫不能覆盖可读首扫。PDF.js 渲染画布直接传给 Tesseract，不再逐页执行 PNG/Base64 编码；识别 Promise 结束后立即把画布缩到 `1×1` 释放 backing store，减少长扫描件 CPU 与累计内存压力。
- 持久化修复：论文库与 API 配置改为独立 settled 恢复；一项读取失败时保留另一项，启动读取期间新导入的论文和新保存的 Key 也不会被迟到旧值覆盖。论文库写入队列保留当前进行中的写入，并把所有尚未开始的保存请求合并为最新快照；等待这些快照的调用方统一在最新快照落盘后完成。
- 自动验证：新增精扫空白/截断保护、待写快照合并、论文库与配置独立恢复以及启动期间 Key 防覆盖用例。`npm run build` 与 `npm run dist` 均通过，共 86 个测试文件 / 527 项测试；`npm run build:mobile`、`npm run ios:sync`、`npm run visual:check` 和本地/固定生产地址 `npm run visual:check:mobile` 均通过。移动回归覆盖 OCR 中途切换/退出、三页完成、手动翻译和整页刷新，确认 PDF、6 个双语块和 API Key 恢复；人工复查 390px OCR 运行、OCR-only、双语和论文库截图，未发现新增重叠、截断或横向溢出。
- 交付验证：Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 99,006,649 bytes，SHA-256 为 `B9B9707DE2895A176B1FB017EF34518A62D65033BCEAB047D1D446D191D13670`；解包核对确认 Electron 入口、OCR worker 与 `eng.traineddata.gz` 已进入 `app.asar`。`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。
- 公网发布：Vercel 生产部署 `dpl_BwndUVq6TKx6QHmRuPYC2tF1i7be` 已绑定 `https://ftranslate-mobile.vercel.app`；固定地址带缓存破除参数返回 200 并加载 `assets/index-DGoaOUhM.js`。线上完整移动回归通过，覆盖真实 arXiv 检索/PDF 下载、导入扫描件、退出阅读器、手动全文翻译、刷新恢复、API Key、改名标签与删除闭环。
- 剩余边界：静态网页仍不能绕过 iOS 对后台标签页的冻结；本轮减少内存、保证逐页落盘和恢复续跑，但“Safari 完全退出后继续 OCR”仍需要原生 App 或服务端任务。真实 14 页扫描件的总耗时和精扫页比例仍需在同一 iPhone 上测量。

### 2026-07-18 Safari 文字层误降级修复

- 对抗式证据：iPhone 真机截图明确显示 `T TouchDreaming 2026.4.14.pdf` 的前两页为“本地 OCR 2 页”，并出现 `id loc p` 等 OCR 断裂文本；这推翻了“桌面 14/14 页文字层即可证明手机也命中文字层”的错误结论。文件大小和 SHA-256 与桌面样本一致，因此不是手机上传转换，而是 Safari 运行时路径差异。
- 根因修复：移动文字层收集不再假设 `textContent.items` 一定具有 `flatMap()`、`str` 一定是原生字符串、`transform` 一定是普通数组。现在使用受控下标读取、安全字符串转换、数值坐标校验和逐项异常隔离，避免一个 Safari 特殊文字对象把整页推入 OCR。
- 分层降级：正常情况继续使用学术版式结构重排；结构重排抛错或没有产出完整段落、但原始文字项仍有正文时，改用保守的 Safari 兼容重排，修复跨行连字符并按自然句段聚合。只有文字层读取彻底失败或有效正文不足时才启动 Tesseract OCR，并把实际失败原因随页面缓存保存，来源汇总不再笼统声称“PDF 没有文字层”。
- 缓存迁移：本地提取版本升到 v7，旧 v6 错误 OCR 缓存会自动重建，原 PDF 不删除、不要求重传。重建前保留旧提取条目用于按完全相同 `sourceHash` 恢复仍有效译文；错误 OCR 与新文字层不一致时不会强行复用中文。
- 自动验证：新增 Safari 风格 array-like items、string-like `str`、异常坐标隔离、结构重排抛错后的兼容重排、跨行连字符与来源诊断用例；定向测试 25 项通过。全量 `npm run build` 和 `npm run dist` 均通过，共 87 个测试文件 / 555 项测试，TypeScript、桌面/移动构建与 NSIS 打包成功。真实语料再次覆盖用户提供的 13 篇、122 页，全部命中文字层；Touch Dreaming 14 页全部为结构化文字层、0 页为空、共 219 个正文块。该语料回归验证 PDF 和重排逻辑，最终仍需在同一 iPhone Safari 刷新生产版本后确认来源显示为“PDF 文字层 14 页”或少量“兼容重排”，而不是 OCR。
- 视觉对抗式审查：本地与固定生产地址的 `npm run visual:check:mobile` 均通过，覆盖旧论文恢复、arXiv 真实检索/下载、图表、内联译文、扫描 OCR、切换/退出续跑、手动全文翻译、刷新恢复、API Key、改名标签与删除；人工复查 390px/430px 双语、OCR-only 和小说式截图，未发现新增重叠、截断或横向溢出。首次桌面 `visual:check` 在整篇 PDF 场景失败，截图底部显示脚本仍向应用写入已不存在的个人默认路径 `D:\\GPT浏览器下载\\2604.15483v2.pdf`；现已让 `loadPaperRecord` 显式接收解析后的实际 PDF 路径，并生成带图注的自包含 fallback PDF，整篇 PDF 与图表检查随后通过。桌面脚本继续在旧有组会 PPT 内容质量门失败（fallback 缺少足够中文证据；Touch Dreaming 仅剩结果页一条英文指标），与本次手机文字层/UI 无关，已保留失败证据而未伪报全量通过。
- 交付与发布：Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,362,070 bytes，SHA-256 为 `7144CB29D9E0A2DA7ED0DAFE40C8E54A21A1958B318DC2AA2A04B9976FC3240D`；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。最终 Vercel 生产部署 `dpl_7FTGLhYihEbzVB5ohbBcF235axVq` 已绑定 `https://ftranslate-mobile.vercel.app`；固定地址带缓存破除参数返回 200 并加载 `assets/index-D9QjFai3.js`，最终线上完整移动回归再次通过。

### 2026-07-18 Safari PDF.js 流式文字层修复（v8）

- 新真机证据：刷新 v7 后，同一份 `T TouchDreaming 2026.4.14.pdf` 仍显示“本地 OCR 1 页”，正文仍出现 `id loc p`。这证明 v7 对 array-like 文字项和兼容重排的修复没有进入执行点，不能继续把根因归为返回后的文字项结构。
- 精确根因：当前 PDF.js 的 `PDFPageProxy.getTextContent()` 内部通过 `for await (const value of readableStream)` 汇总 `streamTextContent()`。旧版 iPhone Safari 的 `ReadableStream` 支持 `getReader()`，但没有 `Symbol.asyncIterator`；因此 PDF.js 在返回 `textContent.items` 之前就抛出此前真机出现的 `undefined is not a function (near '...r of e...')`，页面随后直接降级 OCR。
- 修复：移动提取器绕过 `getTextContent()` 的异步迭代聚合，直接用 `streamTextContent().getReader().read()` 逐块收集文字项；不使用流的可迭代协议、数组展开或 `flatMap`。流式读取为空或失败时才尝试旧聚合 API，两者都失败时错误信息同时保留。阅读器新增可展开的“文字层已降级，查看原因”，真机若再次进入 OCR 可以直接看到具体失败点。
- 缓存迁移：本地提取版本升到 v8。已有 PDF、论文元数据、API Key 和已完成译文继续保留；v7 的错误 OCR 页面会自动清除并从 PDF 重新提取，相同原文哈希的译文才允许恢复。
- 真实文件验证：对 `T TouchDreaming 2026.4.14.pdf` 使用新的 reader API 逐页读取，14/14 页全部返回足量文字；第 1 页 163 个文字项 / 2269 字符，第 2 页 260 个文字项 / 6239 字符，末页 838 个文字项 / 2367 字符，无页面触发空文字条件。
- 自动验证：新增不提供 `ReadableStream` 异步迭代、只提供 `getReader().read()` 的 Safari 回归用例；23 项本地提取测试、47 项移动定向测试通过。`npm run dist` 完整通过，共 87 个测试文件 / 556 项测试，TypeScript、桌面/移动构建和 NSIS 打包成功；`npm audit --omit=dev --json` 为 0 个生产依赖漏洞。
- 视觉对抗式审查：本地与固定生产地址的 `npm run visual:check:mobile` 均通过，新增的折叠诊断条没有遮挡正文、截断或制造横向溢出；线上回归继续覆盖真实 arXiv 检索/下载、IndexedDB 保存、OCR 与翻译分离、切换退出、整页刷新、API Key、改名标签和删除闭环。桌面 `npm run visual:check` 仍在既有组会 PPT 内容质量门失败（第 2/7/8 页缺页码来源，第 3/4 页中文 bullet 不足），与本次手机文字层和 UI 无关，未伪报通过。
- 交付与发布：Windows 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe` 为 148,362,069 bytes，SHA-256 为 `51E2CAD31587E50ACB9A718FBB48321488D222D7C6604A3F58EBC5EDE654D13B`。Vercel 生产部署 `dpl_78AZPvCxGpPjyTZSTHbs3TqgZzFH` 已绑定 `https://ftranslate-mobile.vercel.app`；固定地址带缓存破除参数返回 200 并加载 `assets/index-q3pj3S91.js`，线上移动视觉回归通过。

### 问题台账

| 日期 | 问题 | 根因 | 当前状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 2026-07-18 | Touch Dreaming 在 v7 真机上仍误走 OCR，出现 `id loc p` 等残缺文本 | PDF.js `getTextContent()` 在返回文字项前用 `for await...of` 聚合流；旧 Safari 的 `ReadableStream` 没有异步迭代接口，故 array-like 兼容处理根本没有机会执行 | 已绕过聚合 API，改用 `streamTextContent().getReader().read()`；缓存升到 v8；真实文件 14/14 页通过 reader API 返回足量文字；生产部署与线上移动回归已完成 | 同一 iPhone 正常刷新并重开论文；预期从第 1 页开始显示“PDF 文字层”，若仍 OCR，展开“文字层已降级，查看原因”并截图 |
| 2026-07-18 | 精扫可能覆盖更完整首扫，长文写入越积越慢，配置读取失败可能让论文库看似消失 | OCR 候选无质量择优和截断保护；每个中间论文库快照都排队写入；论文库与设置通过同一个 `Promise.all` 恢复 | 已加入候选评分/截断保护、Canvas 直传与即时释放、待写快照合并、论文库/设置独立 settled 恢复；527 项测试及本地/线上刷新恢复回归通过 | 用原 14 页扫描件真机记录总耗时、峰值发热、精扫页数；切后台后重开应从首个缺页续跑 |
| 2026-07-17 | 扫描 OCR 偏慢，退出后论文似乎未保存 | 所有扫描页固定使用 2600px 高精度识别；启动异步读取的旧空论文库可能晚返回并覆盖导入结果，论文库进度写入也没有全局顺序 | 已改为 2100px 快速首扫、低质量页 2600px 精扫；网页索引同步落盘、写入串行、启动水合合并；523 项测试及导入后整页刷新恢复回归通过 | 用原 14 页扫描论文真机记录普通页/精扫页耗时；不要清除 Safari 网站数据，若系统冻结 OCR，重开后应从首个缺页续跑 |
| 2026-07-17 | OCR 超时后状态可能复活、删除运行中论文等待过久、图表瞬时失败无法重试 | 超时只结束外层 Promise，底层写入与 PDF.js 页面任务没有 job 生命周期守卫；删除同步等待 OCR；失败 Promise 留在页缓存 | 已加入 job 前后守卫、后台删除排空与二次清理、失败页淘汰、loading task 销毁和销毁后禁止迟到绘制；520 项测试及本地/线上移动回归通过 | 真机对正在处理最后一页的 14 页论文执行一次删除或等待超时，确认状态不会回跳且同文件稍后可重新导入 |
| 2026-07-17 | iPhone Safari 第 1 页直接原文提取报 `undefined is not a function (near '...r of e...')` | PDF 文字块哈希使用字符串 `for...of`，真机该路径返回不可迭代的字符串对象；且文字层异常没有页级 OCR 降级 | 已用不可迭代字符串对象稳定复现并改为 UTF-16 下标哈希；文字层单页异常现在自动降级 OCR | 部署后在同一 iPhone 对 `Dreamtouch 2026.4.14` 点击“重新提取”，无需清除 Safari 数据 |
| 2026-07-16 | 图文混排、双栏论文首页 OCR 出现明显错字、裁断和阅读顺序错误 | 所有 PDF 都被降采样 JPEG 整页 OCR；忽略文字层和 OCR 坐标/块类型；摘要右栏未继承 `Abstract` section | 已改为文字层优先、2600px PNG 本地 OCR 兜底、坐标版面重排和仅在翻译时启用的 AI 保守校对；真实论文首页复现已恢复完整双栏摘要并发布生产站点 | 用截图中的原始匿名 PDF 在 iPhone Safari 重新打开；版本 4 会自动清除旧错误原文并重做，真机确认该文件是否直接命中文字层 |
| 2026-07-16 | 导入 PDF 后不应自动翻译；应先 OCR 全文，用户点击“全文翻译”后才开始 | 旧扫描件流程把进入连续双语同时当作 OCR 和翻译启动动作，OCR 与 DeepSeek 状态耦合 | 已拆成应用级后台全文 OCR 与阅读器手动全文翻译两阶段；自动化断言 OCR 阶段翻译请求为 0，点击后才按页翻译 | 部署后用原问题 PDF 在 iPhone Safari 真机导入，观察长文 OCR 的耗时、发热和锁屏/切后台后的 WebKit 持续性 |
| 2026-07-16 | API Key 刷新后丢失，导入/译文缓存缺少明确保证，OCR 出现一词一段或断词 | 配置序列化主动排除 Key；OCR 无条件信任碎片化版面段落 | Key 改为本机 Preferences 持久化；PDF/译文恢复纳入刷新回归；OCR 对逐词结果退回整页自然段并修复跨碎片连字符 | 真机用原问题 PDF 重新 OCR 一页，确认真实 Tesseract 输出能恢复为完整自然段；不要清除 Safari 网站数据 |
| 2026-07-15 | Vercel CLI 尚未获得部署授权 | 本机没有既有 Vercel 凭据，首次部署必须由用户完成 OAuth 登录 | 已解决：完成 OAuth 并部署到 `https://ftranslate-mobile.vercel.app` | 后续在已关联项目中执行 `npx vercel --prod` 更新同一生产地址 |
| 2026-07-15 | iPhone Safari 存入 arXiv 论文时报 `BlobURLs are not yet supported` | Capacitor Filesystem 网页实现把 Blob 交给 IndexedDB，Safari 无法持久化该 Blob URL | 已改为独立 IndexedDB `ArrayBuffer` 存储，本地 Chromium 导入/读取闭环通过 | 重新部署后由 iPhone Safari 再保存同一论文，确认真机 WebKit 与浏览器配额行为 |
| 2026-07-15 | iPhone Safari 存入论文继续报 `Load failed` | PDF 下载绕过同源代理直接访问 arXiv，部分论文被 Safari 的跨域或重定向策略阻断 | 已恢复固定目标的 `/api/arxiv-pdf/*` 同源代理；生产实际下载 `1910.00399v1` 返回有效 PDF，线上 UI 已完成下载、IndexedDB 写入、读回和打开阅读器闭环 | 由 iPhone 强制刷新后重试；若某条论文明确返回 HTTP 404，需区分 arXiv 源站尚未提供该 PDF，而非本地保存故障 |
| 2026-07-15 | 从 arXiv 检索页切走再返回时结果和译文消失 | `MobileApp` 按当前 tab 条件渲染，离开检索页会卸载组件并销毁 React state | 检索页改为会话内常驻、非当前 tab 仅隐藏；线上脚本已确认查询词、20 条结果和标题译文往返后保持一致 | 真机确认返回检索页时仍位于原列表位置 |
| 2026-07-15 | arXiv 检索提示 `HTTP 502` | Vercel 函数等待 Atom 上游约 25 秒后超时；紧接着重试还可能触发 429 | 已部署单次官网搜索转换方案；生产地址实测 5.4 秒内返回 200、`official-search` 和 20 篇结果，线上 UI 检索通过 | 真机强制刷新后再验证普通查询与分类筛选；官网不可用时应显示明确繁忙提示 |
| 2026-07-15 | Safari 删除论文时报 `IDBTransaction will abort due to uncaught exception in an event handler` | IndexedDB 删除使用 `openKeyCursor()` 并在事件回调内删除、继续游标，WebKit 会中止事务 | 已部署 `getAllKeys()` 同事务批量删除；线上脚本验证改名、标签、删除及 PDF 键清理闭环，无遮挡或横向溢出 | 由真机删除截图中的本地 PDF 再确认一次 |
| 2026-07-15 | iPhone 切换到“原始 PDF”后整页显示 `The container must be absolutely positioned` | 移动构建不加载桌面 `global.css`，PDF.js 容器缺少强制绝对定位；旧视觉脚本只验证段落双语，没有点击原始 PDF | 已部署 `relative` 外壳和 `absolute; inset: 0` 容器；生产视觉脚本已成功切换模式、渲染 PDF canvas 并通过计算样式断言 | 由 iPhone 使用带版本参数的地址强制刷新，再切换一次“原始 PDF”确认 |
| 2026-07-15 | 手机 PDF 不能缩放，普通 PDF 不能直接连续双语阅读 | 共享 viewer 只有桌面 Ctrl+滚轮；移动阅读器按单页渲染，并把外部双语 PDF 当作主入口 | 已改为全文连续段落流、全文渐进翻译、原 PDF 适宽/加减/双指缩放；本地构建与移动视觉检查通过 | 生产部署后用 iPhone Safari 实测双指缩放与一篇多页论文的连续滚动、停止/恢复全文翻译 |
| 2026-07-15 | 导入后提示“没有可提取的文字层”，且用户使用的 DeepSeek 不支持图片 | PDF 页面是扫描图片、拍照内容或轮廓字，PDF.js 没有文本对象；图片模型方案与实际翻译配置不兼容 | 改为手机本地 Tesseract OCR → DeepSeek 纯文本翻译 → 连续双语重排；自动化已确认 DeepSeek 图片请求为 0，原文和译文可重开恢复 | 生产部署后由 iPhone 对原问题 PDF 点击“本地识别并翻译”，记录真实页耗时、识别准确率和 Safari 内存表现 |
| 2026-07-15 | 点击“连续双语”没有反应 | 旧版本残留完成页码/完成标记但没有保存 OCR 段落，新版错误地把空记录当成已完成；模式按钮也只切换视图，没有触发识别 | 完成标记必须有实际 OCR 段落才生效；空记录从第 1 页重做；点击“连续双语”直接启动 OCR 或打开 Key 设置；本地真实浏览器点击回归通过 | 重新部署后用原论文直接点击“连续双语”，不需要删除论文或清除 Safari 数据 |
| 2026-07-15 | 连续双语仍像分块工具界面，不像图示的小说式阅读 | 正文过小且英文两端对齐，页线、译文蓝线、标签和每段按钮持续切断文章流 | 改为 20px 以上自然左对齐的英文—中文长段落，已完成段落移除界面装饰；下滑自动进入沉浸阅读，上滑恢复工具栏 | 在 iPhone Safari 用多页 OCR 论文长时间滚动，确认动态岛/地址栏变化时安全区和工具栏恢复手势仍稳定 |
| 2026-07-15 | 小说式正文过大，OCR 前页在切换或退出后消失 | 阅读器退出即卸载；逐段覆盖缓存缺少按论文串行保护；Safari 滚动锚定把视口推向后页；旧断点还会把“最后处理到第 3 页”误判为第 1–3 页都完整 | 字号降至 17–19px；阅读器会话常驻；OCR 整页批量保存并串行写入；断点从第一个实际缺页续跑；三页处理中切换/退出及整页刷新回归均恢复第 1–3 页 | 用原 14 页论文继续处理，不清除网站数据；真正落盘的前页会直接恢复，旧版本未落盘的缺页会自动重新 OCR |
| 2026-07-15 | 官网结果已显示但某篇 PDF 下载返回 404 | arXiv 可先公开摘要页，个别新条目的 PDF 文件尚未开放；例如 `2607.12784` 摘要为 200 而 PDF 为 404 | 页面将 404 翻译为“PDF 暂未开放，请稍后重试或选择另一篇”，其他可用论文仍可正常保存 | 不把单篇源站 404 误判为论文库写入失败；如长期 404 再核查该条目版本 |
| 2026-07-15 | 本机 C 盘剩余空间为 0，`npx` 安装 Vercel CLI 失败 | npm 临时缓存无法继续写入 | 使用今天已有的 Vercel CLI 缓存完成生产部署，未删除用户文件 | 后续在用户授权下清理低风险临时缓存，否则新依赖安装仍可能失败 |
| 2026-07-15 | 桌面视觉脚本未全量通过 | 默认外部论文在 10 分钟门限内未完成；可控短 PDF 能快速验证布局，但生成的 PPT 内容不足以通过来源与中文 bullet 质量门 | 首页、研究表格、实验矩阵、PDF 阅读和图表截图已生成并人工复查；移动端视觉检查独立通过 | 后续为桌面视觉脚本维护一份小型、内容完备、可通过 PPT 质量门的固定 PDF fixture，移除对个人下载目录大论文的依赖 |

### 2026-07-28 8 篇 Humanoid VLA 真实 PDF 对抗式回归

- 第一性问题：手机端需要把论文恢复成连续、可翻译、可缓存的阅读流；“提取到了文字”不等于成功，段落、图注、图片、表格、参考文献和跨页语义必须保持顺序。
- 测试语料：Being-H0.7、HAIC、OmniXtreme、HiWET、EgoHumanoid、OpenHLM、Being-H0、Being-H0.5，共 8 篇、196 页。
- 最终语料结果：196/196 页直接读取文字层，OCR 0 页；2299 个原始阅读块；133 个图表区域；42 张表格通过行列校验后重制为语义表格；12 张复杂表格未通过安全重制条件，保留原图区域；42 处跨页正文/参考文献续段在全文提取完成后缝合。
- 最终异常计数均为 0：未匹配图表、缺失图注区域、无效语义表格、元数据/出版社字符、参考文献碎片与回链页码、图注碰撞、图注混入正文、标题混入正文、数字表格前缀、字母小节误合并、图注尾行、页脚页码污染、图内文字泄漏、段落中断、错误空格和可修复尾连字符。
- 门禁外人工发现并修复：
  - Being-H0 第 22 页 Figure 8 第二行图注被正文吞入；
  - EgoHumanoid 参考文献存在 78 条红色回链页码粘到年份后；
  - HAIC 第 10→11 页参考文献中的会议名称被判为 heading；
  - OpenHLM 第一页 `Core contributors` 脚注排在正文之后；
  - 2 个 `b)` / `j)` 小节曾被跨页缝合候选误判，现明确排除。
  - 浏览器视觉样本中的无句号 `TABLE I: ...` 表题曾吞掉表头和三行数据，语义表格错误降级成截图；
  - 语义表格接管 caption 后曾先缺失、再与普通阅读块重复；现以页码和规范化 caption 键去重，并断言标题恰好显示一次。
- 核心实现：多行图注采用真实几何行距并在换行处去除软断词；无句号表题遇到空间分离的表头行会停止扩张；语义表格自行呈现唯一 caption；参考文献只清理“年份结束后裸数字列表”的回链形式；跨页只缝合相邻页的 paragraph→paragraph 小写续段，并排除作者脚注、公式和字母小节；缝合结果带 `crossPageEndPage`，重复执行不会继续误合并。
- 缓存迁移：`MOBILE_LOCAL_OCR_VERSION` 升到 12。旧文件和论文库不删除；结构缓存重做，相同哈希译文复用，跨页结构完成后整体落盘。
- 已完成自动验证：真实语料 9 项测试通过；全量 89 个测试文件、665 项测试通过；TypeScript、移动/桌面构建、移动视觉检查、桌面源码与安装包视觉检查全部通过。
- 交付验证：`npm run dist` 已重建 Windows NSIS 安装包 `dist/PDF Translation Reader Setup 0.1.12.exe`，大小 148,362,722 bytes（141.49 MiB），SHA-256 `562181989D986904F6E4A088B5E7D257C2070B58A856EFB00D60FEE875163451`。构建只有既有的大 chunk、缺少 package author、electron-builder 重复依赖引用和 Node DEP0190 警告。
- 网页交付：2026-07-29 将提交 `432eb96` 部署到 Vercel production，部署编号 `dpl_BkWaLft7Hd7p7LhfznZTAmSqeNho`，并重新绑定固定地址 `https://ftranslate-mobile.vercel.app`。缓存破除请求返回新入口 `assets/index-DgRkd4G3.js`；固定生产地址的完整 `visual:check:mobile` 通过，真实 arXiv 检索、同源 PDF 下载、结构表格、图文顺序、翻译、选词问答和刷新恢复均通过；独立 `/api/arxiv` 探针返回 HTTP 200、Atom XML 与论文条目。
- 剩余风险：12 张复杂表格仍使用安全裁图而不是冒险生成错误行列；这批 8 篇 PDF 全部具有文字层，因此不能替代扫描 PDF 的真实 OCR 精度测试；PDF.js 对 Being-H0 系列字体仍可能输出 TrueType 警告，但当前 81 页全部完成文字层提取；iPhone Safari 真机性能、后台冻结和存储配额仍需要真实设备验证。
