# 04 架构

## 当前运行链

```mermaid
flowchart LR
    A["Obsidian ItemView"] --> B["React + Recharts"]
    B --> C["AssetTrack API Client"]
    C --> D["127.0.0.1 随机端口"]
    D --> E["Bundled FastAPI sidecar"]
    E --> F["SQLite schema 8"]
```

| 层 | 当前职责 |
|---|---|
| Obsidian 插件 | View、Ribbon、设置、文件夹联想、sidecar 生命周期 |
| React | 草稿、表格交互、导航保护和实时图表 |
| Python | API、校验、财务公式、SQLite、备份恢复 |
| SQLite | 唯一持久化事实 |

sidecar 只监听 loopback，使用一次性 bootstrap token 换取 session。插件持续消费
stdout/stderr，传入 Obsidian 父进程 PID，并在卸载时请求 shutdown。

插件加载时只注册 View、设置、Ribbon 和命令，不启动 sidecar。首次 API 请求才
按需启动；全局不显示准备 Notice。编辑面板等待超过约 500ms 时才在面板内部
显示加载状态。Pandas、计算、CSV 和备份模块按功能首次使用延迟加载。

## 数据路径

用户必须在 Vault 内选择 Asset_Track 根目录。插件设置只保存 Vault 相对根目录，
数据库始终解析为：

```text
<Vault>/<workspacePath>/data/accounting_system.db
```

未配置时不创建 View、不启动 sidecar，也不创建数据库。切换根目录前必须处理
dirty 草稿；新位置只允许为空或包含可验证的 schema 8 数据库。

Obsidian 插件自身的 `data.json` 只保存 `workspacePath` 和 CSV 映射配置。映射配置
包含表头指纹、列映射、方向映射和状态过滤，不包含 CSV 行或财务事实。商品汇总、
规则候选和导入模式没有新增 SQLite 表或字段；当前数据库版本仍为 schema 8。

## 写入边界

- 月份、借款、规则和账户保存均携带 revision。
- 前端质检失败不发送写请求，后端再次校验。
- 月份使用单事务整体保存。
- 保存后分析重新读取服务端权威数据。
- 插件不生成 Markdown/SVG，也不自动备份。
- 手动恢复先 staging 校验，再创建当前数据库安全快照并原子替换。
- CSV 检查和映射预览只返回草稿候选，不写数据库；增量模式不去重。

## 下一主要版本

下一主要版本计划删除 Python sidecar，将 API、计算、SQLite 和备份逻辑迁移到
Obsidian 桌面运行时中的 TypeScript。迁移以现有 Python golden tests 和 schema 8
fixture 为行为基线，必须一次只替换一个边界，避免两套公式长期并存。
