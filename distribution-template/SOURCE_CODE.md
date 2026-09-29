# Hotfix44 对应源码与独立构建

配套文件：WebGAL-Attachment-0.5.0-beta.1-5L-HOTFIX44-SOURCE.zip。它与技术安装包配对交付；哈希见外部 DELIVERY.json，避免文件自引用。公开发布时必须同时提供这份实际源码附件；当前没有虚构下载地址。

源码包包含 Engine、Creator、Preview、Terre 编辑器/后端、插件与生命周期脚本、构建所需字体/图片等静态资源、锁文件、打包模板、构建脚本及相关许可证。third-party-source 包含实际 npm parser 源码和 pkg-fetch 源码/补丁。不会把压缩 JavaScript 或此前缺资源的私有快照称作完整对应源码。

上游 Engine：https://github.com/boomwwww/webgal-mygo ，提交 f6a39766054df179385b955cc0cc9598fce71e44；Terre：https://github.com/boomwwww/webgal-mygo-terre ，提交 afb6c740de330b619ce560ca739a1a0587482636。本包包含这些基线之后的本地修改；上游链接不是修改版下载链接。

Windows x64 构建步骤见源码包 BUILD.md。产品编译使用 Node 24.19.0、Yarn 1.22.22 和两个 yarn.lock；依赖需要从 npm 获取。后端 pkg 目标为 node22-win-x64，基座校验见 THIRD_PARTY_NOTICES.md。

安装包是针对精确宿主的增量插件。装配时需用户自行提供合法的 hostfix1-local 兼容宿主基线，其文件清单与哈希在 distribution-template/manifests/host-adapter.json。此依赖不是旧插件 staging、历史 node_modules 或历史编译产物；新源码目录已独立安装依赖并完成五份编译。SDK 和人物模型不作为对应源码一并再分发。

发布者已确认其有权授权的新增独立辅助代码采用MPL-2.0；既有第三方代码仍按原许可。公开发行时与安装包一起提供准确对应源码和获取说明。

字体补充：OFL字体通知已收集到licenses/fonts；OPPOSans不随两个归档提供，构建通过prepare-host-assets从精确用户宿主恢复，详见该目录说明。
