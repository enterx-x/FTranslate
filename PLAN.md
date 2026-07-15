# PLAN.md

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
- 支持导入已有中文/双语 PDF；不把 Windows `pdf2zh`/Python sidecar 迁入 iOS。
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
- 整本重排双语 PDF 仍由桌面 `pdf2zh` 流程承担；手机端只提供段落双语和导入已有双语 PDF。
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
- 翻译缓存：缓存记录加入 Base URL；更换端点或模型后对应译文标记为待更新，“翻译本页”会重新生成。每个已有段落均显示“重新翻译”入口，移除 600 条静默淘汰上限，并显示批量翻译成功/失败统计。
- arXiv 翻译：检索结果新增“译标题”和“译摘要”，共用阅读器的 OpenAI 兼容翻译设置；中文结果直接显示在对应英文下方，并随论文一起存入本地论文库。未配置 API Key 时点击翻译会先打开设置，保存后继续原请求。
- 检索会话连续性：`MobileArxivScreen` 在底部导航切换和进入阅读器时保持挂载，仅隐藏界面，因此查询词、结果、卡片译文和滚动位置不会因返回论文库或阅读器而丢失；完整网页刷新仍按当前本地 MVP 边界重新建立检索会话。
- 阅读性能：共享 `PdfViewer` 只在调用方需要提取结果时解析全文，移动端切换原始 PDF 不再重复执行第二次无消费者的全文抽取；选词浮层增加视口高度约束。
- 验证已收口：`npm run dist` 通过（82 个测试文件、476 项测试；TypeScript、桌面生产构建、Windows NSIS 安装包均成功），`npm run ios:sync` 成功；本地和生产地址的 `npm run visual:check:mobile` 均通过。线上对抗脚本确认可恢复旧记录、真实 arXiv 检索返回 20 篇、标题中文紧邻英文显示、在论文库与检索页之间往返后查询词、20 条结果和标题译文保持一致、失败检索清空 20 条旧结果，并已把真实 arXiv PDF 经生产同源代理下载、写入 IndexedDB、读回后打开阅读器；段落内嵌翻译和旧配置重译也正常。生产 `/api/arxiv-pdf/1910.00399v1` 返回 200、`application/pdf`、902,496 字节和 `%PDF-` 文件头；视觉审查的 390px 宽页面 `bodyScrollWidth` / `rootScrollWidth` 均为 390，无裁切项，截图位于 `.tmp-mobile-visual-check/`。生产部署 `dpl_8MLWut3Dn5AFx42V2T2XbUyokR19` 已绑定 `https://ftranslate-mobile.vercel.app`。剩余验证仅为 iPhone Safari 真机强制刷新后再次保存 arXiv PDF，确认 WebKit 的实际存储配额。

### 问题台账

| 日期 | 问题 | 根因 | 当前状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 2026-07-15 | Vercel CLI 尚未获得部署授权 | 本机没有既有 Vercel 凭据，首次部署必须由用户完成 OAuth 登录 | 已解决：完成 OAuth 并部署到 `https://ftranslate-mobile.vercel.app` | 后续在已关联项目中执行 `npx vercel --prod` 更新同一生产地址 |
| 2026-07-15 | iPhone Safari 存入 arXiv 论文时报 `BlobURLs are not yet supported` | Capacitor Filesystem 网页实现把 Blob 交给 IndexedDB，Safari 无法持久化该 Blob URL | 已改为独立 IndexedDB `ArrayBuffer` 存储，本地 Chromium 导入/读取闭环通过 | 重新部署后由 iPhone Safari 再保存同一论文，确认真机 WebKit 与浏览器配额行为 |
| 2026-07-15 | iPhone Safari 存入论文继续报 `Load failed` | PDF 下载绕过同源代理直接访问 arXiv，部分论文被 Safari 的跨域或重定向策略阻断 | 已恢复固定目标的 `/api/arxiv-pdf/*` 同源代理；生产实际下载 `1910.00399v1` 返回有效 PDF，线上 UI 已完成下载、IndexedDB 写入、读回和打开阅读器闭环 | 由 iPhone 强制刷新后重试；若某条论文明确返回 HTTP 404，需区分 arXiv 源站尚未提供该 PDF，而非本地保存故障 |
| 2026-07-15 | 从 arXiv 检索页切走再返回时结果和译文消失 | `MobileApp` 按当前 tab 条件渲染，离开检索页会卸载组件并销毁 React state | 检索页改为会话内常驻、非当前 tab 仅隐藏；线上脚本已确认查询词、20 条结果和标题译文往返后保持一致 | 真机确认返回检索页时仍位于原列表位置 |
| 2026-07-15 | 本机 C 盘剩余空间为 0，`npx` 安装 Vercel CLI 失败 | npm 临时缓存无法继续写入 | 使用今天已有的 Vercel CLI 缓存完成生产部署，未删除用户文件 | 后续在用户授权下清理低风险临时缓存，否则新依赖安装仍可能失败 |
| 2026-07-15 | 桌面视觉脚本未全量通过 | 默认外部论文在 10 分钟门限内未完成；可控短 PDF 能快速验证布局，但生成的 PPT 内容不足以通过来源与中文 bullet 质量门 | 首页、研究表格、实验矩阵、PDF 阅读和图表截图已生成并人工复查；移动端视觉检查独立通过 | 后续为桌面视觉脚本维护一份小型、内容完备、可通过 PPT 质量门的固定 PDF fixture，移除对个人下载目录大论文的依赖 |
