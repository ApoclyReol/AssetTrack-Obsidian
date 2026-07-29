# Release v1.0.2

日期：2026-07-29

## 社区发布准备

- 根目录添加 MIT License，版权人为 `ApoclyReol`；package 保持 `private: true`
  并声明 `license: MIT`。
- README 直接提供五步快速开始、CSV/XLSX/XLS 支持、数据与备份位置、兼容要求、
  本地隐私边界和卸载不删除数据的说明。
- SECURITY 区分操作前自动保护快照与用户手动 ZIP，说明本地导入、诊断字段和
  恢复保护。
- 增加 React、React DOM、Recharts 与 SheetJS 直接生产依赖许可证声明。

## 工程门禁

- 增加 ESLint、`eslint-plugin-obsidianmd` 和 `npm run lint`。
- GitHub Actions 执行 `npm ci → typecheck → lint → test → build →
  release:check`。
- 发布校验同步检查 package/manifest/versions、LICENSE、三发布源文件、SheetJS
  CDN tarball integrity，并输出生产 `main.js` 大小。
- bundle 脚本核对三个文件与 ZIP 内唯一 `asset-track/` 顶层目录。

## 交互

- AssetTrack 视图、弹窗、首次配置引导与设置页的可点击按钮统一使用指针光标。
- hover 增强边框、背景、阴影和轻微位移反馈；主按钮和选中按钮保留强调色。
- 禁用按钮使用禁用光标；减少动态效果系统偏好下取消过渡动画。

## 验证边界

- 2026-07-29 本机自动验证通过：typecheck、低噪声 lint、8 个测试文件/28 个
  测试、production build、release check、三文件目录和 ZIP 结构审计。
- 生产 `main.js` 为 1,895,071 bytes，ZIP 为约 528 KiB。SheetJS 当前为静态导入；
  npm 同时提示 Recharts 2.x 已停止活跃维护，两项均保留为真实加载测试后的后续
  依赖评估，不在本版直接改变运行逻辑。
- macOS、Windows、Linux 真实 Obsidian smoke 尚未在本次代码修改中执行，不得
  因单元测试、Node smoke 或 bundle 审计通过而标记完成。
- 正式提交前按 `docs/10-community-release-plan.md` 填写平台、Obsidian/安装器
  版本、系统版本、tag/commit、测试 Vault 和结果，并采集正式版本界面截图与加载
  耗时。
