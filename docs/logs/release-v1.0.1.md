# Release v1.0.1

日期：2026-07-28

## 数据库生命周期

- 插件启用时只加载设置并注册界面，不创建 Service 或打开数据库。
- 设置项改为“Asset-track 数据目录”，数据库直接保存为
  `<数据目录>/accounting_system.db`，不再额外套用 `data/`。
- 输入目录只执行只读校验；空目录必须显式创建，已有数据库必须校验后显式载入。
- ItemView 未就绪时显示配置引导，不访问 Repository。
- 生命周期状态统一为 `unconfigured / initializing / ready / error`。
- 不兼容、扫描或迁移旧 `workspacePath` 设置；运行逻辑只认 `dataDirectory`。

## 切换与保护

- 已就绪数据库切换目录时明确选择“迁移当前库”或“载入目标库”。
- 切换先校验目标并在当前 `<数据目录>/backups/` 创建保护快照；新库验证和设置
  保存成功后才切换 Service 并关闭旧连接。
- 恢复前快照统一写入 `<数据目录>/backups/before-restore-*`。
- 设置页把备份恢复、目录选择和“打开数据目录”合并到同一个数据库存储区域，
  移除数据库重开、复制诊断以及重复的路径说明。
