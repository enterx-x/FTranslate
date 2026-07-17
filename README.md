# PDF Translation Reader / FTranslate

## 连续双语图表恢复与末页续跑（2026-07-17）

- “连续双语”不再只保留文字：导入时会在当前设备直接分析原 PDF 的 `Figure / Fig. / Table` 图注与绘制区域，把原始图表按阅读顺序插到对应图注附近。图表由本地 PDF.js 按需渲染和裁切，不上传到 DeepSeek、FTranslate 或 Vercel；“原始 PDF”仍完整保留。
- 已缓存的旧论文无需删除或重新导入。首次打开连续双语后会自动补做一次本地图表索引，逐页保存；刷新、退出阅读器或切换到原始 PDF 后仍从本地缓存恢复。矢量图、嵌入式位图以及图中被错误提成正文的短标签会一并处理，避免同一图表既显示图片又显示一串碎片文字。
- 全文原文提取为每页处理设置 120 秒上限、每页本地写入设置 30 秒上限，并把 OCR worker / PDF 文档收尾限制在 2.5 秒内。最后一页写入后不再无限等待缓存或资源销毁；如果旧任务已经保存全部页面但状态仍停在 `14 / 14`，重新打开网页会直接确认已有页面覆盖并完成任务，而不是再从头 OCR。
- 扫描页先以最长边约 2100px 快速识别；只有整体置信度低于质量门、没有留下有效段落或过滤后损失过大的页面，才自动用约 2600px 精扫。PDF.js 画布会直接交给 Tesseract，不再先编码成大体积 PNG/Base64 字符串；每次识别完成立即释放画布。普通清晰扫描页少处理约 35% 的像素，同时减少每页图片编码和长文累计内存，高精度结果只有在正文更完整时才替换快速结果，不能用空白或截断精扫覆盖可读首扫。
- 导入或保存 arXiv PDF 时，会先完成 PDF 与论文库索引落盘，再启动全文原文提取。网页端论文索引直接同步写入该站点的 `localStorage`；正在写入的快照完成后，尚未开始的多次进度保存会合并为最新快照，避免长论文把 Safari 写入队列越积越慢。启动时论文库与 API 配置分别恢复，其中一项读取失败不能再连带丢弃另一项；读取期间已导入的论文或已修改的 API Key 也不会被迟到的旧值覆盖。导入完成后页面会明确显示“PDF 已保存到当前浏览器”。
- OCR 写入超时后，已经迟到的 IndexedDB 回调会被标记为旧任务：它可以完成当前正在进行的底层写入，但不能再把论文从“失败/已删除”改回“正在提取”。删除正在 OCR 的论文也不再等待最长 120 秒的当前页；论文会先从列表移除，后台再排空最后一次写入并二次清理文件。若立即重新导入同一文件，应用会先等待旧清理任务结束，避免旧缓存覆盖新论文。
- 图表渲染器会在 PDF 加载失败时销毁 worker，失败页会从内存缓存移除以允许 Safari 重试；切走论文或销毁阅读器后才返回的旧 PDF 页不会继续画到已经失效的画布上。
- 某一页超时或浏览器中断时，前面已经完成的文字、译文和图表继续保存在当前浏览器；再次打开后从首个缺页续跑。Safari 进入系统后台后仍可能暂停网页 JavaScript，这是 iOS 网页运行边界，但不会清空已逐页写入的数据。

## iPhone 公网网页阅读（当前首选）

当前首选方案是把独立移动网页部署到 Vercel：iPhone 使用 Safari 打开固定的 HTTPS 地址，无需 App Store、签名或保持 Windows 电脑开机。Vercel 托管静态网页，并通过固定目标的同源代理转发 arXiv 官网检索和 PDF 下载，避免 Safari 因 arXiv 跨域或重定向报 `Load failed`；PDF 响应只流向当前浏览器，不写入 FTranslate 或 Vercel 数据库。论文索引、PDF、阅读进度和段落译文最终保存在当前 Safari 的浏览器存储中。

当前生产地址：[https://ftranslate-mobile.vercel.app](https://ftranslate-mobile.vercel.app)。在 iPhone Safari 打开即可使用；通过“分享 → 添加到主屏幕”可以获得接近独立 App 的入口。

仓库根目录已提供 `vercel.json`，首次部署执行：

```bash
npx vercel login
npx vercel --prod
```

后续部署会继续更新同一个固定生产地址。不要使用无痕模式，也不要清除该网址的网站数据；同一套论文库不会自动出现在其他浏览器、其他域名或桌面端。

手机段落、arXiv 标题和摘要翻译由浏览器直接请求用户配置的 OpenAI 兼容 HTTPS 接口。检索结果卡片可分别点击“译标题”或“译摘要”，中文译文直接显示在对应英文下面，保存论文时会一并写入论文库。Base URL、模型名和 API Key 会保存在当前浏览器/手机本地，刷新或关闭网页后自动恢复，不写入 FTranslate 或 Vercel；清空 API Key 并保存设置即可删除本地记录。网页存储无法提供系统钥匙串级保护，因此不要在共享设备上保存 Key。该接口必须允许浏览器跨域访问。免费域名由 Vercel 自动提供 HTTPS，个人使用不需要购买域名。

在本次网页会话内，从“检索”切换到论文库或阅读器后，查询词、结果列表、滚动位置和已经生成的标题/摘要译文会保留；再次进入“检索”可继续原位置，不需要重新搜索或翻译。刷新或关闭整个网页后仍会重新开始检索，已存入论文库的中文元数据不受影响。

论文库每一行提供“管理”入口，可修改仅用于当前浏览器显示的论文名称，并添加最多 12 个本地标签；名称和标签都可以被论文库搜索框检索，不会改写原始 PDF 或 arXiv 元数据。删除论文会先从论文库索引移除，再清理 IndexedDB 中对应的 PDF 数据；即使浏览器文件清理出现异常，论文也不会继续卡在列表中。

生产检索不再连续重试容易超时的 arXiv Atom 接口，而是单次请求 arXiv 官网搜索并在服务端转换为应用现有的数据结构；查询参数仍被限制在固定的 arXiv 地址和最大结果数内。若 arXiv 官网本身暂时不可用，页面会提示“arXiv 暂时繁忙，请稍后点击刷新”，而不是只显示难以判断的 `HTTP 502`。

手机版会在写入前校验 PDF 文件头与 PDF.js 文档结构，单个 PDF 上限为 64 MB；arXiv 下载支持取消并在 45 秒后超时。网页会申请浏览器持久存储，并把导入/arXiv 下载的原 PDF 以原始 `ArrayBuffer` 写入独立 IndexedDB，避免 iPhone Safari 无法持久化 Blob URL；提取的英文原文、逐段译文、阅读进度和论文索引也按论文写入本地存储。少数刚收录的 arXiv 摘要可能暂时还没有对应 PDF；源站返回 404 时页面会明确提示“PDF 暂未开放”，可稍后重试或选择另一篇。重复保存同一份 PDF 会保留阅读进度；如果源文件内容或 arXiv 版本发生变化，会从第 1 页重新开始并使旧段落译文失效，避免原文与译文串版。任何 PDF 导入论文库后都会立即在当前设备后台逐页提取全文：每页先读取 PDF 文字层并按论文双栏版式重排，只有没有可靠文字层的页面才启动本地 OCR；每页英文原文完成后立即保存到本机。这一阶段不会读取 API Key、不会调用 DeepSeek/OpenAI-compatible 接口，也不会生成中文。退出阅读页、切换到原始 PDF 或切换底部入口不会取消后台提取。论文库会显示等待、进度、完成或失败状态。全文原文完成后，用户进入“连续双语”并明确点击“翻译全文”，系统才按原页顺序生成中文；扫描页会在同一次翻译请求中由 AI 保守校对明显 OCR 错误并恢复自然段，文字层页面不经过 AI 改写英文。完成一页就保存一页，可中途停止并保留已完成部分。正文采用 17–19px、自然左对齐的紧凑小说式排版，不使用卡片、段落边框或“译文/重译”标签切断阅读；向下阅读会自动隐藏标题栏、模式栏和处理状态，向上滑动或返回顶部即可恢复操作区。更换 Base URL 或模型后，“翻译剩余”会更新旧配置生成的译文。

扫描件、拍照 PDF 或已把字体转成轮廓的 PDF 没有浏览器可提取的文字层，此时移动版才使用 PDF.js 把当前页渲染为最长边约 2100px 的无损画布，并把画布直接交给随应用提供的 Tesseract.js 最佳英文模型以 300 DPI 参数识别；低置信、无有效段落或结构损失明显的页面会自动用约 2600px 再精扫一次。精扫结果会同时比较置信度、正文保留量、段落完整度和截断比例，不能用更短的高置信结果覆盖更完整首扫。识别结果不再只按返回数组顺序拼接，而是使用文字块类型、行坐标、置信度与页面宽高恢复双栏阅读顺序，过滤图片块、孤立标签、纯页码和低置信短碎片；跨行断词与常见科研复合词也会分别修复。DeepSeek 不需要支持图片输入，页面图片不会发送到 DeepSeek、FTranslate 或 Vercel；只有用户在全文原文完成后点击“翻译全文”，扫描页的纯文字才会进入“保守 OCR 校对 + 自然段重排 + 中文翻译”兜底，提示词明确禁止补写输入中不存在的论文内容。旧版本缓存会因本地提取版本升级而自动失效并从实际首个缺页重新处理；每页结果整页写入当前浏览器并记录已处理页集合，空白页不会被反复处理。同一论文的写入严格串行，避免前页被后续写入覆盖。阅读器在论文库与原 PDF 之间切换时保持挂载、正文和滚动位置，整页刷新后也会从 IndexedDB 恢复已成功页面。只有真正需要 OCR 的论文才会加载约 7 MB 的 OCR worker、英文数据和 WASM 核心，之后由浏览器缓存复用。若某页 PDF 文字层本身触发浏览器兼容异常，该页会自动降级为本地 OCR，不会再让全文提取任务直接停止；文本哈希使用不依赖字符串迭代器的 UTF-16 下标实现，以兼容 iPhone Safari 的 PDF.js 文字对象。

原 PDF 不会被转换结果覆盖，可随时切换到“原始 PDF”核对版式。该模式使用 PDF.js 官方 viewer，提供“适宽”、加减缩放、双指缩放和放大后的横向拖动。移动样式必须让 viewer 外壳保持相对定位、内部滚动容器保持绝对定位；`npm run visual:check:mobile` 会实际切换模式、改变缩放比例、等待画布渲染并检查计算样式，防止 Safari 再次出现 `The container must be absolutely positioned` 异常。

## iPhone 局域网网页阅读（离线备用）

没有公网或不想部署时，可以使用免费、无需签名的局域网网页方案：Windows 电脑负责提供网页并转发 arXiv 请求，iPhone 使用 Safari 打开。

电脑和 iPhone 连接同一个 Wi-Fi 后，在 Windows 执行：

```bash
npm install
npm run serve:mobile
```

终端会显示 `Network` 地址，例如：

```text
http://192.168.0.104:4174/
```

在 iPhone Safari 输入该地址即可使用论文库、arXiv 检索、PDF 阅读、段落内联翻译和选词翻译。第一次启动时，如果 Windows 防火墙询问是否允许 Node.js/Vite 访问网络，只允许“专用网络”。电脑必须保持开机且该命令持续运行；停止命令后网页暂时无法访问，再次以相同 IP 和端口启动即可恢复。

网页论文库与访问地址的协议、IP、端口绑定。如果电脑局域网 IP 改变，旧地址的浏览器论文库不会自动出现在新地址，长期使用应在路由器中为电脑保留固定 IP。

## iPhone 本地论文阅读版（`codex/ios-mobile-reader`）

项目现在提供独立的 Capacitor iOS 构建目标。首版不是把整个 Windows 科研工作台压缩到手机，而是只迁移一个可完成的移动闭环：

1. 从 iOS“文件”导入 PDF，或通过 arXiv 检索后下载；
2. PDF 与论文元数据写入 App 本地沙盒；
3. 在论文库恢复最近阅读位置；
4. 使用 PDF.js 阅读保留的原始 PDF，并支持适宽、加减和双指缩放；
5. 普通 PDF 默认转换为整篇连续段落流，“翻译全文”会把中文直接放在对应英文段落下方；
6. 只有长按或选择词语、短语时才显示翻译浮层；
7. 连续双语与原始 PDF 是同一篇论文的两个阅读视图，不要求另外准备或导入双语 PDF。

当前明确不包含账号、云同步、桌面/手机数据互通、Android 工程、App Store 上架和 Windows `pdf2zh` Python sidecar。手机段落翻译使用用户配置的 OpenAI 兼容接口；`Base URL`、模型名和 API Key 都保存在当前设备本地，退出或刷新后自动恢复，但不会跨浏览器或跨设备同步。

### 移动端开发与验证

在 Windows 或 macOS 上运行移动 Web 开发服务：

```bash
npm install
npm run dev:mobile
```

`dev:mobile` 同样监听局域网；日常手机阅读优先使用完成构建后再启动的 `npm run serve:mobile`。

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
- 新增项目空间本地数据模型，存储键为 `pdfTranslationReader:researchProjects`，会自动把当前论文库记录合并到默认本地 AI 研发项目中。
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
dist/PDF Translation Reader Setup 0.1.12.exe
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
- 中文关键词会在本地扩展为英文检索词，例如“强化学习”“机器人导航”“无人机避障”“医学影像”“信息检索”“数据库”“网络安全”“计算机图形学”会转换为对应英文检索词，避免 arXiv API 直接按中文词过滤导致结果过少；
- 检索同时匹配 title 和 abstract；年份范围会写入 arXiv submittedDate 查询条件；
- 每页数量支持 20 / 50 / 100 / 200，并显示 arXiv 返回的总结果数与当前结果范围；
- 桌面端采用左侧全局导航、顶部紧凑搜索筛选、中间论文卡片和右侧论文详情的科研检索布局；
- 论文结果支持单列 / 双列 / 三列切换，默认三列，选择会通过 `pdfTranslationReader:arxivResultColumnMode` 写入 localStorage，刷新后保留；
- 右侧论文详情支持折叠为窄 rail，折叠后搜索区和结果区会扩展到 rail 前，避免出现空白详情列；
- 结果卡片使用 CSS `content-visibility` 做滚动性能隔离，并带有克制的进入 stagger、hover 层级和搜索状态扫描条；`prefers-reduced-motion` 下会降级为静态；
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

当前视觉检查会覆盖首页、论文库、实验矩阵、研究表格、PDF 阅读、组会 PPT、AI 问答、AI 助手、arXiv 检索和设置页。实验矩阵会检查独立页面、侧栏高亮、方法卡桥接摘要、摘要、筛选、表格、右侧详情、证据面板、Markdown 操作、横向溢出，以及主按钮 / badge 是否回到高饱和蓝绿黄；arXiv 检索会检查三列 / 双列 / 单列布局、列数持久化、顶部高级筛选密度、空结果备选论文库紧凑状态、右侧详情面板、分页和横向溢出；AI 问答会检查独立页面、会话窗口入口和 ChatGPT 式布局。失败时会保留对应截图，便于继续定位布局或渲染问题。

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
      HomePage.tsx          工作台首页和论文库
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

## 2026-07-12 聚焦型 Research OS 界面

首页、全局侧栏、PDF 阅读器和 AI 助手已统一为浅色优先的 Research OS 视觉语言：侧栏按科研工作流分组，主操作使用深石墨到蓝紫渐变，关键检查器使用局部玻璃材质和柔和发光。PDF 双语画布保持主区域优先；AI 助手仅在真实生成期间显示持续状态动效，结束后自动归于静态。

界面仍支持 `prefers-reduced-motion: reduce`。视觉回归截图位于 `.tmp-visual-check/home.png`、`.tmp-visual-check/whole-pdf-reader.png` 和 `.tmp-visual-check/ai-assistant.png`。
