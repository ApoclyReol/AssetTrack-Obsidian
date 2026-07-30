# Release v1.1.0

日期：2026-07-30

状态：当前已发布版本。Asset Track 已在 Community Plugins 上线，社区目录是推荐
安装与更新方式；后续仓库改动属于常规维护，除非另有 release 日志，不代表新的
版本发布。

本次为国际化次版本更新。插件新增完整中英文界面，不改变 schema 9、数据库路径、
备份格式、财务公式或用户数据。

## 自动语言适配

- 使用 Obsidian `getLanguage()` 读取当前应用语言。
- `zh`、`zh-CN`、`zh-TW` 及其他 `zh-*` 环境显示中文，其他语言回退英文。
- 设置、编辑器、分析、账单导入、确认弹窗、Notice、系统文件选择器及无障碍文本
  均接入统一语言层。
- 金额格式、文本排序和内置业务标签跟随当前界面语言。

## 数据兼容边界

- schema 仍为 9，不执行数据库迁移。
- 内置中文业务枚举只在展示层映射为英文，提交和持久化仍使用既有规范值。
- 用户创建的账户、分类、交易对方、商品和流水说明始终按原文显示。
- 已有 v1.0.x 数据目录、数据库和备份格式保持兼容。

## 文档与测试

- README 完善为 English-first 的完整英文说明，新增独立 `README.zh-CN.md`
  中文版本，并在两份文档顶部提供语言切换入口。
- 新增语言判定测试和英文账单导入界面测试。
- typecheck、53 项测试、lint、生产构建、release:check 和 `git diff --check`
  已通过。
- macOS 与 Windows 已完成 v1.1.0 主要功能及中英文界面 smoke；Linux 验证作为
  发布后质量任务继续补充。
- Asset Track 已通过 Community Plugins 审核，可直接从社区目录安装；手动安装
  三文件仅作为备用方式。

## 发布边界

- 最低 Obsidian 版本仍为 1.9.10。
- `release:check` 从 lockfile 和当前生产构建验证第三方依赖版本、许可证、插件
  版本及 `main.js` 实际大小，避免声明依赖人工同步。
- Release tag 必须为与 manifest 完全一致的 `1.1.0`，不能使用 `v1.1.0`。
- Release 只包含 `main.js`、`manifest.json` 和 `styles.css`，三文件继续生成
  GitHub artifact attestations。
