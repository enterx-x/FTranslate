# 每日科研助手实施计划（主代理直接管理）

更新：2026-09-08。用户明确要求不使用 Superpowers 及相关技能；本文由主代理直接制定，取代此前技能流程。三个执行代理均为 Luna/MAX，只向主代理报告，不转派、不创建其他任务。

## 一、交付目标与范围

每天为用户筛选有限数量的相关 arXiv 新论文，说明推荐依据；从结果直接下载阅读，反馈可以撤销，偏好和历史重启不丢。界面以日常使用为目的，保留今日、论文库、arXiv 检索、PDF 阅读、设置。实验矩阵等退出导航，数据不删除。

首版只承诺本地桌面应用运行时定时执行、启动补跑当日任务、Windows 通知。没有云端调度、邮件或手机推送，不新增账号或外部依赖。不自动下载全文，也不能声称已经读过正文或验证代码。

## 二、共同接口和协作约束

权威类型：`src/shared/dailyBrief.ts`。`DailyBriefPreferences` 包含 enabled/time/interests/excludeTerms/maxPapers/useAi；`DailyBriefSnapshot` 包含 preferences/briefs/feedback/running/lastError/lastAttemptAt。论文使用已有 `ArxivPaper`；证据等级固定 abstract。

主进程 API：`createDailyBriefService({storagePath,search,complete,onChange,notify,now})`；getSnapshot/savePreferences/run/setFeedback/removeFeedback/tick 返回 Promise，dispose 为同步。now 返回 Date；onChange 接 snapshot；notify 接新生成的 brief。main 在启动后和每 30 秒调用 tick，service 不另开重复计时器。

IPC 为 daily-brief:snapshot/save-preferences/run/feedback/remove-feedback；事件 daily-brief:changed 与 daily-brief:open。preload 和 ElectronApi 声明由主代理维护。

UI `DailyBriefPage` props：snapshot/error/busy/onSavePreferences/onRun/onFeedback/onRemoveFeedback/onOpenPaper/onOpenLibrary/onOpenSearch。前六项操作函数按既有合同返回 Promise；失败会 reject，组件必须 catch，不能假报成功。组件不能自己访问文件、额外请求 API 或另建 localStorage 数据源。

文件不得交叉改动。接口需要变化时向主代理提出具体原因、调用方和迁移方式，获协调后再改。代理不要改 README/PLAN/DESIGN/共享报告，不要 git 提交推送，不要全局配置或安装依赖；主代理统一处理。

## 三、A：简报服务代理的详细任务

归属：src/shared/dailyBrief.ts、对应测试；src/main/dailyBriefService.ts、对应测试；同目录必要的新 dailyBrief 辅助模块。

1. 默认 enabled=false/useAi=false、08:30、5 篇，兴趣为空。显示数量限制 1–20；历史最多30份、反馈最多500条。用户保存偏好时检查 HH:mm 真正合法、兴趣非空、文本上限，不能把错误输入静默保存成另一配置。
2. 初始化读取 userData JSON。不存在则空状态，格式损坏不得覆盖原始文件伪装初始化成功；显示可处理错误。写入使用临时文件替换与串行写队列；磁盘错误向调用方传播，界面不能显示已保存。
3. tick 使用本机日期和时间：关闭/未配置/未到时刻不运行；已到时刻且当天没有成功任务则补跑。并发手动和定时只执行一份；成功含零结果也记为当天完成；失败保留历史并至少15分钟退避，重启也尊重失败时间。
4. run 可在关闭自动时手动运行；不得绕过兴趣校验。同一任务快照固定配置，运行期间保存配置要拒绝或在发布结果前核对版本，不能混用新旧偏好。完成/失败都释放 running。
5. 检索复用注入 search，按 submittedDate 降序获取有限候选（单查询<=50；最多3查询）。只推荐近期论文（首版7天，说明窗口）；稳定ID去版本去重。排除 dismissed、已有简报见过的论文；没有相关候选则零篇，不补旧论文凑数。陈旧缓存/上游失败不可当作新检索成功。
6. 规则模式只基于实际关键词/类别匹配，summary保留公开原文，不伪造中文摘要。中文兴趣复用已有查询处理能力或明确提示需提供英文关键词；不要把中文整句直接产生无效复杂查询还声称正常。
7. AI 模式最多2次模型调用：兴趣转检索词；候选排序和短摘要。反馈提供有界正负线索；不相关至少不再推荐此论文，正反馈的实际作用要可测试。模型不能自造论文、链接、ID、代码状态或证据等级；白名单映射回输入候选，未知ID/重复/无效JSON严格过滤或透明回退。
8. 提示词将论文摘要视为不可信材料。AI失败、没有Key、模型无结果时保留明确warning并规则回退；不能把失败说成AI已完成。主代理HTTP已覆盖正文45秒超时/maxTokens4096，服务仍控制总调用数。
9. 反馈按canonical stableId upsert，撤销单条，不扩大成不可解释的黑箱偏好。反馈title/topics限制长度且仅用合法字符串。历史返回克隆或不可变快照，外部修改不能污染内部状态。
10. onChange/notify 仅表示已提交状态。通知失败不得把成功简报变成失败，也不得重复发送。dispose后不再产生通知；定时由main负责。

验收用例：到时/未到/跨日/启动补跑；manual+tick并发；失败退避；重启持久化；失败/无结果保留历史；版本ID去重；7天窗口；排除与撤销；AI错ID/假链接/坏JSON/报错；存储损坏/写失败；运行中改偏好。报告精确测试数量及未覆盖边界。

## 四、B：今日页面代理的详细任务

归属：DailyBriefPage.tsx、DailyBriefPage.module.css、对应测试及仅服务本页的新辅助文件。

1. 页首使用「今日」或「今日论文」与真实日期，不用巨型hero。最重要操作为生成简报/研究兴趣，论文列表是主内容。控件沿用冷白、中性文字、蓝灰边框。
2. 新用户看到空状态与配置表单：兴趣多行输入、排除词、本地时间、数量1–20、启用每日任务、可选AI。只要未保存，生成使用旧偏好容易误导，因此禁用生成并提示先保存，或明确先保存后生成。
3. 每次后台snapshot变化不能覆盖脏表单。保存成功清脏，失败保留输入并显示错误；请求进行中禁用重复操作，所有async事件catch。不能因为反馈更新把其他文本重置。
4. 区分加载、未配置、自动关闭、生成中、今日无匹配、失败但有旧结果、已生成等状态。昨天的最新简报标题写实际日期/最新简报，不冒充今日；有warning即显示。
5. 每篇展示标题、作者/发布日期、摘要、推荐理由、建议读哪里、基于摘要的边界。没有全文时readingHint只能建议去读实验章节，不能标具体未查证图表页码。
6. 操作：下载并阅读、想读、稍后看、不相关。稍后看是反馈收藏，下载阅读后才保证进入论文库；文案清楚，不显示虚假的下载成功。反馈区按ID定位briefs里的paper提供打开阅读，并能撤销；历史也可打开论文。
7. 不相关文案按实际后端能力：至少不再推荐此篇；若后端没实现相似抑制，不写减少相似推荐。保留反馈行和恢复入口，不能隐藏后无法撤销。
8. AI说明清楚会使用已保存模型服务、研究兴趣和公开摘要。定时说明只在桌面运行时有效，启动补跑；不承诺关机手机推送。
9. 1366/1440/1920长中文/长英文、错误字符串、空历史、长列表不横向溢出；主列表可自然滚动，按钮可聚焦并有disabled/focus态。CSS仅局部，减少重复状态横幅和按钮。

验收：输入脏状态保留；保存失败可重试；旧日期显示；反馈撤销/回看；空列表与状态文案；真实DOM截图由主代理运行视觉脚本后审查，代理根据截图修复。

## 五、C：导航/视觉代理的详细任务

归属：AppSidebar.tsx/tests/局部CSS，HomePage.tsx/tests，scripts/visual-check.mjs及必要新daily-brief视觉脚本。

1. Sidebar仅显示workspace(今日)、library、arxiv、reader、settings；旧union/props保持源码兼容但不可见，不删除用户数据。
2. HomePage只展示论文库：导入、打开、编辑元数据、删除记录；旧研发看板/KPI/实验矩阵/图谱/PPT捷径移除。hub路由已由root改为DailyBriefPage，不需要这里重复今日。
3. 保留reader和arxiv现有真实下载/选段/双语验证，不因为导航改变而全部跳过。旧实验/表格/图谱场景可以留函数，但默认不执行也不报已通过。
4. npm run visual:check 必须能覆盖今日、论文库、PDF、arxiv、设置。修改旧runHomeScenario和ready等待，确保新首页后能转入library并打开样本。设置当前tabs general/pdf/ai/notes/export/data，AI已原位配置。
5. 使用隔离userData，与已有mock arxiv。严禁改真实用户偏好/Key/论文库。测试删除目录前确认绝对路径在.tmp-visual-check之内；不要触及用户语料。
6. 今日至少截图：首次配置、长文本推荐、生成错误保留历史、反馈撤销；1366/1440/1920。尽量调用真实daily IPC+fake arxiv，不只DOM造卡。可用隔离文件种子覆盖AI数据/错误状态，标注mock。
7. 断言页面水平溢出、可见按钮无遮挡、长标题换行、状态错误可见、来源标签、未保存表单不被feedback覆盖。截图保存在.tmp-visual-check/daily-*。
8. 在root构建完成前不启动完整visual脚本；可做语法检查与组件测试。报告可运行命令、输出目录和需要root协助的情形。

## 六、主代理任务与交付

主代理负责main/preload/IPC/types/App/useDailyBrief/Settings接线，AI HTTP超时与目的地址凭据隔离，现有论文查重与下载打开，通知点击回今日。审查所有代理文件和真实测试结果，处理跨层竞态。

最终运行npm test、typecheck、npm run dist、npm run visual:check，人工查看新页面及关键阅读截图。按需要构建移动端验证共享类型无回归。只stage本次文件，不混入原有8个移动PDF改动；本地安装包包含当前工作区源码需明示。README/PLAN/DESIGN记录能力、限制、实际验收；git提交推送由root完成。

代理完成后只发一份直接报告：改动文件、功能、测试命令/结果、已知限制、需主代理决策；主代理验收后才标完成。
