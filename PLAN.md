# PLAN.md

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

- [ ] 从 PDF 文本、图表 caption、用户笔记中生成方法卡。
- [ ] 方法卡字段绑定证据来源。
- [ ] 支持多论文方法对比。
- [ ] 将方法卡写入研究表格或项目空间结构化数据。

### 阶段 3：实验矩阵

- [ ] 将研究表格升级为实验矩阵视图。
- [ ] 支持 baseline / proposed / ablation / metric / seed / status 字段。
- [ ] 提供 AI 生成实验设计，但必须要求用户确认。
- [ ] 支持导出 Excel / Markdown。

### 阶段 4：本地 AI Runtime Center

- [ ] 设置页或独立页面展示 NLLB / Argos / pdf2zh / API provider 状态。
- [ ] 展示任务队列、缓存命中、失败日志。
- [ ] 增加环境检测命令和可复制修复建议。

### 阶段 5：代码复现映射

- [ ] 支持导入本地代码仓库路径。
- [ ] 自动读取关键文件并生成技术栈总结。
- [ ] 识别最小运行入口、训练入口、评估入口。
- [ ] 支持粘贴报错日志并生成定位建议。

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
- 不要大规模重构当前代码；优先小步迁移和兼容现有数据。
- 不要重复实现成熟开源库已有能力；先评估开源方案和 license。
- 不要让 AI 生成不可追溯结论；重要结论必须能回到 PDF、代码、实验或日志证据。
- 不要为了跑通演示而跳过错误、吞异常或删除核心逻辑。

## 7. 问题台账

| 日期 | 问题 | 根因 | 处理状态 | 后续动作 |
| --- | --- | --- | --- | --- |
| 2026-06-29 | 缺少项目级协作规则和长期计划文件 | 计划主要存在于聊天记录，后续容易脱离方向 | 已建立 `AGENTS.md` 和 `PLAN.md`，并把 `DESIGN.md` 加入固定入口 | 后续每次改动前先读 README、PLAN 和 DESIGN，并更新本文件 |
| 2026-06-29 | 当前 UI 质量不足，不能作为未来界面参考 | 早期界面围绕 PDF 翻译和功能入口堆叠，尚未形成 AI 科创研发闭环的统一设计系统 | 已建立 `DESIGN.md`，明确采用 IBM / Carbon + Mintlify + Supabase + Cursor 的组合参考 | 后续 UI 改造先按 `DESIGN.md` 设计项目空间、导航、实验矩阵、Runtime Center 和证据链页面 |

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
| 2026-06-29 | 首页和导航迁移为 AI 科创项目空间；新增项目空间快照模型；视觉检查改为验证 research workbench | `npx vitest run src\renderer\components\HomePage.test.ts src\renderer\components\AppSidebar.test.ts src\renderer\lib\researchProjects.test.ts`、`npm run typecheck`、`npm run build:renderer`、`npm run visual:check` | 通过 | `visual:check` 输出在 `.tmp-visual-check`；未引入 GSAP，当前阶段不需要新增动效依赖 |
