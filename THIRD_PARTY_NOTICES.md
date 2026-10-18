# 第三方组件

本项目自身的代码按 [MIT](LICENSE) 许可发布。第三方组件保留各自的版权及许可条款；项目的 MIT 许可不替代这些条款。

| 组件 | 用途 | 许可证 | 上游 |
| --- | --- | --- | --- |
| Electron | 桌面运行时 | MIT；包含 Chromium、Node.js 及其他组件的独立许可 | https://github.com/electron/electron |
| ExcelJS | Excel 导出 | MIT | https://github.com/exceljs/exceljs |
| protobuf.js | 牌谱协议编解码 | BSD-3-Clause | https://github.com/protobufjs/protobuf.js |
| electron-builder | Windows 构建工具 | MIT | https://github.com/electron-userland/electron-builder |

依赖及其传递依赖的准确版本见 `package-lock.json`，许可原文随 npm 包分发。构建产物保留运行时依赖中的许可文件，以及 Electron 的 `LICENSE`、`LICENSES.chromium.html` 等声明。源代码包不包含依赖副本，安装依赖时会取得这些文件。

雀魂名称、官方客户端及官方协议资源属于各自权利人。本仓库不包含官方客户端、账号信息或真实牌谱；构建时从雀魂官方公开资源下载协议定义，发行包只带用于编解码的公开协议 JSON。这些资源不按本项目的 MIT 许可证重新授权。

项目入口与部分统计指标参考 [amae-koromo](https://github.com/SAPikachu/amae-koromo) 和 [amae-koromo-scripts](https://github.com/SAPikachu/amae-koromo-scripts)。本项目独立实现会话接入、导入、统计及界面，没有包含这两个项目的源代码。它不是雀魂官方产品。
