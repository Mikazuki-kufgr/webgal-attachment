# 兼容范围
文档状态：Hotfix44 当前发行资料；已完成元数据对齐，等待最终真人 smoke，不代表已公开放行。

目标：Windows x64，MyGO 3.2.0，WebGAL Terre 4.6.2；精确核验宿主基线为 `hostfix1-local`。本次不承诺其他版本、平台或任意宿主安装布局。

Hotfix44 的当前发行身份是 `WebGAL Attachment 0.5.0-beta.1 / MPB1-5L-HOTFIX.44`。功能修复 S43-01 / S43-02 / S43-03 已完成并接受；最终真人 smoke 前不宣称真实宿主已安装或 GUI 已验收。

Engine 上游提交 f6a39766054df179385b955cc0cc9598fce71e44；Terre 上游提交 afb6c740de330b619ce560ca739a1a0587482636。插件修改不是上游原版内容，见 SOURCE_CODE.md。

已报告的视觉范围包括 Anon 指定外观的 R01–R05，以及 Hotfix20 CENTER/LEFT/RIGHT 坐标流程和逐句执行；Hotfix20 独立 Web 导出及保存/读取已获用户接受。Hotfix24新增祥子冬季校服已有Profile导入至Terre完整生成剧情01–11用户接受。Hotfix26/27维护与文档修改继承Hotfix25图形构建，不另称为新的视觉验收。

本地中文、空格路径有专项证据；已安装目录搬家、复制或跨盘不能仅凭 ZIP 可解压就宣称支持。UNC、设备路径、重解析点等特殊路径不在本草案承诺范围。Windows EXE 导出尚未验证。

模型和 Live2D SDK 二进制不随技术插件包分发。用户需具备兼容宿主和有权使用的模型。97 份语义 Profile 不是 97 套随包模型，也不是 97 套全动作视觉认证。
