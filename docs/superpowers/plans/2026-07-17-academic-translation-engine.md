# Academic Translation Engine Implementation Plan

**Goal:** 用专用 HY-MT2 本地引擎提高 arXiv、PDF 划词与段落翻译质量，在热状态保持秒级响应，并保留 NLLB/Argos 降级。

## Task 1: 通用术语约束

- [x] 新增带版本号的 RL、机器人、控制与科学计算术语表。
- [x] 最长词优先、ASCII 边界、不重叠匹配回归测试。
- [x] NLLB/Argos 术语占位符与公式、代码、URL、引用恢复测试。
- [x] 限制每段标记数量，避免真实 NLLB 长段落丢失后续标记。

## Task 2: HY-MT2 专用翻译运行时

- [x] 固定模型与 llama.cpp 路径，可通过环境变量覆盖。
- [x] 默认选择 7B Q4 质量档，并保留 1.8B 快速档与按模型区分的缓存身份。
- [x] 实现官方术语干预 prompt、输出清洗与英中/中英方向。
- [x] 实现本地鉴权 server、健康检查、两路并发、超时、重启和退出清理。
- [x] 默认路由改为 HY-MT2 -> NLLB -> Argos，并保留旧偏好覆盖。
- [x] HY-MT2 使用可见术语，NLLB/Argos 使用强占位符。

## Task 3: 安装与真实验证

- [x] 新增 `scripts/install-hymt2-gguf.ps1`。
- [x] 固定并验证模型、llama.cpp、CUDA DLL 三个 SHA-256。
- [x] 保存 Apache-2.0 / llama.cpp 许可证并设置用户环境变量。
- [x] 在不继承系统/PyTorch CUDA 路径时完成独立启动健康检查。
- [x] 真实术语翻译集成测试通过。
- [x] 完整 arXiv 翻译、质量检查与 SQLite 缓存集成测试通过。

## Task 4: 状态、缓存与兼容

- [x] 设置页、arXiv 状态与 Runtime Center 增加 HY-MT2 状态。
- [x] arXiv 缓存版本升至 9，包含 glossary version 与实际模型 identity。
- [x] 保留旧 NLLB/Argos 显式选择与强制引擎调用。
- [x] 修复混合专名误判、伪中文前缀回声与 HY 降级后的术语保护。
- [x] 清理临时 HY-MT1.5 与重复评估文件，正式目录只保留 MT2。

## Task 5: 发布

- [x] 更新 README 与 PLAN 的用户说明、实测数据和风险记录。
- [x] 将版本从 0.1.35 升至 0.1.36。
- [x] 运行聚焦测试、typecheck、build 与必要视觉检查。
- [x] 检查非 13 号绘图 worktree，不合并其改动。
- [x] 运行 `npm run dist` 并校验安装包 SHA-256。
- [ ] 检查 diff，提交并推送当前分支。
