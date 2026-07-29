# Release v1.1.0

日期：2026-07-30

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

- README 完善为 English-first 的完整英文说明，并补齐对等中文安装、使用、语言、
  数据、隐私与开发章节。
- 新增语言判定测试和英文账单导入界面测试。
- typecheck、53 项测试、lint、生产构建、release:check 和 `git diff --check`
  已通过。
- macOS 与 Windows 已完成 v1.1.0 主要功能及中英文界面 smoke；Linux 仍未测试。
- Obsidian 与操作系统的具体版本信息尚未提供，正式提交 Community Plugins 前
  需补录到脱敏测试记录。

## 发布边界

- 最低 Obsidian 版本仍为 1.9.10。
- Release tag 必须为与 manifest 完全一致的 `1.1.0`，不能使用 `v1.1.0`。
- Release 只包含 `main.js`、`manifest.json` 和 `styles.css`，三文件继续生成
  GitHub artifact attestations。
