# Third-Party Notices

Asset Track v1.2.0 的生产 `main.js` 会打包以下直接依赖。版本和许可证
来自 `package-lock.json`，文件大小来自当前生产构建；此清单由
`npm run notices:update` 生成，并由 `npm run release:check` 验证。

| 依赖 | 锁定版本 | 许可证 | 项目 |
| --- | --- | --- | --- |
| React / React DOM | 18.3.1 | MIT | https://react.dev/ |
| Recharts | 2.15.4 | MIT | https://recharts.org/ |
| SheetJS Community Edition (`xlsx`) | 0.20.3 | Apache-2.0 | https://sheetjs.com/ |

SheetJS 使用固定 CDN tarball，`package-lock.json` 同时锁定下载地址、版本和
integrity。当前 SheetJS 由账单解析模块静态导入，因此随 React、Recharts 一起进入
初始 `main.js`，尚未延迟加载。

当前 v1.2.0 生产 `build/obsidian/asset-track/main.js` 为 1820715 bytes。

Obsidian、Electron 和开发/测试工具未打入插件的三个发布文件，分别遵循其自身许可。
