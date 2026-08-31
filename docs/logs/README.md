# 更新日志索引

本目录按版本保存已经完成的更新记录。日志用于 handoff 和追溯，不替代
`docs/00-reading-guide.md` 所列的当前长期文档。

- [Release v1.8.1](release-v1.8.1.md)：补丁级修复多种账单日期格式导致的有效流水过滤，并增强规则列表的直接筛选、分组和排序。
- [Release v1.8.0](release-v1.8.0.md)：合并原 1.7.1 严重修复，升级 schema 11，
  支持代付规则，优化导入、规则应用、批量编辑、商品总览和年度周期消费体验。
- [Release v1.7.0](release-v1.7.0.md)：升级 schema 10，加入通用规则、三类流水 Tab、
  理财流水账户、按账户月度分析、汇总选择、批量预览与审计、收入/代付转换和可选 AI 分类建议。

- [Release v1.0.0](release-v1.0.0.md)：纯 TypeScript/schema 9 首个正式版，
  包含账单导入、交易对方规则、月度分析、备份恢复和标准三文件产物。
- [Release v1.0.1](release-v1.0.1.md)：数据库显式创建/载入、状态机、安全目录
  切换，以及数据库直接位于用户选择的数据目录。
- [Release v1.0.2](release-v1.0.2.md)：社区发布合规、LICENSE、安全披露、
  lint/CI、发布校验和按钮 hover 反馈。
- [Release v1.0.3](release-v1.0.3.md)：加强按钮 hover、手型指针、按下反馈与
  键盘焦点可见性。
- [Release v1.0.4](release-v1.0.4.md)：修复数据边界校验、导入失败原子性、
  弹窗可访问性、主题响应式和大流水表性能问题。
- [Release v1.0.5](release-v1.0.5.md)：修复 Community Plugins manifest、README、
  动态脚本扫描、剪贴板提示和 Release 资产来源证明。
- [Release v1.1.0](release-v1.1.0.md)：新增跟随 Obsidian 语言的完整中英文界面，
  保持 schema 9、用户内容和数据库业务值不变。
- [Release v1.2.0](release-v1.2.0.md)：新增金额与阈值设置、资金投入资产与市场
  净资产双口径，以及只读周期消费面板。
- [Release v1.3.0](release-v1.3.0.md)：新增导入容错与警告保存、规则工作台、商品
  回溯/统一、规则冲突解释和统一表格布局；保持 schema 9。
- [Release v1.4.0](release-v1.4.0.md)：适配 Obsidian 1.13 声明式设置，移除 Vault
  全库枚举，最低版本提升至 1.13.0；保持 schema 9。
- [Release v1.4.1](release-v1.4.1.md)：优化规则匹配、分析查询和生产 bundle 性能，
  拆分 UI 与 Repository 维护边界；保持 schema 9、数据和备份格式兼容。
- [Release v1.5.0](release-v1.5.0.md)：将借款整合到月流水事实和实时对账差额，
  简化特殊流水分类展示，优化商品汇总列宽和排序；保持 schema 9。
- [Release v1.6.0](release-v1.6.0.md)：重整分析、记录和配置导航，拆分记录区块事务，
  直接展示商品-分类冲突，统一规则匹配和表格编辑体验。

后续每次正式更新新增 `release-vN.N.N.md`，至少记录：

- 用户可见功能和行为变化；
- schema、备份格式和设置数据是否变化；
- 安装包与兼容性边界；
- 测试、构建和冒烟结果；
- 下一位维护者需要继续核对的事项。
