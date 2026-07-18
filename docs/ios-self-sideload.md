# FTranslate iPhone 实验版与个人自签

> 这是独立的实验性移动阅读路径，不等同于 Windows 桌面版完整科研工作台，也不是 App Store 发布说明。

## 当前移动闭环

Capacitor iOS 版本聚焦一条可完成的移动阅读流程：

1. 从 iOS“文件”导入 PDF，或通过 arXiv 检索下载；
2. PDF 与论文元数据写入 App 本地沙盒；
3. 在论文库恢复最近阅读位置；
4. 使用 PDF.js 阅读原始 PDF；
5. 在“段落双语”模式中把中文译文放在对应英文段落下方；
6. 长按或选择词语、短语时显示翻译浮层；
7. 可导入已有纯中文 PDF 并绑定到原论文。

当前不包含账号、云同步、桌面/手机数据互通、Android、Windows `pdf2zh` Python sidecar，也不承诺与桌面端功能等价。手机段落翻译使用用户配置的 OpenAI-compatible 接口；Base URL 与模型名保存在本机，API Key 只保存在当前运行内存。

## 移动 Web 开发与验证

在 Windows 或 macOS 上运行移动 Web 预览：

```bash
npm install
npm run dev:mobile
```

构建移动资源并运行 iPhone 尺寸视觉检查：

```bash
npm run build:mobile
npm run visual:check:mobile
```

截图和溢出审计输出到 `.tmp-mobile-visual-check/`。

iOS 原生工程位于 `ios/App/App.xcodeproj`。修改移动端源码后同步：

```bash
npm run ios:sync
```

`ios:add` 只用于尚未存在 `ios/` 工程的首次初始化，当前仓库不需要再次执行。Capacitor 8 要求 iOS 15+；最终模拟器、真机和签名验证需要 macOS、Xcode 与 Apple Developer 账号。

## 付费开发者账号：Ad Hoc 安装

Ad Hoc `.ipa` 不会公开上架 App Store。目标 iPhone 的 UDID 必须登记到 Apple Developer 账号并包含在 Provisioning Profile 中；安装后设备需要启用开发者模式。

在 macOS 上配置 Xcode 登录与证书后执行：

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID bash scripts/build-ios-adhoc.sh
```

如需同时生成 HTTPS 安装页：

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
PUBLIC_BASE_URL=https://download.example.com/ftranslate \
bash scripts/build-ios-adhoc.sh
```

`.ipa` 输出到 `ios/App/output/adhoc/`，HTTPS 下载页模板位于 `distribution/ios/public/`。也可使用 Xcode 或 Apple Configurator 通过 USB 安装。Windows 无法完成 Apple 签名或产出可直接安装到真机的最终 `.ipa`。

## 免费个人自用：GitHub Actions + Sideloadly

仅安装到自己的 iPhone 时，可以使用免费 Apple ID 自签。仓库提供手动工作流 `.github/workflows/ios-unsigned.yml`：

1. 打开 GitHub 仓库的 Actions 页面；
2. 选择 `Build unsigned iOS IPA`；
3. 点击 `Run workflow`，选择包含 iOS 工程的分支；
4. 构建完成后下载 `FTranslate-unsigned-ios` artifact；
5. 解压后把 `FTranslate-unsigned.ipa` 拖入 Windows 版 Sideloadly；
6. 使用个人 Apple ID 签名并安装；首次必须通过 USB 完成电脑与 iPhone 配对；
7. 在 iPhone 上启用 Developer Mode，并信任对应开发者描述文件。

免费 Apple ID 签名通常需要每 7 天续签。首次 USB 配对完成后，Sideloadly 可在电脑与 iPhone 位于同一网络时尝试自动刷新。续签必须保持相同 Apple ID 和 Bundle ID，并采用覆盖安装；先删除 App 会同时删除 App 沙盒中的论文库和译文缓存。

未签名 IPA 不能直接点开安装、上传 App Store 或公开分发。工作流同时输出 `FTranslate-unsigned.ipa.sha256` 供完整性核对。

本地有 macOS/Xcode 时，也可执行：

```bash
npm ci
bash scripts/build-ios-unsigned.sh
```

输出位于 `ios/App/output/unsigned/`。

## 已知限制

- 免费 Apple ID 需要周期性续签；
- 移动端数据位于 iOS App 沙盒，删除 App 会删除本地数据；
- 桌面端本地模型、科研绘图、完整中文 PDF sidecar 和全部研究工作台能力不会自动迁移到手机；
- 公开分发、企业签名、TestFlight 和 App Store 上架不属于当前交付范围。
