# 双平台版本发布流程

拾音 AI 的发布分为“构建验证”“内部草稿”“人工验收”“正式公开”四个状态。构建成功不等同于已经发布，草稿 Release 也不会自动提供给普通用户。

## 当前支持的安装包

| 平台 | 架构 | 安装包 | 辅助文件 |
| --- | --- | --- | --- |
| macOS | Apple Silicon / arm64 | DMG | ZIP、blockmap、SHA-256、冒烟结果 |
| Windows | x64 | NSIS EXE | blockmap、SHA-256、冒烟结果 |

当前仓库已经具备签名材料的安全接入口，但只有在 GitHub 仓库配置真实证书密钥并由构建结果验证后，安装包才算已签名。未配置时仍会产出内部测试用的未签名包，macOS 可能触发 Gatekeeper，Windows 可能触发 SmartScreen。

## 签名材料与就绪检查

个人名义发布仍需向对应证书机构申请真实身份材料，仓库不能代替申请或生成可信证书。不要把证书、密码或 Apple 登录信息写入代码、配置文件、构建日志和 Release。

在 GitHub 仓库的 Actions secrets 中配置：

| 平台 | Secret | 用途 |
| --- | --- | --- |
| macOS | `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD` | Developer ID Application 的 P12/base64 或安全链接及密码 |
| macOS | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | Apple 公证账号、专用密码和团队 ID |
| Windows | `WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD` | Windows 代码签名证书的 PFX/base64 或安全链接及密码 |

本地运行 `npm run release:signing-check`，或分别传入 `--platform=mac` / `--platform=win`，只会显示缺失项，不会打印 secret 内容。CI 也会生成相同的就绪报告。报告通过只代表材料齐备，最终仍必须检查 macOS 签名与公证票据、Windows Authenticode 签名和安装包实际启动结果。

## 日常开发验证

推送影响应用的代码到 `main` 后：

1. `Windows build and smoke test` 在 Windows x64 上运行测试、模型推理、打包、安装、启动、覆盖升级和卸载数据保留检查。
2. `macOS build and smoke test` 在 Apple Silicon runner 上运行测试、模型推理、生成 DMG/ZIP、挂载安装、启动、覆盖安装和移除应用后的数据保留检查。
3. 只有绿色运行中的 artifact 才能交给测试人员。
4. 需要对外分发时，还必须确认对应平台的签名就绪报告和安装包实际签名验证通过。

## 创建内部草稿版本

1. 确认 `package.json` 与 `package-lock.json` 使用同一个新版本号。
2. 在 `public/version-history.json` 和 `CHANGELOG.md` 中增加同版本的简要介绍。
3. 确认变更已经通过本地检查，且确实希望启动双平台构建。
4. 在 GitHub Actions 中手动运行 `Create internal draft release`。
5. `version` 填写与 `package.json` 完全一致的版本，例如 `0.6.5`。
6. `confirm` 必须填写 `CREATE_DRAFT`。
7. 工作流重新构建并验证两个平台，全部成功后创建 `v<版本号>` 的 Draft + Prerelease。

该流程不会自动公开版本。发布前必须人工检查 Release 中的文件、SHA-256、冒烟结果与更新说明。

## 更新说明格式

GitHub Release 正文会直接显示在应用的更新页面中，建议保持简短并使用下面的结构：

```markdown
## 本次更新

- 新增：一句话说明最重要的新功能。
- 优化：一句话说明体验变化。
- 修复：一句话说明关键问题。

会议记录和本机配置会继续保留。
```

发布说明应描述用户能够感知的变化，不写内部提交号、构建过程或尚未完成的规划。

## 正式发布前检查

- [ ] 原作者与项目许可证允许当前分发范围。
- [ ] 使用固定且受保护的 macOS 与 Windows 签名身份。
- [ ] macOS 完成 Developer ID 签名、公证和实体 Mac 安装测试。
- [ ] Windows 完成可信代码签名、SmartScreen/Smart App Control 测试和实体 Windows 安装测试。
- [ ] 两个平台的麦克风、电脑声音、混合录音、快捷键和长会议均人工通过。
- [ ] 从上一正式版本覆盖安装后，历史会议、配置、声纹库和 MiniMax 设置均保留。
- [ ] 更新说明明确列出新增能力、修复、已知限制和回退方式。
- [ ] macOS 对外包已验证 Developer ID 签名与 Apple 公证；Windows 对外包已验证 Authenticode 签名。
- [ ] 用户可以下载上一稳定版本，必要时可以回退应用本体。

## 自动更新的后续阶段

代码签名和授权边界补齐后，再引入 `electron-updater`、版本检查界面、下载进度、重启安装、稳定版/测试版渠道及分批发布。自动更新不得绕过上述双平台测试与人工发布确认。
