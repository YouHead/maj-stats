# 参与开发

请先阅读 README 中的运行步骤与统计口径。建议使用 Node.js 24、npm 和 Windows 10/11；Windows 打包还需要 PowerShell 7。

```powershell
npm ci
npm run electron:install
npm run protocol:refresh
npm test
npm start
```

提交修改时请说明触发条件、预期行为和验证方式。统计逻辑的修改应提供合成牌谱测试；界面微调可附使用合成数据的截图。

请勿提交个人牌谱、选手名单、比赛表格、导出文件或登录缓存。测试请使用虚构昵称、账号 ID 与牌谱 UUID；不要从真实牌谱直接复制标识。首次协议下载及 Electron 安装需要联网，自动测试本身不需要登录。

Windows 发行前运行 `npm run dist:win` 和 `npm run test:package`。后者在独立临时数据目录中隐藏运行生成的 exe，不会使用日常登录配置。

提交贡献即表示你有权将相应代码按本项目的 MIT 许可证提供。
