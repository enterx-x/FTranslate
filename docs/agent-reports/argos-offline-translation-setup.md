# Argos 离线翻译本机配置记录

记录时间：2026-06-13

## 已安装内容

- 安装目录：`E:\FTranslateTools\argos-conda`
- Python：Conda 环境内 Python 3.10
- CLI：`E:\FTranslateTools\argos-conda\Scripts\argos-translate.exe`
- 模型：Argos Translate `en -> zh`
- 用户环境变量：`FTRANSLATE_ARGOS_CLI=E:\FTranslateTools\argos-conda\Scripts\argos-translate.exe`
- 用户 PATH 已追加：
  - `E:\FTranslateTools\argos-conda`
  - `E:\FTranslateTools\argos-conda\Scripts`

## 验证命令

```powershell
& 'E:\FTranslateTools\argos-conda\Scripts\argos-translate.exe' --from-lang en --to-lang zh 'Safe reinforcement learning for robot navigation'
```

验证输出：

```text
机器人导航安全强化学习
```

## 应用侧配置

`src/main/arxivTranslationService.ts` 会优先读取 `FTRANSLATE_ARGOS_CLI`。如果环境变量不存在，才回退到系统 PATH 中的 `argos-translate`。

这样做的原因是：安装目录放在 E 盘，Electron 安装版未必能立即继承当前 shell 的 PATH，但可以在重启应用后读取用户级环境变量。

## 注意事项

- 如果已经打开了 Electron 应用，需要完全退出并重新打开，才能读取新的用户环境变量。
- 如果移动了 `E:\FTranslateTools\argos-conda`，需要同步更新 `FTRANSLATE_ARGOS_CLI`。
- arXiv 检索页的本地标题/摘要翻译只走 Argos + SQLite 缓存；只有用户显式使用 AI 功能时才调用 API。
