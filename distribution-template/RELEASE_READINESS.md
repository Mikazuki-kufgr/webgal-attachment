# 发行验收范围

## 当前 Hotfix44 状态

发行身份：`WebGAL Attachment 0.5.0-beta.1` / `MPB1-5L-HOTFIX.44` / Windows x64 / MyGO 3.2.0 / WebGAL Terre 4.6.2 / `hostfix1-local` 精确宿主基线。

当前状态：`HOTFIX44_RELEASE_METADATA_ALIGNED`；下一步：`READY_FOR_FINAL_USER_SMOKE`。S43-01、S43-02、S43-03 已完成并接受；K44-01 是 P2 Known Issue，不阻断 Beta，也不在本轮继续代码修复。TECHNICAL 与 SOURCE 已完成当前 Hotfix44 的 ChatGPT 静态/封包核对，功能载荷未因本轮文档收尾改变。

在真人最终 smoke 前，`publicBetaCandidateReady=false`、`realHostInstalled=false`、`guiValidated=false`。下一步只剩最终安装/GUI smoke，之后进入 `0.5.0-beta.1` 公测门禁；本地封包不等于已公开发布。

## 历史 Hotfix37 发行资料（保留）

Hotfix37 是基于 Hotfix36 已完成用户验收的文档、许可与修订号更新。安装包与对应源码配对提供，文件清单在安装包的 manifests/release-files.json 和源码包的 SOURCE_MANIFEST.json 中；归档哈希放在配套 SHA256SUMS.txt 中。

代表性普通操作已完成：人物导入与已有锚点复用、附件制作、多人参数保存恢复、另存为、完整文件夹导出及重复冲突、添加到游戏、中文验证剧情、换层保存、安装验证与停止服务。Terre 的保存失败提示、草稿保留、解除只读后的重试，以及 Web 导出失败保护、重试和独立 HTTP 运行也有用户反馈。

独立 Web 人工检查包含 Codex 内置浏览器中的语言选择、进入与测试对白显示；不宣称覆盖全部浏览器。语义锚点目录共有11人97套配置，全部配置的技术审计不能代替每套外观的人工视觉接受。

Hotfix37 的编译、冷解压和升级证据由发行时配套 DELIVERY.json 提供。本包未承诺确定性二进制重建；对应源码的锁依赖、工具版本和独立构建过程见 SOURCE_CODE.md 与源码包 BUILD.md。

仍需由发布者完成的发布操作：设立真实的下载与反馈入口、同时提供安装包和对应源码、校验上传后的文件，并明确宣布公测范围。文件已经打包不代表已经公开发布。不要为此要求用户重跑已经通过且本版没有改变的整套功能测试。

自动载入立绘及未保存提醒、快进过渡、日志窗口关闭体验、保存失败提示的收起样式均在本轮延期，见 KNOWN_LIMITATIONS.md；它们没有被悄悄标记为修复。
