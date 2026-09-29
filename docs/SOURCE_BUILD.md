# 源码范围与构建

本源码树对应 `MYGO321-AUTO-FIGURE-SWITCH.7` 的 INSTALL 功能载荷。`target-webgal-mygo/` 包含 Engine、Creator 与预览相关源码；`target-webgal-mygo-terre/` 包含 Terre 编辑器/后端相关源码；`target-plugin/` 是安装与 Runtime；`20_installable-candidate/source/`、`build-tools/` 与 `distribution-template/` 提供插件及封包输入。`build.mjs` 是各 Web 构建入口；`assemble.mjs` 需要单独取得合法的宿主基线及构建输出，不能只凭此仓库自动生成完整 Terre。

源码包不含 `node_modules`、宿主原包、人物模型、Live2D SDK、已安装用户资料或历史测试游戏。Web 构建入口是仓库根目录的 `build.mjs`；它按 `engine creator preview editor backend` 选择构建项，输出到仓库内 `build-output/`。不要把 `distribution-template/` 当成完整可安装宿主，也不要把构建输出直接覆盖用户的 Terre。

准备依赖时使用 Node.js 20 或更新版本及仓库锁文件对应的 Yarn 1.22.22，在 `target-webgal-mygo/` 和 `target-webgal-mygo-terre/` 分别安装工作区依赖，然后从根目录执行 `node build.mjs engine creator preview editor backend`。这些是源码入口与预期步骤，**尚未在全新机器完成依赖安装及整链复现**；若要产出正式发行包，还需要按 `assemble.mjs` 要求准备合法宿主基线、构建输出和插件封包输入，并完成安装/冷解压验证。构建所用 Node、依赖版本、上游来源和许可证以锁文件、`ACTUAL_DEPENDENCIES.json`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md` 为准。

本地核对已确认 31 个 Runtime 源码映射与 44 个独立代码许可范围路径存在，构建入口语法通过；全新机器依赖安装及逐字节重建尚未完成，因此不能声称可重复产出与 INSTALL 完全相同的二进制字节。INSTALL 的 `manifests/builds.json` 与 `manifests/release-files.json` 记录实际交付文件；历史构建记录中的旧修订名不表示对应源码有新的功能变更。
