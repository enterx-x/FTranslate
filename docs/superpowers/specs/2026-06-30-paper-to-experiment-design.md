# Paper-to-Experiment 证据驱动实验设计闭环

日期：2026-06-30

状态：设计规格。等待用户 review 后进入 implementation plan。

## 1. 第一性原理判断

FTranslate 下一阶段的核心目标不是“多做一个实验矩阵页面”，而是证明产品能把论文材料转成可执行、可审查、可复用的研发对象。

真实用户是高校实验室、AI 创业团队和园区科创企业。用户在论文阅读后的真实瓶颈是：

1. 读懂论文不等于知道怎么复现。
2. 论文里的 baseline、指标、环境和约束经常散在 Method、Experiment、Figure、Table 和笔记里。
3. 研究 idea 很容易停留在聊天记录或自由表格里，缺少可执行实验行。
4. 普通 AI 可以生成建议，但如果没有证据来源、控制变量和确认状态，建议不可审查。
5. 小团队需要的是轻量研发闭环，而不是完整 MLOps 平台。

因此下一阶段的不可压缩闭环是：

> PDF 论文 -> 字段级证据 -> 方法卡 -> 人工确认 -> 实验矩阵 -> 导出或写回项目空间。

如果这个闭环成立，产品就不再只是 PDF 翻译器、论文总结器或参赛材料生成器，而是本地 AI 科创研发工作台。

## 2. 产品边界

### 2.1 本阶段要做

1. 建立 Paper-to-Experiment 页面工作流。
2. 接入已有 `MethodCard` 数据核心和 `ExperimentMatrixRow` 生成核心。
3. 提供方法卡审查界面：字段、证据、确认状态、编辑入口。
4. 提供独立实验矩阵页面：baseline、proposed、ablation、metrics、seeds、status、evidence。
5. 将方法卡和实验矩阵与项目空间关联，刷新后可恢复。
6. 支持用户确认后生成实验矩阵，不自动覆盖研究表格。
7. 支持 Markdown 和 Excel 导出。
8. 首页下一步动作能进入“生成方法卡 -> 生成实验矩阵”的真实流程。

### 2.2 本阶段不做

1. 不替换 Univer 研究表格。
2. 不把 AI 输出直接当作 verified 事实。
3. 不做完整多 Agent Research Autopilot。
4. 不做代码仓库复现映射的完整实现。
5. 不引入新的大型 PDF 解析、RAG 或 workflow 依赖。
6. 不做参赛材料生成器；导出内容是研发计划，不是路演文案。

## 3. 核心用户流程

### 3.1 从论文生成方法卡

1. 用户在项目空间、论文库或 PDF 阅读器中选择一篇论文。
2. 用户点击“生成方法卡”。
3. 系统读取已有 PDF 文本块、Figure / Table caption 和阅读笔记。
4. 系统调用已有方法卡抽取核心生成 `MethodCard`。
5. 方法卡页面显示三栏：
   - 左侧：证据列表；
   - 中间：方法卡字段；
   - 右侧：选中字段的证据原文、页码、caption 和操作。
6. 用户对字段执行接受、拒绝、编辑、补充笔记。
7. 方法卡保存到本地持久化状态。

### 3.2 从方法卡生成实验矩阵

1. 用户在方法卡页面点击“生成实验矩阵”。
2. 系统只读取已绑定证据的字段。
3. 系统调用 `buildExperimentMatrixRowsFromMethodCard` 派生 baseline、proposed、ablation 行。
4. 系统显示预览，状态默认为 `planned`。
5. 用户确认后写入实验矩阵状态。
6. 用户进入实验矩阵页面继续编辑 seeds、metrics、expected result、failure diagnosis 和 status。

### 3.3 导出研发计划

1. 用户在实验矩阵页面点击导出。
2. Markdown 导出用于研发会议和记录。
3. Excel 导出用于实验跟踪和人工协作。
4. 导出内容必须包含 evidence locator，不能只输出实验描述。

## 4. 信息架构

### 4.1 页面入口

新增或强化以下入口：

- 首页下一步动作：当前论文有 PDF 但无方法卡时，显示“生成方法卡”。
- 方法卡页面动作：方法卡有 baseline、method、metrics 或 constraints 时，显示“生成实验矩阵”。
- 左侧导航实验矩阵：进入独立实验矩阵页面。
- 研究表格：保留跳转入口，但不作为矩阵本体。

### 4.2 Paper-to-Experiment 工作区

推荐页面结构：

```text
┌──────────────┬──────────────────────────────┬──────────────────────┐
│ Evidence     │ Method Card                  │ Field Evidence       │
│ sections     │ structured fields            │ source and review    │
├──────────────┴──────────────────────────────┴──────────────────────┤
│ Action bar: save method card / generate experiment matrix / export  │
└─────────────────────────────────────────────────────────────────────┘
```

设计约束：

- 三栏是工作台，不是营销页。
- 字段和证据使用行态、表格、状态 badge，不使用装饰性卡片堆叠。
- 右侧证据面板必须显示来源定位，不能只显示 AI 改写文本。

### 4.3 实验矩阵页面

推荐页面结构：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Top filter: paper / group / status / metric / evidence coverage      │
├──────────────────────────────────────────────┬──────────────────────┤
│ Experiment matrix table                       │ Experiment detail    │
│ baseline / proposed / ablation rows           │ evidence and logs    │
└──────────────────────────────────────────────┴──────────────────────┘
```

设计约束：

- 主体是高密度表格。
- 右侧详情显示选中实验的证据、假设、控制变量、失败诊断和导出状态。
- 研究表格是自由工作簿；实验矩阵是结构化实验对象。两者可以跳转，不能互相覆盖。

## 5. 数据模型

### 5.1 复用现有模型

已存在并应继续复用：

- `MethodCard`
- `MethodCardField`
- `EvidenceSource`
- `ExperimentMatrixRow`
- `buildExperimentMatrixRowsFromMethodCard`
- `buildExperimentMatrixWorkbookFromMethodCards`
- `ResearchWorkbook`

### 5.2 新增持久化状态

建议新增轻量本地状态：

```ts
export interface ExperimentMatrixState {
  projectId: string;
  rows: ExperimentMatrixRow[];
  selectedRowId: string | null;
  updatedAt: string;
  version: number;
}
```

存储键：

```text
pdfTranslationReader:experimentMatrices
```

约束：

1. 每个 `projectId` 对应一个实验矩阵状态。
2. `row.id` 稳定，不因重新打开页面变化。
3. 用户编辑过的行不得被重新生成结果静默覆盖。
4. 重新生成时需要对比新增、已存在和冲突行。
5. 冲突行进入 `needs-review` 或 `blocked` 状态，而不是直接覆盖。

### 5.3 行状态

实验行状态：

- `planned`：已设计，尚未运行。
- `running`：用户标记正在运行。
- `blocked`：缺少代码、数据、环境或证据。
- `done`：用户标记完成。

后续可扩展但本阶段不强制实现：

- `verified`
- `failed`
- `needs-review`

## 6. AI 使用规则

AI 可以参与三类任务：

1. 将 evidence pack 改写成更清晰的方法字段。
2. 根据已确认方法卡补充实验假设、失败诊断和 expected result。
3. 对矩阵行进行一致性检查，例如 metrics 是否为空、seeds 是否缺失、ablation 是否没有控制变量。

AI 不允许做三类事情：

1. 没有证据时凭空填入 baseline、dataset、metrics 或 claimed contribution。
2. 自动把草稿字段标记为 accepted。
3. 自动覆盖用户已经编辑的实验行。

AI 输出必须带有：

- 输入 evidence source ids；
- 生成目标字段；
- review state；
- 未覆盖证据的字段列表；
- 可回滚写入位置。

## 7. 错误处理

### 7.1 没有 PDF 文本块

页面显示“当前论文缺少可用文本块”，提供三个动作：

- 返回 PDF 阅读器重新加载；
- 使用已有 caption / 笔记生成低覆盖率方法卡；
- 暂不生成。

### 7.2 方法卡证据不足

如果 baseline 或 metrics 缺失，仍可保存方法卡，但实验矩阵生成按钮显示风险状态：

```text
缺少 baseline 或 metrics，当前只能生成 proposed 草稿。
```

### 7.3 重新生成冲突

如果已有用户编辑过的矩阵行，重新生成时不覆盖。界面显示：

- 新增行；
- 已存在行；
- 与用户编辑冲突的行；
- 用户选择保留现有、复制为新行或替换草稿。

### 7.4 导出失败

Markdown 导出失败时保留可复制文本。

Excel 导出失败时显示具体失败原因，并提供 Markdown fallback。

## 8. 开源复用策略

本阶段优先复用现有依赖，不新增大型依赖：

- 表格视图：优先复用现有 React 表格/样式和 `ResearchWorkbook` 模型。
- Excel 导出：优先复用项目已有 Excel / 文件导出能力。
- Markdown 导出：使用现有 Markdown 文档生成工具或轻量本地函数。
- PDF 证据：复用已有 PDF.js 文本块、caption 和阅读笔记。

后续需要更强文档结构化时再评估：

- `docling-project/docling`：MIT，适合 PDF / Office 结构化解析。
- `Future-House/paper-qa`：Apache-2.0，适合 citation-grounded literature QA。

不复制 AGPL 项目代码。

## 9. 对抗式审查

### 风险 1：页面看起来完整但没有闭环

失败模式：用户能看到方法卡和矩阵，却不能保存、恢复或导出。

约束：验收必须包含保存、刷新恢复、生成矩阵和导出。

### 风险 2：AI 生成内容不可追踪

失败模式：字段很好看，但无法回到 PDF 页码、caption 或笔记。

约束：非空字段和 AI 建议都必须显示 evidence source ids 或明确标记缺证据。

### 风险 3：误伤研究表格

失败模式：实验矩阵写回时覆盖 Univer 自由表格，破坏用户已有整理。

约束：实验矩阵使用独立状态；写回研究表格必须是显式动作。

### 风险 4：重新生成覆盖用户编辑

失败模式：用户改过 seeds、metrics 或 hypothesis 后，再生成一次被覆盖。

约束：用户编辑行优先保留；冲突必须进入 review 流程。

### 风险 5：UI 退化为卡片堆叠或粗糙线框

失败模式：页面不是高密度科研工作台，而是信息卡片墙或低质表格。

约束：按照 `DESIGN.md` 使用顶层 pane、表格、行态、状态 badge 和右侧详情。

### 风险 6：范围膨胀到 Autopilot

失败模式：提前做多 Agent、代码运行、环境修复，导致核心闭环延迟。

约束：本阶段只做方法卡审查、矩阵生成、持久化和导出；Autopilot 等后续阶段。

## 10. 验收标准

### 10.1 产品验收

1. 用户能从一篇论文生成方法卡。
2. 用户能看到每个非空字段的证据来源。
3. 用户能确认或编辑方法卡字段。
4. 用户能从已确认方法卡生成至少 baseline、proposed、ablation 三类实验行。
5. 用户能编辑实验矩阵中的 seeds、metrics、expected result、status。
6. 用户能查看每行实验对应的 evidence locator。
7. 用户能导出 Markdown 和 Excel。
8. 应用刷新后方法卡和实验矩阵仍可恢复。

### 10.2 技术验收

1. 单元测试覆盖方法卡 hook、实验矩阵 hook、冲突合并、导出格式。
2. UI 测试覆盖方法卡页面、实验矩阵页面和无证据空状态。
3. `npm run typecheck` 通过。
4. `npm run build` 通过。
5. UI 修改后 `npm run visual:check` 通过，并人工检查相关截图。
6. 代码任务完成后 `npm run dist` 通过。

### 10.3 演示验收

演示路径必须能在 3 分钟内说明产品差异：

1. 打开本地论文项目。
2. 生成方法卡并查看证据。
3. 确认关键字段。
4. 生成实验矩阵。
5. 展示 baseline / proposed / ablation 行。
6. 展示 evidence locator 和导出结果。

## 11. 实现切分建议

第一步：持久化 hook。

- `useMethodCards`：读取、保存、选择和更新方法卡。
- `useExperimentMatrix`：读取、生成、合并、编辑和保存实验矩阵。

第二步：方法卡审查 UI。

- 三栏布局；
- 字段状态；
- 证据详情；
- 保存和生成矩阵入口。

第三步：实验矩阵 UI。

- 独立页面；
- 表格主体；
- 筛选和状态；
- 右侧详情。

第四步：导出。

- Markdown 导出；
- Excel 导出；
- evidence locator 保留。

第五步：首页闭环。

- 根据当前项目状态显示下一步动作；
- 从首页进入方法卡或实验矩阵；
- 避免只显示功能入口。

## 12. 设计决策

1. 先做 Paper-to-Experiment，而不是 Runtime Center，因为它最能证明“论文到实验”的产品闭环。
2. 先做人工确认，不做全自动 Autopilot，因为科研场景需要可审查和可回滚。
3. 先复用现有 PDF 文本、caption 和笔记，不引入新解析依赖，降低 Windows 打包风险。
4. 实验矩阵独立于研究表格，避免破坏自由表格工作流。
5. 导出是研发计划，不是参赛材料；参赛叙事来自真实产品能力。
