# 第三方组件及对应来源
Hotfix44 `0.5.0-beta.1` 技术包；本文件只更新当前发行身份，第三方许可原文和历史说明保持不变。

本次从独立源码目录以锁定依赖重新构建 Engine、Creator、Preview、Terre 编辑器和后端。ACTUAL_DEPENDENCIES.json 记录 Vite 实际保留模块及 webpack 编译模块的组件归属；后者保守包含可选分支，不等同精确逐字节 SBOM。共 550 个安装位置，文件归属未解析项为 0。

原始通知在 licenses/actual-modules；缺根通知者补充到 licenses/supplemental，SOURCES.json 区分固定上游原文与包内许可声明加标准条款。material-icon-theme 的许可证在 LICENSE.md，不能把 package.json 缺字段误判为无许可。旧 DEPENDENCIES.json 是历史保守清单，不代表本次实际分发。

cloudlogjs 未出现在四份前端实际保留模块中。此前疑似 jschardet 的编辑器模块实际是 vscode/override/jschardet.js（固定 UTF-8 返回值的 MIT 项目替身），不是 LGPL jschardet 包。本次实际归属清单中不含该 LGPL 库，不能根据文件名误报分发。

Node 24.19.0 是单独携带的官方 Windows x64 可执行文件；Node 22.14.0 是 Terre EXE 内的 pkg-fetch 补丁运行时，两者不能混称。官方完整许可在 licenses/Node-v*-LICENSE.txt。后端由 @yao-pkg/pkg 6.4.1 生成；pkg-fetch 3.5.21 源码、node.v22.14.0.cpp.patch 和 expected-shas.json 在对应源码包 third-party-source/pkg-fetch-3.5.21。

构建使用的已缓存 patched base 通过新安装 pkg-fetch 的官方期望 SHA-256 44B59E0E44E358ECFD6F3696FFACF67D0491C6037EB2CC5343813F70884523D7 验证；下载停滞后复用这个基座，不是复用旧 Terre EXE。Node 24 EXE SHA-256 为 3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237。

WebGAL/MyGO/Terre 及实际 npm webgal-parser 4.6.2 的可编辑源代码、锁文件、构建资源和步骤一并交付。MPL 文本保持原样。静态字体、图标及包内样例来源分别保留原项目说明和 SAMPLE_PROVENANCE.json。Live2D SDK、MOC、纹理/动作模型库和用户测试游戏不随插件或对应源码包分发；兼容宿主和有权使用的模型仍由用户提供。

参考：[Node 24 许可](https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE)、[Node 22 许可](https://raw.githubusercontent.com/nodejs/node/v22.14.0/LICENSE)、[MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。

字体补充：OFL字体通知已收集到licenses/fonts；OPPOSans不随两个归档提供，构建通过prepare-host-assets从精确用户宿主恢复，详见该目录说明。
