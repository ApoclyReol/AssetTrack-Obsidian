# Third-Party Notices

AssetTrack 的生产 `main.js` 会打包以下直接依赖。此清单用于发布审查，不替代各项目
随发行版本提供的完整许可证文本。

| 依赖 | 当前声明范围 | 许可证 | 项目 |
| --- | --- | --- | --- |
| React / React DOM | 19.2.8 | MIT | https://react.dev/ |
| Recharts | 2.15.4 | MIT | https://recharts.org/ |
| SheetJS Community Edition (`xlsx`) | 0.20.3 | Apache-2.0 | https://sheetjs.com/ |

SheetJS 使用固定 CDN tarball，`package-lock.json` 同时锁定下载地址、版本和
integrity。每次依赖更新都应重新核对许可证、lockfile 与生产 bundle 大小。

当前 SheetJS 由账单解析模块静态导入，因此随 React、Recharts 一起进入初始
`main.js`，尚未延迟加载。v1.0.3 生产文件为 1,895,071 bytes；是否拆分 SheetJS
必须结合三平台真实插件加载耗时和 Obsidian 的单文件发布约束评估。

安装依赖时 npm 已提示 Recharts 2.x 分支不再活跃。升级到 Recharts 3 属于需要
图表回归验证的后续工作，不在 v1.0.3 交互更新中直接跨主版本升级。

Obsidian、Electron 和开发/测试工具未打入插件的三个发布文件，分别遵循其自身许可。
