# Release v1.0.5

日期：2026-07-30

本次为 Community Plugins 审核兼容补丁，不改变 schema 9、数据库路径、备份格式、
财务公式或核心编辑流程。

## 社区审核修复

- manifest 使用英文目录描述，移除冗余产品名并补齐结尾标点。
- README 改为英文优先，明确手动安装、首次配置、数据、备份、权限和隐私边界，
  同时保留中文快速说明。
- 移除没有界面入口的残留程序化剪贴板写入代码。
- React 和 React DOM 固定为 18.3.1，消除 React 19 生产运行时带入的六处动态
  `script` 元素创建。

## 发布供应链

- 新增 tag 驱动的 GitHub Release workflow。
- Release 只包含 `main.js`、`manifest.json` 和 `styles.css`，不再上传插件 ZIP。
- GitHub Actions 为标准三文件生成 artifact attestations。
- `release:check` 增加 manifest 描述、英文 README、动态脚本、Vault 全库枚举和
  程序化剪贴板访问门禁。

## 兼容边界

- 最低应用版本仍为 1.9.10，schema 仍为 9。
- `node:fs` 继续只服务于用户选择的 Vault 内数据目录、SQLite、保护快照和手动
  备份恢复；插件不枚举 Vault 全部文件。
- v1.0.4 的 macOS 与 Windows smoke 结论是历史基线；v1.0.5 发布前需对正式三文件
  产物执行针对性回归。
