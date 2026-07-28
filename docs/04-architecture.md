# 04 架构

## 当前运行链

```mermaid
flowchart LR
    A["Obsidian ItemView"] --> B["React + Recharts"]
    B --> C["AssetTrackService"]
    C --> D["TypeScript Repository"]
    D --> E["node:sqlite"]
    E --> F["SQLite schema 9"]
```

| 层 | 当前职责 |
|---|---|
| Obsidian 插件 | View、Ribbon、设置、文件夹选择和生命周期 |
| React | 草稿、表格交互、导航保护和实时图表 |
| Service | UI 稳定接口、账单导入、备份恢复和诊断 |
| Repository | 财务计算、校验、revision、事务和 SQL |
| DatabaseManager | 单例连接、WAL、写入队列、快照和关闭 |
| SQLite | 唯一持久化事实 |

插件加载时只注册 View、设置、Ribbon 和命令，不创建 Service 或打开数据库。用户
显式创建/载入数据库或打开已配置 ItemView 时才探测 `node:sqlite`。插件卸载和
恢复前关闭连接；目录切换的新库验证与设置提交完成后才关闭旧连接，
不启动子进程、不监听端口、不产生 HTTP 会话。

## 数据路径与运行时

数据库固定解析为：

```text
<Vault>/<dataDirectory>/accounting_system.db
<Vault>/<dataDirectory>/backups/
```

未配置时不创建数据库。运行时要求 Node 22.16 以上且提供 `DatabaseSync` 和
`sqlite.backup`；能力不足时只返回升级提示。最低 Obsidian 版本为 1.9.10，同时
建议安装最新桌面安装器。

插件 `data.json` 只保存 `dataDirectory` 和账单映射元数据，不保存财务事实。
schema 9 在流水和自动规则中分别保存 `counterparty`；插件运行时不包含旧 schema
自动迁移逻辑。

## 实例与写入边界

- 插件实例共享 DatabaseManager、Repository、Service、写入队列和数据变更事件。
- 每个 ItemView 独立保存当前页面、月份、排序、筛选、草稿和 dirty 状态。
- 月份、借款、规则、分类和账户保存均携带 revision。
- 月份校验、revision 检查、所有月度表更新和 revision 增加位于同一
  `BEGIN IMMEDIATE` 事务。
- 保存后使用 Repository canonical rows 重建 clean 草稿。
- 账单检查和预览不写数据库；增量模式严格不去重。
- 恢复先校验、staging 和安全快照，再关闭连接并原子替换；失败恢复原数据库。

## 发布边界

正式运行不依赖 Python、FastAPI、Pandas、Uvicorn、PyInstaller、sidecar、原生
扩展或 CPU 架构包。安装目录只包含：

```text
main.js
manifest.json
styles.css
```
