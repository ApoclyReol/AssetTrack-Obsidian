# 故障排查

## 编辑器要求先初始化

这是预期门禁。进入“设置 → Asset Track”，在根目录输入框中选择 Vault 文件夹
或推荐的新 `Asset_Track`，然后点击“使用并初始化”。

数据库路径固定为：

```text
<根目录>/data/accounting_system.db
```

## sidecar 启动超时

1. 确认安装的是完整插件目录，存在 `sidecar/AssetTrackSidecar` 和 `_internal/`。
2. 确认插件包 CPU 架构与 Obsidian 一致。
3. 在设置中点击“重启 sidecar”。
4. 复制诊断信息；诊断不包含金额、商品或借款对方。

不要单独运行 sidecar。它需要插件提供数据库路径、bootstrap token 和父进程 PID。

## File already exists

当前版本不会生成 Markdown。若初始化目录已有不兼容数据库，插件会拒绝打开；
请不要覆盖它。先手动备份，再选择空目录或恢复经过验证的 schema 8 备份。

## revision 冲突

数据库已被另一编辑会话修改。保留当前草稿内容作参考，重新加载最新 canonical
rows 后再编辑，不要绕过 revision。

## 备份恢复失败

- 使用设置页先“校验路径”，再“确认恢复”。
- 支持格式 2 目录、ZIP 或 schema 8 SQLite。
- 校验失败不会替换当前数据库。
- 恢复成功前保留候选文件和当前数据库手动备份。
