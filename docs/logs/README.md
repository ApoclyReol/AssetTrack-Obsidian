# 更新日志索引

本目录按版本保存已经完成的更新记录。日志用于 handoff 和追溯，不替代
`docs/00-reading-guide.md` 所列的当前长期文档。

- [Release v1.0.0](release-v1.0.0.md)：纯 TypeScript/schema 9 首个正式版，
  包含账单导入、交易对方规则、月度分析、备份恢复和标准三文件产物。
- [Release v1.0.1](release-v1.0.1.md)：数据库显式创建/载入、状态机、安全目录
  切换，以及数据库直接位于用户选择的数据目录。
- [Release v1.0.2](release-v1.0.2.md)：社区发布合规、LICENSE、安全披露、
  lint/CI、发布校验和按钮 hover 反馈。
- [Release v1.0.3](release-v1.0.3.md)：加强按钮 hover、手型指针、按下反馈与
  键盘焦点可见性。

后续每次正式更新新增 `release-vN.N.N.md`，至少记录：

- 用户可见功能和行为变化；
- schema、备份格式和设置数据是否变化；
- 安装包与兼容性边界；
- 测试、构建和冒烟结果；
- 下一位维护者需要继续核对的事项。
