# Paper-to-Method MVP 设计规格

日期：2026-06-30

状态：设计闸门，等待人工 review 后进入实现。

## 1. 第一性原理判断

FTranslate 要作为参赛产品，不应把重点放在“生成参赛材料”或“再做一个 PDF 翻译器”。真实目标用户是高校实验室、AI 创业团队和园区科创企业，他们的核心问题是：

1. 论文读完后，方法结构仍然停留在自然语言摘要里，无法直接进入复现、对照实验和产品化验证。
2. AI 可以回答问题，但回答经常没有页码、段落、图表或公式证据，结论不可审查。
3. 研发团队需要的不是更多聊天记录，而是可写回项目空间、可编辑、可比较、可追踪的研发对象。
4. 小团队没有完整 MLOps 平台，也缺少把论文、代码、实验矩阵和模型运行状态连接起来的轻量工具。

因此第二阶段的不可压缩核心闭环是：

> PDF / 图表 caption / 阅读笔记 -> 结构化方法卡 -> 字段级证据链 -> 人工确认 -> 写回项目空间。

如果这个闭环成立，后续才能自然接上 Paper-to-Code、实验矩阵、Evidence Graph 和 Research Autopilot。如果只生成摘要、PPT 或参赛说明，就没有形成可复用研发资产。

## 2. MVP 范围

### 2.1 本阶段要做

1. 新增 Paper-to-Method 方法卡数据模型。
2. 从已有 PDF 文本块、Figure / Table caption 和阅读笔记中抽取候选证据。
3. 生成一张可编辑、可审查的方法卡。
4. 每个非空字段必须绑定至少一个 evidence source。
5. 没有证据的字段保持空值或标记为 `unconfirmed`，不允许编造。
6. 方法卡保存到本地项目空间，保留版本和更新时间。
7. 提供显式写回入口，把方法卡摘要写入研究表格或项目结构化数据。
8. 补充单元测试，覆盖抽取、证据绑定、序列化和无证据保护。

### 2.2 本阶段不做

1. 不引入新的大型 PDF 解析依赖。
2. 不接入外部 RAG 服务。
3. 不做全自动多 Agent 研发推进。
4. 不自动覆盖研究表格已有内容。
5. 不做多论文方法对比的完整 UI，只在数据模型中预留扩展空间。
6. 不把 AI 输出当成事实；AI 只能基于已选 evidence pack 做改写和补全建议。

## 3. 用户工作流

1. 用户在项目空间或 PDF 阅读器中选择一篇论文。
2. 用户点击“生成方法卡”。
3. 系统读取当前论文已有的 PDF 文本块、图表 caption 和阅读笔记。
4. 本地抽取器先生成字段候选和证据候选。
5. 方法卡页面展示三栏：
   - 左侧：章节、图表、公式、笔记证据列表；
   - 中间：方法卡结构化字段；
   - 右侧：当前字段绑定的原文证据、置信度和 review 操作。
6. 用户逐项确认、编辑或拒绝字段。
7. 用户保存方法卡到项目空间。
8. 用户显式选择写回研究表格或继续进入实验矩阵。

## 4. 数据模型

### 4.1 MethodCard

```ts
export interface MethodCard {
  id: string;
  projectId: string;
  paperId: string;
  title: string;
  status: 'draft' | 'needs-review' | 'verified';
  fields: MethodCardField[];
  evidenceSources: EvidenceSource[];
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

### 4.2 MethodCardField

```ts
export interface MethodCardField {
  key: MethodCardFieldKey;
  label: string;
  value: string;
  confidence: number;
  evidenceSourceIds: string[];
  reviewState: 'unconfirmed' | 'accepted' | 'rejected';
}
```

字段 key：

- `problem`
- `inputOutput`
- `modelArchitecture`
- `trainingObjective`
- `lossFunction`
- `constraints`
- `datasetOrEnvironment`
- `baseline`
- `metrics`
- `claimedContribution`
- `limitations`
- `reproductionRisk`

### 4.3 EvidenceSource

```ts
export interface EvidenceSource {
  id: string;
  paperId: string;
  type: 'pdf-text' | 'figure-caption' | 'table-caption' | 'note';
  page?: number;
  section?: string;
  locator: string;
  text: string;
  score: number;
}
```

## 5. 抽取策略

本阶段优先使用本地确定性抽取，不先引入新依赖。

1. 章节优先级：
   - `Abstract` / `Introduction`：problem、claimedContribution；
   - `Method` / `Approach` / `Model`：modelArchitecture、trainingObjective、lossFunction、constraints；
   - `Experiment` / `Evaluation`：datasetOrEnvironment、baseline、metrics；
   - `Conclusion` / `Limitation`：limitations、reproductionRisk。
2. caption 优先级：
   - Figure caption 常用于 modelArchitecture、pipeline、module relation；
   - Table caption 常用于 baseline、metrics、dataset、ablation。
3. 笔记优先级：
   - 用户笔记中的“疑问”“复现计划”“局限”“可借鉴点”可补充 reproductionRisk、limitations、claimedContribution。
4. 字段写入规则：
   - 没有 evidenceSourceIds 的字段不得写入非空 value；
   - 证据分数低时字段状态为 `unconfirmed`；
   - 用户编辑后仍保留原 evidenceSourceIds，并允许新增 note 作为证据。
5. AI 使用规则：
   - AI 输入必须是 evidence pack，而不是整篇无界上下文；
   - AI 输出只用于重写字段表达，不用于创造没有证据的新事实；
   - AI 输出中未覆盖证据的字段仍保持 `unconfirmed`。

## 6. UI 设计基准

页面遵循 `DESIGN.md` 的 Paper-to-Method 三栏结构。

左侧证据栏：

- 章节目录；
- Figure / Table caption；
- 阅读笔记；
- 证据类型、页码、section、短文本。

中间方法卡：

- 高密度表单，不做营销式卡片堆叠；
- 每个字段显示 reviewState、confidence 和证据数量；
- 空字段明确显示“缺少证据”，不显示通用占位答案。

右侧审查栏：

- 当前字段绑定证据原文；
- 接受、拒绝、改写、补充笔记；
- 保存目标和最近一次写回记录。

## 7. 写回与兼容性

1. 新增本地持久化 key：`pdfTranslationReader:methodCards`。
2. 不修改旧论文库、研究表格、PPT 草稿和 PDF 阅读器的已有 localStorage key。
3. 通过 `projectId` 和 `paperId` 关联现有 `pdfTranslationReader:researchProjects`。
4. 写回研究表格时必须是用户显式动作。
5. 如果同一 paperId 已有方法卡，新保存产生 version 增量，不静默覆盖。
6. 导出或写回时保留 evidence locator，便于后续 Evidence Graph 复用。

## 8. 开源复用策略

本阶段不新增依赖，复用现有 PDF.js 文本块、caption 抽取、阅读笔记和项目空间状态。

后续如果进入更强 PDF 结构化和 citation-grounded QA，可优先评估：

- `docling-project/docling`：MIT，适合文档结构化、表格和版面分析；
- `Future-House/paper-qa`：Apache-2.0，适合科学文献 citation-grounded RAG；
- `PptxGenJS`：已在项目中使用，继续用于可编辑 PPT 输出。

不直接复用 AGPL 项目代码，除非明确接受许可证传染和发布义务。

## 9. 对抗式审查

### 风险 1：方法卡变成“AI 总结”

失败模式：字段有漂亮中文，但没有页码、caption、笔记或原文片段。

约束：字段非空必须有 evidenceSourceIds；没有证据则空值或 `unconfirmed`。

### 风险 2：错误证据支撑错误字段

失败模式：实验结果 caption 被用来支撑模型结构，或者 limitation 被误当贡献。

约束：抽取器按 section、caption 类型和关键词共同打分；低分字段默认需要人工确认。

### 风险 3：破坏现有数据

失败模式：写回研究表格时覆盖用户已有列，或迁移 localStorage 导致旧论文库异常。

约束：新增独立 key；写回必须显式；旧 key 只读兼容。

### 风险 4：功能入口存在但没有闭环

失败模式：首页有入口，点进去只能聊天或生成文本，无法保存成研发对象。

约束：MVP 验收必须包含保存方法卡、再次打开恢复、字段证据可见。

### 风险 5：过早引入重依赖

失败模式：为了结构化抽取引入大模型、RAG、OCR 或复杂 Python sidecar，导致 Windows 打包和部署风险上升。

约束：MVP 只用已有本地材料；新依赖进入后续评估，不阻塞第一版闭环。

### 风险 6：UI 信息密度失控

失败模式：三栏页面变成卡片堆叠，字段、证据、操作互相遮挡。

约束：UI 修改后必须运行 `npm run visual:check`，并人工查看相关截图。

## 10. 验收标准

1. 选择已有论文后能生成一张 MethodCard。
2. 至少 6 个字段能在有证据时填入候选值。
3. 每个非空字段都能定位到 evidence source。
4. 无证据字段不会被填入通用空话。
5. 方法卡可保存、刷新后恢复。
6. 写回研究表格或项目结构化数据必须由用户显式触发。
7. 单元测试覆盖方法卡 schema、抽取器、证据绑定和 localStorage 序列化。
8. UI 修改阶段通过 typecheck、build、visual check，并完成视觉对抗式审查。

## 11. 实现切分

第一步：数据和抽取核心。

- `src/renderer/lib/methodCards.ts`
- `src/renderer/lib/methodCards.test.ts`
- 支持 schema、默认字段、证据抽取、序列化、写入保护。

第二步：项目空间状态接入。

- 关联 `researchProjects`；
- 新增 methodCards localStorage hook 或 context；
- 不改旧 paper library schema。

第三步：Paper-to-Method UI。

- 新增页面或面板；
- 三栏布局；
- 字段审查和保存。

第四步：写回和后续入口。

- 写回研究表格；
- 为实验矩阵预留入口；
- 在 Evidence Graph 中复用 method card evidence。

## 12. 人工 review 问题

实现前需要确认：

1. MVP 入口放在 PDF 阅读器、项目空间，还是两处都放？
2. 第一版写回优先写到项目空间结构化数据，还是研究表格新 sheet？
3. AI 改写是否进入第一版，还是先做纯本地确定性方法卡？

建议默认选择：两处入口、优先写项目空间、第一版不依赖 AI 改写。
