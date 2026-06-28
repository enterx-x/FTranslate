# FTranslate 100+ 项真实缺陷修复台账

日期：2026-06-20  
版本目标：0.1.7  
口径：只有能对应到具体错误表现、根因和代码修复的条目才计入；测试命令、构建步骤、视觉检查动作不计入缺陷数量。本轮台账列出 112 项真实缺陷修复。

## arXiv 检索与结果质量

1. 修复“最新论文”在空关键词下无法作为全站最新检索使用的问题，空关键词 latest 请求改为 `all:*`。主要文件：`src/renderer/components/ArxivSearchPage.tsx`、`src/shared/arxiv.ts`。
2. 修复中文短词“机器”直接送 arXiv 后结果过少的问题，增加 machine / robot / robotics / mechanical 扩展。主要文件：`src/shared/arxiv.ts`。
3. 修复中文“触觉”被历史机器人导航词污染的问题，触觉查询只扩展 tactile / haptic / force / touch / contact sensing。主要文件：`src/shared/arxiv.ts`。
4. 修复中文查询只偏机器人方向的问题，新增统计、数据库、安全、医学影像、信息检索、图形学等通用 arXiv 词表。主要文件：`src/shared/arxiv.ts`。
5. 修复“机器人导航”只走单短语匹配的问题，增加 robot / robotic / mobile robot + navigation 组合。主要文件：`src/shared/arxiv.ts`。
6. 修复“路径规划 / 运动规划 / 轨迹规划”中文词直接命中差的问题，扩展 path / motion / trajectory planning。主要文件：`src/shared/arxiv.ts`。
7. 修复“具身智能”只按中文搜索导致无结果的问题，扩展 embodied intelligence / embodied AI / embodied agent。主要文件：`src/shared/arxiv.ts`。
8. 修复“CBF / MPC / PINN”中文全称搜索缺少英文全称的问题，扩展 control barrier function、model predictive control、physics-informed neural network。主要文件：`src/shared/arxiv.ts`。
9. 修复 arXiv wildcard 被当成普通 title / abstract 词的问题，`*` 现在保留为 `all:*`。主要文件：`src/shared/arxiv.ts`。
10. 修复 arXiv 缓存 key 没有随检索语义升级而隔离的问题，query version 已更新，避免旧低质量搜索缓存复用。主要文件：`src/shared/arxiv.ts`。
11. 修复 arXiv API 表达式只匹配单字段导致召回不稳定的问题，关键词现在同时构造 title 和 abstract 组合。主要文件：`src/shared/arxiv.ts`。
12. 修复触觉查询错误加入 standalone sensing / perception 造成泛化过宽的问题。主要文件：`src/shared/arxiv.ts`。
13. 修复中文多关键词检索容易被单一领域锁死的问题，扩展词按语义分组 OR 召回。主要文件：`src/shared/arxiv.ts`。
14. 修复 broad robotics 查询无法覆盖 manipulator / humanoid / manipulation 的问题。主要文件：`src/shared/arxiv.ts`。
15. 修复 arXiv 页面搜索输入不会请求但状态文案像程序日志的问题，改为用户可读状态。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
16. 修复“查最新”横跨整行、占用搜索区高度的问题，改为搜索按钮旁的次级按钮。主要文件：`src/renderer/components/ArxivSearchPage.tsx`、`src/renderer/styles/global.css`。
17. 修复桌面端旧页内左筛选栏挤窄三列论文卡片的问题，筛选迁移到顶部高级筛选。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
18. 修复搜索区横跨全宽但结果区被详情栏挤窄的问题，搜索区和结果区统一主内容列。主要文件：`src/renderer/styles/global.css`。
19. 修复 arXiv 结果区桌面默认不是真三列的问题，默认列数为三列并持久化。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
20. 修复单列 / 双列 / 三列切换刷新后丢失的问题，继续使用 `pdfTranslationReader:arxivResultColumnMode`。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
21. 修复中等宽度下三列硬撑造成横向溢出的问题，CSS 按宽度自动降级列数。主要文件：`src/renderer/styles/global.css`。
22. 修复论文卡片底部按钮过多换行的问题，低频操作收进更多菜单和详情面板。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
23. 修复右侧详情面板与卡片重复堆满操作的问题，详情承担完整操作区，卡片只保留高频动作。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
24. 修复分页出现在左侧筛选卡片里导致布局割裂的问题，分页移到结果区底部。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
25. 修复空结果页“备选论文库”大卡片过高的问题，改为紧凑横向条。主要文件：`src/renderer/styles/global.css`。
26. 修复空结果页备选论文标题横向截断但不可浏览的问题，备选条改为横向滚动。主要文件：`src/renderer/styles/global.css`。
27. 修复备选论文库只渲染前 3/4 项导致看不到更多备选的问题，现在渲染更多 chip 并显示余量。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。
28. 修复 arXiv 页面私有侧栏样式覆盖全局导航导致与其它页面不一致的问题。主要文件：`src/renderer/styles/global.css`。
29. 修复 arXiv 高级筛选展开后大块说明文案把结果区推下去的问题，控件密度已收紧。主要文件：`src/renderer/styles/global.css`。
30. 修复搜索按钮被旧样式覆盖成暗色的问题，主按钮固定蓝紫色。主要文件：`src/renderer/styles/global.css`。

## 本地翻译、NLLB 状态与翻译质量

31. 修复 NLLB `available` 只代表文件存在、误导用户以为 CUDA 可用的问题，新增 runtime smoke 状态。主要文件：`src/main/localTranslationService.ts`。
32. 修复 NLLB 状态停留在 AUTO 的问题，状态现在显示 CUDA ready / CPU fallback / failed。主要文件：`src/main/localTranslationService.ts`、`src/renderer/components/ArxivSearchPage.tsx`。
33. 修复 CUDA DLL 路径缺失时只静默回退的问题，状态携带 DLL 目录和失败原因。主要文件：`src/main/localTranslationService.ts`。
34. 修复 warmup 吞掉错误导致 UI 不知道失败原因的问题，warmup 返回 runtimeState、fallbackReason 和 warmupMs。主要文件：`src/main/localTranslationService.ts`。
35. 修复 arXiv 检索后才冷启动 NLLB 导致首次翻译慢的问题，应用 ready 后后台预热。主要文件：`src/main/main.ts`。
36. 修复设置页“检查环境”只显示模型已配置而不做真实 smoke test 的问题。主要文件：`src/renderer/components/SettingsPage.tsx`。
37. 修复 NLLB 安装脚本 smoke test 不区分 CUDA / CPU 的问题，脚本先测 CUDA，失败再测 CPU。主要文件：`scripts/install-nllb-ct2.ps1`。
38. 修复 worker 发生 CPU fallback 后 UI 仍显示 AUTO 的问题，worker 响应携带 warning / fallbackReason。主要文件：`src/main/localTranslationService.ts`。
39. 修复 Argos fallback 与 NLLB engine 缓存不清晰的问题，SQLite 记录实际 engine。主要文件：`src/main/arxivTranslationService.ts`。
40. 修复坏中文缓存会继续覆盖英文标题的问题，检测乱码后回退英文并允许重新翻译。主要文件：`src/shared/arxiv.ts`、`src/renderer/components/ArxivSearchPage.tsx`。
41. 修复中文标题缓存含重复低信息片段仍被认为可用的问题。主要文件：`src/shared/arxiv.ts`。
42. 修复本地翻译把 `TaCauchy` 音译成“塔科奇”的问题，标题修复保留 leading method name。主要文件：`src/shared/academicTranslationQuality.ts`。
43. 修复 `FEM`、`Vision-Based` 等专有术语在标题里丢失的问题，标题修复会补保留术语。主要文件：`src/shared/academicTranslationQuality.ts`。
44. 修复 `Egocentric Vision` 被损坏成 `Egocentral Visia` 的问题，增加近似 Latin 术语修复。主要文件：`src/shared/academicTranslationQuality.ts`。
45. 修复本地翻译输出 `以以`、`为为`、`方法方法` 等重复片段的问题。主要文件：`src/shared/academicTranslationQuality.ts`。
46. 修复重复句尾导致摘要质量低的问题，增加 repeated tail collapse。主要文件：`src/shared/academicTranslationQuality.ts`。
47. 修复摘要丢失 DexCap / Sim-to-Real 等关键名词后用户不知道的问题，摘要追加保留术语提示。主要文件：`src/shared/academicTranslationQuality.ts`。
48. 修复标题翻译为了中文可读性而丢掉英文方法名的问题，标题模式优先保留关键方法名。主要文件：`src/shared/academicTranslationQuality.ts`。
49. 修复 AI 翻译结果入库前不走同一质量修复链的问题。主要文件：`src/shared/aiTranslation.ts`。
50. 修复测试样例用异常中文缓存误导后续判断的问题，测试改为正常中文并补坏缓存回退。主要文件：`src/renderer/components/ArxivSearchPage.test.ts`。
51. 修复公式/管道符表格被翻译渲染误判为 loose math 的问题。主要文件：`src/renderer/lib/mathText.ts`。
52. 修复 Markdown 表格在 AI 输出里按普通文本显示的问题。主要文件：`src/renderer/lib/markdownDocument.ts`。
53. 修复 Markdown emphasis 与中文标点相邻时渲染不稳定的问题。主要文件：`src/renderer/lib/markdownDocument.ts`。
54. 修复 KaTeX DOM 被 Markdown 后处理破坏的问题。主要文件：`src/renderer/lib/markdownDocument.ts`。
55. 修复 arXiv 翻译按钮点击后部分论文不翻译且无反馈的问题，翻译批处理状态和缓存写回更明确。主要文件：`src/renderer/components/ArxivSearchPage.tsx`。

## AI 问答、导师上下文与证据隔离

56. 修复 AI 问答被藏在 AI 助手子模块的问题，新增独立 `paperTutor` 页面。主要文件：`src/renderer/App.tsx`、`src/renderer/components/PaperTutorPage.tsx`。
57. 修复左侧导航没有 AI 问答入口的问题，新增全局侧栏入口并统一高亮。主要文件：`src/renderer/components/AppSidebar.tsx`。
58. 修复 AI 问答侧栏与其它页面视觉不一致的问题，复用全局导航结构。主要文件：`src/renderer/styles/global.css`。
59. 修复导师请求没有携带当前论文上下文的问题，prompt 现在包含标题、笔记、PDF 文本片段和图表 caption。主要文件：`src/renderer/lib/paperTutor.ts`。
60. 修复导师说“还需要知道论文信息”的问题，缺证据时要求指出缺哪页/哪张图，而不是假装没读。主要文件：`src/renderer/lib/paperTutor.ts`。
61. 修复多论文问答共用一份消息历史的问题，每个问答窗口独立保存 paperIds 与 messages。主要文件：`src/renderer/lib/paperTutor.ts`、`src/renderer/components/PaperTutorPage.tsx`。
62. 修复 AI 问答窗口不能新建的问题，新增“新建窗口”。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
63. 修复 AI 问答窗口不能命名的问题，新增重命名输入和 manualTitle。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
64. 修复 AI 问答窗口不能删除的问题，新增删除窗口并处理删除当前窗口后的焦点回落。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
65. 修复删除最后一个问答窗口后页面无会话的问题，自动创建新空窗口。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
66. 修复清空导师消息一键误触的问题，清空当前窗口消息前增加确认。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
67. 修复导师会话 localStorage 旧顺序导致最近窗口被截断的问题，读取时按 updatedAt 修剪。主要文件：`src/renderer/lib/paperTutor.ts`、`src/renderer/components/PaperTutorPage.tsx`。
68. 修复当前阅读论文被旧选中论文覆盖的问题，activePaperId 现在优先进入选择列表。主要文件：`src/renderer/lib/paperTutor.ts`。
69. 修复选中论文 ID 已失效仍保留在导师窗口的问题，选择会按论文库过滤。主要文件：`src/renderer/lib/paperTutor.ts`。
70. 修复不同论文的 `fig-1` / `fig-2` 图表 ID 冲突导致放大错图的问题，lightbox key 加 paperId。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
71. 修复图表证据没有按论文分组显示的问题，右侧证据现在按 paper bundle 分组。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
72. 修复 PDF 文本片段在多论文问答里混在一起的问题，文本证据按论文 ID 分组。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
73. 修复图表缩略图不可点击放大的问题，新增 lightbox。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
74. 修复 lightbox 只显示图像不显示来源论文的问题，标题栏展示 paper title。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
75. 修复导师回答泄漏 system/user prompt 标题的问题，回答清洗过滤内部提示词痕迹。主要文件：`src/renderer/lib/paperTutor.ts`。
76. 修复导师回答 Markdown 未渲染的问题，消息区走 `InsightMarkdown`。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
77. 修复导师论文列表不能上下滚动的问题，论文选择区和窗口列表增加滚动约束。主要文件：`src/renderer/styles/global.css`。
78. 修复导师问答没有“我不会”路径的问题，该按钮会要求先解答再拆小问题。主要文件：`src/renderer/components/PaperTutorPage.tsx`。
79. 修复导师 prompt 没有多论文差异要求的问题，多论文模式要求比较方法、实验和复现风险。主要文件：`src/renderer/lib/paperTutor.ts`。
80. 修复没有选中论文时仍允许发送造成空上下文的问题，发送按钮按 selectedPapers 禁用。主要文件：`src/renderer/components/PaperTutorPage.tsx`。

## PDF、图表、PPT 与异步状态

81. 修复切换 PDF 后旧文本提取回调覆盖新论文文本的问题，回调按 source pdf path 防串。主要文件：`src/renderer/App.tsx`。
82. 修复切换 PDF 后旧图表提取结果写进新论文的问题，图表提取加入 run id 和取消检查。主要文件：`src/renderer/App.tsx`。
83. 修复切换 PDF 后旧双语翻译结果覆盖当前 PDF 的问题，PDF 翻译加入 run id。主要文件：`src/renderer/App.tsx`。
84. 修复导入翻译 PDF 时没有源 PDF 也能绑定的问题，导入前要求存在 source PDF。主要文件：`src/renderer/App.tsx`。
85. 修复文件选择对话期间切换 PDF 会把译文绑定错论文的问题，导入前后比对 source path。主要文件：`src/renderer/App.tsx`。
86. 修复打开只有中文单 PDF、没有双语 PDF 的论文时状态说已切换但界面没加载的问题。主要文件：`src/renderer/App.tsx`。
87. 修复打开论文时 PDF/译文/AI 缓存部分失败被吞掉的问题，状态会展示 partial warning。主要文件：`src/renderer/App.tsx`。
88. 修复 Windows 路径大小写和斜杠不同导致找不到同一 PDF 记录的问题，路径匹配归一化。主要文件：`src/renderer/App.tsx`、`src/renderer/lib/papers.ts`。
89. 修复生成组会 PPT 时旧论文草稿被复用到新论文的问题，草稿必须匹配 activePaperId。主要文件：`src/renderer/App.tsx`。
90. 修复 PPT 导出文件名可含 Windows 非法尾随点/空格的问题。主要文件：`src/renderer/App.tsx`。
91. 修复图表裁剪框过紧导致图表只提取一半的问题，渲染裁剪前增加边界外扩。主要文件：`src/renderer/lib/presentationFigureAssets.ts`。
92. 修复顶部表格 caption 裁剪过高、混入大段正文的问题，按图表类型收紧 crop height。主要文件：`src/renderer/lib/presentationOutline.ts`。
93. 修复表格和结果图窄 caption 导致只裁半宽的问题，宽图和结果图强制扩到近全页宽。主要文件：`src/renderer/lib/presentationOutline.ts`。
94. 修复图表提取缺少取消信号导致长任务无法被新任务覆盖的问题，crop 阶段接受 `isCancelled`。主要文件：`src/renderer/lib/presentationFigureAssets.ts`。
95. 修复生成 PPT 时旧异步 crop 可覆盖新 draft 的问题，PPT 生成也按 run id 防串。主要文件：`src/renderer/App.tsx`。

## 论文库、研究表格、AI 助手与知识图谱

96. 修复论文库表格长作者/长文件名把一行撑到半屏的问题，表格固定布局并限制单元格行数。主要文件：`src/renderer/styles/global.css`。
97. 修复论文库记录列表不能稳定纵向滚动的问题，表格容器增加 max-height 和 overflow。主要文件：`src/renderer/styles/global.css`。
98. 修复从论文库移除论文没有确认的问题，删除本机记录前弹窗确认。主要文件：`src/renderer/components/HomePage.tsx`。
99. 修复 PDF-only 记录后来绑定翻译 PDF 会生成重复论文记录的问题，upsert 按归一化 pdfPath 合并。主要文件：`src/renderer/lib/papers.ts`。
100. 修复旧论文记录没有 id 时研究表格单元格绑定迁移失败的问题，迁移按 raw id 或归一化 pdfPath 匹配。主要文件：`src/renderer/App.tsx`。
101. 修复 AI 单元格填充会把 `答案:`、代码围栏或提示词回显写进表格的问题。主要文件：`src/renderer/lib/sheetCellAi.ts`。
102. 修复 AI 表格填充清洗过度导致 `中文标题：xxx` 这类真实内容被删的问题。主要文件：`src/renderer/lib/sheetCellAi.ts`。
103. 修复 AI 助手大观分析刷新后仍显示 running 且无法继续的问题，恢复时 running 改为 interrupted。主要文件：`src/renderer/lib/literatureInsight.ts`、`src/renderer/components/AiAssistantPage.tsx`。
104. 修复研究表格页复用同一 running 状态、刷新后也会卡住的问题。主要文件：`src/renderer/components/ResearchSheetPage.tsx`。
105. 修复 AI 助手“当前论文”在没有 activePaperId 时偷偷回退第一篇论文的问题。主要文件：`src/renderer/components/AiAssistantPage.tsx`。
106. 修复 AI 助手“已绑定论文”在没有绑定论文时偷偷分析全部论文的问题。主要文件：`src/renderer/components/AiAssistantPage.tsx`。
107. 修复 AI 助手历史删除一键误触的问题，删除前增加确认。主要文件：`src/renderer/components/AiAssistantPage.tsx`。
108. 修复研究表格解除当前行论文绑定一键误触的问题，解绑前增加确认。主要文件：`src/renderer/components/ResearchSheetPage.tsx`。
109. 修复设置页“重置 UI 设置”一键误触的问题，重置前增加确认并说明不会删除论文库。主要文件：`src/renderer/components/SettingsPage.tsx`。
110. 修复知识图谱临时隐藏节点重复写入同一 nodeId 的问题，隐藏列表去重。主要文件：`src/renderer/components/KnowledgeGraphPage.tsx`。
111. 修复知识图谱隐藏当前节点后菜单还停在已消失节点上的问题，隐藏后清理 selected/context menu。主要文件：`src/renderer/components/KnowledgeGraphPage.tsx`。
112. 修复 README 安装包示例版本滞后导致用户安装旧包的问题，README 更新到当前版本和验证流程。主要文件：`README.md`。

## 本轮必须重新验证

- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run visual:check`
- `npm run dist`
- `$env:VISUAL_CHECK_PACKAGED='1'; npm run visual:check`

安装包路径、时间戳、大小和 SHA256 将在最终完成后写入回复。
