# WebGAL Live2D 动态附件 · Windows 公测

把透明 PNG 做成跟随 Live2D 人物动作的独立附件。在本地制作器选择人物与具体外观、图片和跟随位置，调整后保存，再添加到 WebGAL 游戏，在 Terre 与正式网页中调用。

**适用范围：** Windows x64，指定的 MyGO 3.2.1 / Terre 4.6.4 社区宿主。本项目是附件插件，不提供完整 Terre、Live2D SDK 或人物模型。请自行准备有权使用的宿主、模型和图片，并先在测试游戏中试用。

## 推荐下载：公开公测版

**普通用户目前推荐使用MyGO 3.2.1 / Terre 4.6.4版**：

- [下载INSTALL安装包](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/download/v0.5.0-beta.1-mygo3.2.1/WebGAL-Attachment-0.5.0-beta.1-MyGO3.2.1-Terre4.6.4-Windows-x64-INSTALL.zip) · [对应SOURCE源码包](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/download/v0.5.0-beta.1-mygo3.2.1/WebGAL-Attachment-0.5.0-beta.1-MyGO3.2.1-Terre4.6.4-Windows-x64-SOURCE.zip) · [SHA256SUMS](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/download/v0.5.0-beta.1-mygo3.2.1/SHA256SUMS.txt)
- [主公测发行页](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/tag/v0.5.0-beta.1-mygo3.2.1) · [公测介绍视频](https://www.bilibili.com/video/BV1oQn56xE1T)
- [第一次使用](docs/FIRST_USE.md) · [当前公测完整说明](docs/USER_GUIDE.md) · [已知限制](docs/KNOWN_LIMITATIONS.md)

这是可公开下载的Beta，GitHub仍标为Pre-release。文档会修订，现有命名ZIP与tag保持原发行身份。源码仓库的后续提交不会自动更新你已下载的安装包；普通用户不要把Code→Download ZIP或自动Source code当安装包。

### 按宿主选择其他版本

| 你的宿主 | 下载入口 | 当前公开验证说明 |
| --- | --- | --- |
| MyGO 3.2.1 / Terre 4.6.4 | [推荐公测](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/tag/v0.5.0-beta.1-mygo3.2.1) | Windows x64，具体范围见同版说明 |
| MyGO 3.0.0 | [迁移预览](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/tag/v0.5.0-beta.1-mygo3.0.0-preview.1) | 有限复制宿主技术验证通过，用户视觉待验 |
| MyGO 3.1.1 | [迁移预览](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/tag/v0.5.0-beta.1-mygo3.1.1-preview.4) | 未经真实整合宿主验证 |
| MyGO 3.2.0 | [迁移预览](https://github.com/Mikazuki-kufgr/webgal-attachment/releases/tag/v0.5.0-beta.1-mygo3.2.0-preview.1) | 未经真实整合宿主验证 |

这些是按宿主并列的包，不能互相覆盖或混用。其他版本的迁移源码以各发行页命名的SOURCE.zip为准。

### 开发更新与已发布软件

仓库可以继续维护源码和文档，推荐下载仍以明确发行页及其资产为准。新增开发能力不自动成为现有Beta的承诺；验证并封包后另建版本，不替换用户已经获得的旧包。当前Beta源码可浏览[固定tag](https://github.com/Mikazuki-kufgr/webgal-attachment/tree/v0.5.0-beta.1-mygo3.2.1)；版本分工与后续发布方式见[下载与开发版本](docs/RELEASE_CHANNELS.md)。

## 五步起步

下文H是实际包含WebGAL_Terre.exe的目录，常见为整合包的release目录；不要再额外拼一层release。

1. 完整解压 INSTALL，关闭 Terre、制作器和预览；从包根目录双击 `01_安装或升级.cmd`，选择包含 `WebGAL_Terre.exe` 的宿主目录。
2. 到安装后宿主的 `H/WebGAL-Attachment-Manager/` 运行 `03_验证安装.cmd`，再运行 `02_打开附件制作器.cmd`。制作期间保留 CMD 日志窗口。
3. 在制作器中选择具体人物和外观、自己的透明 PNG、跟随部位与层位；预览动作后保存附件，再重新打开核对。
4. 选择测试游戏，按提示复制所需人物并“添加 / 更新到这个游戏”；在 Terre 播放生成的独立测试剧情。
5. 在正式剧情中调用并检查；导出网页后使用 Windows 本地入口或 HTTP(S) 运行完整导出目录。

首次公测不承诺任意第三方模型自动适配、全部人物/服装默认锚点或直接双击导出的 `index.html` 可用。已验证的手部验收场景在独立网页播放、两种状态的存读档和 Terre 图形界面导出得到用户正常反馈；该网页仍有可感知卡顿，但用户确认可以操作和判断效果。此反馈只覆盖所述场景，不能扩展为所有模型与游戏的视觉验收。

## 源码与许可

主要代码位于 `target-webgal-mygo/`、`target-webgal-mygo-terre/`、`target-plugin/` 和 `20_installable-candidate/source/`。各目录身份和构建条件见[源码说明](docs/SOURCE_BUILD.md)；`assemble.mjs` 需要另行取得合法的宿主基线及构建输出，本仓库本身不能直接生成完整 Terre。全新机器的逐字节重建尚未验证。

发布者有权授权的新增独立代码按 MPL-2.0，明确列出的内置示例图片按 CC0-1.0；上游与第三方内容保留各自许可。具体范围见 [LICENSE_SCOPE.json](LICENSE_SCOPE.json)、[NOTICE.md](NOTICE.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。仓库不授予人物模型、SDK 或宿主的再分发权。

欢迎提交 [Issue](https://github.com/Mikazuki-kufgr/webgal-attachment/issues) 或参照 [贡献说明](CONTRIBUTING.md)参与维护。反馈请提供修订、宿主版本、复现步骤、预期/实际和脱敏日志；不要上传私有模型、账号或私人路径。

## 社区参考资料

[BanG Dream原模型特殊部件索引与底模候选检索表](docs/reference/bangdream-model-parts/README.md)：按帽子、兽耳、耳机、头巾、口罩等查找人物和具体外观，附自包含离线检索页。它是独立资料附录，与插件版本分别维护；可见造型不等于部件可拆用或目标移植效果已验证。

[爱音冬服全动作手型调用参考](docs/reference/anon-winter-hand-motions/README.md)：664个动作入口、两侧14个实际手部参数，附采样时序、CSV/JSON与单文件离线检索网页。只列文件调用数据，具体手型外观与附件效果仍需模型验证。


[12套特殊服装静态图鉴](docs/reference/bangdream-model-parts/special-costumes/README.md)：4列×3行，立绘配角色、服装编号与名称信息条；附原尺寸PNG、可断网双击的离线图鉴网页ZIP及完整清单。


全库3737幅派生预览现已更新为对应原生idle表情，修正旧检查图的叠嘴；[一键下载单文件HTML图册](https://htmlpreview.github.io/?https://raw.githubusercontent.com/Mikazuki-kufgr/webgal-attachment/main/docs/reference/bangdream-model-parts/download.html)，下载后直接双击、可断网搜索，无需解压。下载启动页通过HTMLPreview展示，文件直接读取GitHub；不携带模型/原贴图/动作/SDK，与冻结公测版本分别维护。

