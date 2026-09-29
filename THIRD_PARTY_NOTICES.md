# 第三方组件与来源

WebGAL Attachment 0.5.0-beta.1 / MYGO321-AUTO-FIGURE-SWITCH.7。既有组件各自许可证不变，本轮未给第三方内容重新授权。演示素材不含人物模型。

ACTUAL_DEPENDENCIES.json 根据五类构建中有哈希的第三方模块重新建立组件、版本、输出和通知文件映射；webpack 编译输入保守包含可选分支，不等同逐字节 SBOM。内嵌 wasm 包按所属 npm 包归属，不能仅因内嵌 package.json 缺 license 就推断无许可。

原通知保留于 licenses/actual-modules、licenses/supplemental 等目录；新增版本通知列入同一清单。未进入本次构建的旧通知可作为保守保留，不代表额外组件实际分发。Node 两种运行时的原许可证分别在 licenses/Node-v*-LICENSE.txt：工具 Node 24.19.0，Terre EXE 的 patched Node 22.14.0。

配套源码中的 third-party-source/pkg-fetch-3.5.21 包含生成基座所用工具源码/补丁；应用源码、patched Parser 和锁文件同时提供。MPL 与 CC0 范围见 NOTICE.md、LICENSE_SCOPE.json、SAMPLE_PROVENANCE.json。许可证原文没有改写。

字体通知在 licenses/fonts；宿主 OPPOSans、Live2D SDK、人物模型及测试游戏不随这两份归档分发。用户安装后引用的合法宿主依赖不是本包转授权内容。本修订 Creator 为 .7 构建，Engine、Preview、Terre 编辑器与后端沿用既有已核字节；公开前仍需逐项核验实际分发对应源码和许可。
