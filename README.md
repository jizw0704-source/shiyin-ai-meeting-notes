# 拾音 AI｜本地会议听记

Windows 本地会议听记原型：百炼 `paraformer-realtime-v2` 做实时转写，本地 CAM++ 声纹模型区分 2–6 位发言人；录音约 30 秒后由 MiniMax M3 生成首份实时草稿，此后随会议内容滚动更新，结束后自动校正发言人并流式生成正式报告。原始录音保存在本机，可在会议记录中回听并按时间定位。

## 已实现

- 麦克风实时转写，显示每段发言的起止时间。
- 会议中实时生成 AI 草稿，默认 30 秒启动、每 20 秒检查新内容。
- 正式报告使用 MiniMax SSE 流式响应，仅在连续一段时间没有返回数据时超时；定稿失败仍保留实时草稿。
- 超过 1 秒的语音间隔显示为停顿。
- 本地 CAM++ 声纹嵌入与增量聚类，发言人自动编号。
- 点击发言人姓名手动重命名；会后重新聚类时尽量保留人工姓名。
- 录音保存为 `data/meetings/<会议ID>/audio.wav`，记录保存在本地 SQLite。
- 结束会议后，本地后台先校正发言人，再调用 MiniMax 生成总结。
- Electron 托盘常驻；关闭窗口只是隐藏，录音和后台任务会继续运行。
- 可选择“登录 Windows 后自动启动”。

## 运行

1. 复制 `.env.example` 为 `.env.local`，填写百炼和 MiniMax API Key。
2. 安装依赖：`npm install`
3. 桌面开发模式：`npm run desktop:dev`
4. 生产构建后运行：`npm run build`，再执行 `npm run desktop:start`

仅运行网页可使用 `npm run dev`，访问 `http://127.0.0.1:3000`。

## Windows 安装版

1. 从 GitHub Releases 下载 `拾音 AI Setup 0.1.0.exe` 并完成安装。
2. 安装包不包含任何 API Key。首次使用前，在 `%APPDATA%\拾音 AI\.env` 创建本机配置：

   ```env
   DASHSCOPE_API_KEY=你的百炼APIKey
   MINIMAX_API_KEY=你的MiniMaxAPIKey
   MINIMAX_MODEL=MiniMax-M3
   ```

3. 完全退出托盘中的“拾音 AI”后重新打开。

安装版的录音、逐字稿、总结和声纹数据默认保存在 `%APPDATA%\拾音 AI\data`。当前公开安装包未进行商业代码签名，Windows SmartScreen 可能显示“未知发布者”；请只从本仓库的 Releases 页面下载并核对 SHA-256。

## 数据与隐私

API Key 只由本地 Node 后台读取，不会发给浏览器。原始录音、声纹向量、逐字稿和总结保存在本机 `data` 目录；语音流会发送给百炼完成识别，校正后的文本会发送给 MiniMax 完成总结。

## 当前边界

说话人识别按完整 ASR 句段分配，不能可靠拆分两人同时说话的重叠语音。短于约 1.2 秒的片段会继承相邻发言人；安静环境、让每人至少连续说几句话，会明显提高区分效果。
