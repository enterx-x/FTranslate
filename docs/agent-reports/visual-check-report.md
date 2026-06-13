# FTranslate 视觉检测报告

生成时间：2026-06-13  
执行方式：视觉检测子智能体因额度耗尽失败，当前由统筹智能体根据现有 `npm run visual:check` 和用户截图继续记录。

## 已知验证命令

```powershell
npm run visual:check
```

输出目录：

```text
D:\FTranslate\.tmp-visual-check
```

## 当前视觉风险

1. arXiv 搜索页结果区在 1366 宽屏下容易过密，需要继续确认紧凑模式是否隐藏详情面板。
2. 首页卡片在小高度窗口下仍可能出现内容截断，需要检查 1366x768。
3. 设置页左侧分类曾出现文字挤压，需持续回归。
4. AI 助手拖拽分栏存在边界 bug，拖动过度可能导致右侧栏不可用。
5. PPT 预览页内容曾过于空泛，需检查导出前预览和 PPTX 一致性。
6. PDF 阅读页右侧面板按钮较多，需避免窄屏纵向挤压。
7. 知识图谱节点标签在节点多时可能重叠。
8. 研究表格页工具栏在低高度屏幕下可能占用过高。
9. arXiv 搜索空状态和有结果状态视觉差异较大，需要统一。
10. 离线翻译未配置提示应该是轻量 inline notice，不应挤压搜索结果。

## 建议检查尺寸

```text
1366x768
1440x900
1536x864
1920x1080
Windows 125%
Windows 150%
```

## 后续视觉任务

1. 为 `visual-check.mjs` 增加 arXiv 三种布局截图。
2. 为 `visual-check.mjs` 增加 Argos 未配置提示截图。
3. 为 `visual-check.mjs` 增加 PPT 质量检查失败但允许导出的截图。
4. 在视觉报告中保存 console errors 和 failed selector。
5. 生成截图索引 HTML，减少人工打开多个 PNG 的成本。
