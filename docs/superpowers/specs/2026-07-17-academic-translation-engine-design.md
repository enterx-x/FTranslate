# Academic Translation Engine Design

## 1. Problem

旧链路虽然显示“本地 NLLB / Argos”，但真实学术摘要中仍反复出现 `policy -> 政策`、`training -> 培训`、`humanoid -> 人体/人造人`、`ablation studies -> 消化研究` 等错误。继续叠加论文级字符串替换只能遮住样例，不能泛化。

核心目标是建立专用机器翻译闭环：高质量专用 MT 为主、术语约束在推理前生效、结构字面量可逆恢复、失败时明确降级、旧坏缓存自动失效，同时保持热启动后的秒级响应。

## 2. Selected engine

默认首选腾讯官方 `Hy-MT2-7B Q4_K_M` 质量档；`Hy-MT2-1.8B Q4_K_M` 只作为低显存快速档：

- 它是翻译专用模型，不使用聊天 API，也没有按 token 计费；
- 7B GGUF 约 4.31 GiB，可在本机 RTX 4060 Laptop 8 GB 上完整 CUDA 驻留并保留约 1.8 GiB 显存余量；30B 超出系统内存，7B Q6/Q8 会压缩稳定余量，因此不作为本机默认；
- 模型许可证为 Apache-2.0，优于现有 NLLB 权重的 CC-BY-NC-4.0 产品风险；
- 支持术语干预提示，避免先生成错误译文再猜测修复；
- 本机 7B 冷启动首组翻译约 4.13 秒；模型常驻后的完整 arXiv 标题、摘要、质量检查和 SQLite 缓存集成测试约 1.08 秒。

NLLB CTranslate2 int8 与 Argos 继续保留为降级链，不再承担默认质量上限。

## 3. Engine routing

- `hy-mt-first` -> `hy-mt2`, `nllb-ct2`, `argos`（默认）
- `hy-mt-only` -> `hy-mt2`
- `nllb-first` -> `nllb-ct2`, `argos`
- `argos-first` -> `argos`, `nllb-ct2`
- `nllb-only` -> `nllb-ct2`
- `argos-only` -> `argos`

默认链按顺序尝试启动；质量降级只从真实已用引擎的下一项开始，避免 HY-MT2 未安装时重复调用 NLLB。

## 4. Terminology and structure

`academicTranslationGlossary.ts` 保存带版本号、最长匹配优先的通用英中术语表，覆盖 RL、机器人、触觉、安全控制、PINN、ODE/PDE 与通用论文表达。

- HY-MT2：术语保持在源文中，以官方“参考下面的翻译”格式注入提示，模型可以同时处理术语与中文句法。
- NLLB / Argos：常规路径和 HY 失败后的降级路径都使用独立的低碰撞数字占位符进行强约束，避免模型把 `policy`、`training` 等翻错。
- 公式、代码、引用、URL、DOI 与 arXiv 标识始终使用可逆占位符；每段最多四个标记，降低小模型丢标记概率。
- 论文方法名、首字母缩写和标题冒号前的名称继续由通用修复层保留，不增加单篇论文完整句子规则。

## 5. Runtime and security

`HyMt2Runtime` 在 Electron 主进程按需启动本地 `llama-server`：

- 仅绑定 `127.0.0.1`；
- 每次运行生成随机 API key，避免网页跨域调用无鉴权的本地服务；
- 两个并发 slot，用连续批处理提高多摘要吞吐；
- 启动后复用模型，不为每句重复加载约 4.31 GiB 的 7B 权重；
- 应用退出时关闭子进程；异常退出可重新拉起；
- 安装脚本同时下载 llama.cpp CUDA 主包与官方 CUDA DLL 包，运行时不依赖系统 Python、PyTorch 或全局 CUDA。

模型不进入主安装包。用户按需执行 `scripts/install-hymt2-gguf.ps1`；默认 `quality` 安装 7B，`-Profile fast` 安装 1.8B。脚本执行固定 SHA-256 校验、保存许可证并写入当前用户环境变量，同时保留已安装的另一档模型。

## 6. Cache and failure policy

- arXiv 缓存 identity 升至 version 9，并包含 glossary version 与实际 HY-MT2 模型 identity；切换质量档不会错误复用另一模型的旧译文。
- 模型无输出、英文回声、乱码、严重截断、重复尾段或占位符损坏时不写缓存。
- 英文重合检测同时计算中文实质占比：允许保留 RoboCasa、ManiSkill、MetaWorld 等正式名称的自然中文标题，但拒绝只加“中文：”前缀的源文回声。
- 设置页、arXiv 页面和 Runtime Center 显示真实 HY-MT2 / NLLB / Argos 状态，不把降级伪装成首选引擎成功。

## 7. Scope

本轮覆盖 arXiv 标题/摘要、PDF 划词和中文检索中调用的段落级本地翻译。PDFMathTranslate 的整篇版面重建保持独立；后续可让它复用同一术语版本和翻译记忆，但不在本轮重写其排版管线。
