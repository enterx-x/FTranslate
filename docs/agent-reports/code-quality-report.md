# FTranslate 代码检测报告

生成时间：2026-06-13  
执行方式：代码检测子智能体因额度耗尽失败，当前由统筹智能体继续记录。

## 已知验证命令

```powershell
npm test
npm run typecheck
npm run build
npm run visual:check
npm run dist
```

## 当前代码风险

1. GitHub 推送依赖 HTTPS git 传输，当前环境 TCP 通但 git push 被 reset；需要备用上传方案或 SSH key。
2. Argos CLI 原先只依赖 PATH；已增加 `FTRANSLATE_ARGOS_CLI` 环境变量支持，但还需要设置页可视化检测。
3. Argos 安装依赖较重，包含 torch/spacy/stanza；需要在 README 中说明磁盘占用。
4. arXiv 搜索与翻译缓存逻辑分布在 renderer 和 main，需要继续保证 key 命名集中管理。
5. arXiv 备选论文库使用新 localStorage key，后续应加迁移/导出能力。
6. arXiv 搜索限流日志应确认不会记录敏感 token。
7. PDFMathTranslate 错误解析还不够结构化。
8. PPT 质量检查如果过严会阻断导出，应改成 warning gate。
9. 视觉检查脚本覆盖面不足，缺少 arXiv 页面布局状态。
10. README 与实际安装路径可能不一致：当前 Argos 实装在 `E:\FTranslateTools\argos-conda`，README 示例仍是 `%LOCALAPPDATA%` venv。

## 建议测试补充

1. `ArxivTranslationService`：测试 `FTRANSLATE_ARGOS_CLI` 生效。
2. arXiv UI：测试备选论文过滤和移除。
3. arXiv UI：测试中文缓存默认显示。
4. PPT 导出：测试质量警告不阻断导出。
5. 设置页：测试路径输入不会修改旧 localStorage 数据。

## 推荐修复顺序

1. 补 Argos env var 单元测试。
2. 在设置页增加 Argos 检测摘要。
3. 修 GitHub push 或记录备用命令。
4. 扩展 visual-check 覆盖 arXiv。
5. 优化 PPT 导出质量检查策略。
