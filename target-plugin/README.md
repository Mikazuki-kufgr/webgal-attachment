# MyGO 3.2.0 插件侧迁移源码：5F–5J 产品启动基础

## 5J 当前合同（隔离技术验证，不是可安装 Product）

`resources/product-resources.json` 逐文件固定 Hotfix37 已交付的 Global Library 非 SDK 资源：117文件，其中102份 model-profile JSON（97份 semantic Profile 加5份索引/旧版/专项 Profile）、4份 attachment asset、4份 placement preset、5张附件PNG、索引和验证记录。清单明确 `Live2D SDK=PENDING_PERMISSION_EXCLUDED`、`model binaries=NOT_BUNDLED`；Profile在盘不等于97套模型已在新版宿主完成自动或人工视觉审计。

- 全新 Global Library 先在同级 staging 写完后一次目录切换；崩溃不会暴露半个资料库。已有资料库沿用逐文件内容ownership、冲突预检、journal/backup/rollback；相同外来文件仍不静默收编。
- `materializeProductSelection` 一次只复制所选 Profile/asset/preset/PNG 和稳定materialization元数据到 `game/attachments-v2/`；不改 `start.txt`、普通剧情、figure、config或原图。第二次有效状态相同时保持原时间戳和字节不变。
- 旧 v1 ownership 只有同时匹配可信调用方固定的manifest SHA-256、projectId、releaseVersion、逐文件bytes/SHA和当前实际字节才可生成v2 ledger；只有文件名列表、内容恰好相同、ZIP身份或目录位置都不够。
- 作者工作区仅能从可信启动层固定的本机用户项目一次性复制到精确 `authoringRoot/workspace`，随后明确为用户所有。已有未标记目录不接管；已有合法工作区不再依赖来源项目存在，也不改写用户剧情。
- `creator-launch.mjs` 校验宿主/build/resource/template/根授权，seed资料库后只监听127.0.0.1；session状态绑定精确config，停止命令只发认证HTTP shutdown，不按名字杀Node/Terre/浏览器。普通CMD保持实时日志窗口，直到用户停止/关闭。`--check` 是严格零写入检查，自动fixture使用 `--no-open`，未执行GUI。

5J仍未组装Product、生成releaseRevision、打安装包或处理安装/升级/卸载；CMD与Node路径只是未来staging的明确接线合同。SDK公开再分发许可、模型供应、Terre GUI、Creator/Runtime GPU和用户视觉验收仍待。证据在 `19_product-materialization-launcher`；下列5H及更早合同继续有效。

## 5H 当前合同（源码技术验证，不是可安装 Product）

完整工作台与独立 Runtime 预览已在隔离 Engine 源接线。可信启动层需要同时提供 `workbench:{root,files:[{path,sha256}]}`、`preview:{root,files:[{path,sha256}]}` 两份明确生产构建清单，以及 `authorizedAuthoringWorkspaceRoot`（精确等于 authoringRoot/workspace）。仅授权现有专用目录，不证明其为未经修改的安全副本，不自动 seed、复制模型、安装 SDK 或接管旧 ownership。

- 显式 listen 后从返回的 launchUrl 进入：随机路径交换为 HttpOnly/SameSite=Strict cookie 并重定向干净 URL；只有认证 Creator HTML 注入会话 meta，API 仍必须携带 token header。Preview HTML 不注入 token。Host/Origin、路径/链接和逐文件 pin 校验仍 fail closed。
- `POST /__rc1/project` 要求 presetId + 明确 modelProfileId；完整 packageDocument/revision 随结果返回，不以列表下标代替适配身份。
- `POST /__rc1/apply` 使用原保存事务和 expectedRevision 写入显式专用作者工作区，生成每个 preset 独立验证剧情；不覆盖 CURRENT 或 start.txt。
- `POST /__creator/ensure-preview` 仅证明 pin 过的独立 Preview 文件可服务，返回 `PINNED_SOURCE_FILES_SERVED / NOT_GUI_VALIDATED`；不是 GPU 绘制通过。
- `POST /__creator/shutdown` 回应后仅关闭本服务的监听；不会结束其他进程。未增加闲置自杀或心跳。日志回调与事件已接通，可见 CMD/原生启动器仍由后续阶段接线。
- 静态 game/lib 只读已授权作者工作区；缺失 Profile JSON 可精确读取显式授权 library/model-profiles 中的现有原始字节。没有模型、SDK 或旧宿主隐式回退。

用户工作台采用实例级请求取消、整体资料读取限时、按目标/附件冻结 revision、明确 Profile 选择、保留所有适配的另存新身份、同帧 Runtime ready 与有效 PNG/拟合确认。列表刷新不授予覆盖权；保存响应未知时要求重新打开核对，不能宣称零写入。

尚待：可信可见启动器/安装器整合、B3 seed/materialization、旧 v1 ownership 的确证接管、模型/SDK资源供应、Terre 图形卡片、真实 GUI/GPU、安装/导出及用户视觉。5H 实际编译资产 HTTP 检查不是浏览器执行或用户验收。当前证据在 `17_creator-workbench`；下列 5G/5F 内容作为历史合同保留，阶段未完成描述已由本节替代。

## 5G 接线合同（源码，不是 Product）

`createCreatorService(trustedGrants, {log})` 创建无启动副作用的服务工厂；显式 `await listen(port)` 才监听127.0.0.1（0为临时端口），返回origin/token/PID。`await close()` 关闭自己监听并撤销能力。没有默认主目录、自动浏览器、子进程、Preview或闲置自杀；不复用身份不明的端口。将结构化log输出到用户可见CMD由后续启动器负责，日志回调失败不能把已提交保存改成失败。

trustedGrants完全沿用5F宿主pin/独立home/精确user-data/项目grant/可选authoring grant。只能由可信启动层传入，绝不能从HTTP body、自动目录发现或浏览器session恢复授权。存储层统一通过5F访问器取得项目能力；浏览器只提交项目名称，不能指定绝对保存路径。

| HTTP 接口 | 合同 |
| --- | --- |
| GET /__rc1/health | 后端身份；Runtime兼容性仍NOT_VALIDATED |
| GET /__creator/context | 仅授权项目、完整附件索引、坏文件诊断、真实authoring/library路径 |
| POST /__creator/load-attachment | projectName/presetId；返回完整adaptations、共享层、revision；不替用户选择Profile |
| POST /__creator/save-to-game | 原Creator导出files/IDs + projectName；已有附件必须带load/save返回的expectedRevision |
| GET /__creator/library | 现有Profile索引，不seed、不复制样例、不改变默认人物 |
| POST /__creator/library/profile | 按fileName读取现有Profile |
| POST /__creator/library/import-profile | 从授权项目既有model-profiles按fileName复制进显式授权资料库；原文件不动 |

所有接口（包括GET）必须携带 `X-Creator-Session` 随机会话token；Host必须精确匹配监听地址，若有Origin必须同源。没有通配CORS，POST只接收JSON，body上限12MiB，PNG合计8MiB/单边8192/总像素16Mi。只验证PNG头和尺寸，不冒充浏览器实际解码或视觉质量检查。

保存保持附件自包含，严格校验4/5文件、manifest哈希、路径、Profile绑定及锚点存在。只按Profile ID更新同一适配，同modelPath的不同Profile保留，共享图片仍一份。显示名改变不改变preset/asset/文件夹身份；不自动复制内置样例。模型资源只读，不能自动迁移既有legacy文件夹到portable新位置。已有两处同ID附件直接报告歧义。

事务分两层：5F只决定路径许可，`creator-transaction.mjs`再验证内容所有权。新v2 ownership仅覆盖当前明确受管文件；相同的外来文件不会被偷偷收编。全部冲突先检查，任何冲突不落盘；受管文本的BOM/CRLF等价可识别，正文修改仍冲突。每个preset生成专用 `ATTACHMENT-CREATOR-PREVIEW-<leaf>.txt`，专门的planCreatorSceneWrite不允许start.txt；复用canonical11步流程，去掉对旧示例bg.webp的依赖。

写入使用独占临时文件、fsync、独占journal、同目录备份和不覆盖目标的link发布；ownership最后提交。异常按逆序回滚，只清除本事务创建且未被改动的文件/空目录。电源/进程崩溃或外部修改干扰回滚时保留journal/备份并阻断下一次保存，必须人工核查，绝不自动猜测恢复。成功提交后若清理失败返回成功+清理待处理警告，不能声称保存失败。不是数据库级断电原子性或对恶意本地进程的OS级隔离。

旧v1 portable-folder manifest只声明文件集、没有历史hash，加载时明确LEGACY_FILESET_ONLY_NO_STORED_HASH。旧game-save-v1所有权不会被默认为新v2所有权：可只读打开，外来不同内容更新仍冲突；其确证迁移/安装授权归后续安装迁移层，不能在5G自动接管用户手改数据。

尚未迁移：完整工作台UI、/\_\_rc1/apply作者工作区保存、/\_\_creator/ensure-preview、B3样例materialize/seed/Runtime升级、启动器可见日志、Terre图形卡片与安装/导出。相应API不伪造成功。5H前端必须接入token、expectedRevision、显式Profile选择及Runtime状态；旧前端不能不改就直接接此后端。保存结果PERSISTED ≠ Runtime技术通过 ≠ 用户视觉接受。

合同来源见 `16_creator-service-save/contract-provenance.json`；机械抽取canonical的payload/11步模板，未复制旧server或写入器。自动证据使用真实Node文件系统、故障注入、短时localhost HTTP以及实际canonical导出器/目标parser；不启动GUI或触碰真实游戏。以下5F接口说明继续有效（新增专用场景写计划除外）。

这是独立辅助源码，不是可安装产品；旧 Hotfix37 Product、旧 canonical 和两个目标上游源码未改。Engine 5A–5E 的已验证输入保持冻结。

## 已提供的接口

`runtime/terre-project-access.mjs` 暴露 `discoverTerreLayout`、`createTerreProjectAccess` 和 ABI 常量；只使用 Node 内置库，无网络、服务、GUI、mkdir、复制、删除或保存副作用。

| 身份 | 精确来源/语义 |
| --- | --- |
| installRoot | 用户所选的宿主进程实际工作目录；不是任意 EXE 上级目录猜测 |
| configRoot | 该宿主实际 home/.webgal_terre；必须由可信启动器显式传入 home |
| resolvedUserDataRoot | installRoot/data 目录存在则 portable；否则 config.userDataPath；缺省为 configRoot |
| gamesRoot / projectRoot / gameRoot | active/games；其直接子项目；项目内 game；三者不得混为一谈 |
| engineRoot | installRoot/assets/templates/WebGAL_Template；有项目 index.html 时项目优先，逐文件回退另按宿主规则 |
| UI templates | 默认 UI 固定 install/assets/templates/WebGAL_Default_Template；其他模板按 active/templates → install/public/templates 逐文件查找 |
| derivativeEngineRoot / exportRoot | active/derivative-engines 与 active/Exported_Games；不能据此推导导出成功或写权限 |
| authoringRoot / libraryRoot | 保持独立持久资料区；默认 install/WebGAL-Attachment-Authoring，library 是其子目录，不随 Terre 的四类 managed data 迁移而隐式移动 |

路径默认/custom/portable 的正常语义已对照锁定 Terre `createState`、root helpers、`resolveReadableTemplateFile` 和 `LogicalStaticController.sendGameFile` 实际源码验证。没有调用真实宿主的 initialize/getStatus（会写配置和目录）。HTTP send 被测试替换成返回路径，因此只是目录选择差分，不是 HTTP/GUI 冒烟。

## 可信调用方合同

1. `discoverTerreLayout({installRoot, hostHomeRoot})` 只读指定配置，返回路径事实，**不授权访问发现的新目录**。不全盘搜索、不展开环境变量，不猜当前运行的 Terre 身份。当前未实现进程握手，启动器接线时必须证明选择的是同一个宿主工作目录/home。
2. `createTerreProjectAccess` 另需 `authorizedUserDataRoot`：必须精确等于发现的活动根，不能给其祖先目录作为放行。`hostFiles` 是可信构建/安装清单给出的 `{path,sha256}`，至少含 WebGAL_Terre.exe、引擎 index.html、webgal-engine.json；禁止从 HTTP body 或待验证目录自己计算 hash 后当作可信指纹。校验 metadata 为 MyGO3.2.0/WebGAL4.6.2；这不是完整插件安装指纹或 Runtime 兼容性验证。
3. `projectGrants` 只能来自可信启动器/用户明确选择的项目，格式 `{name,access:'read'|'attachment-write'}`。枚举不授予读写 capability；禁止把任意前端提交的 grant 当作用户确认。打开项目返回进程内 opaque handle，不可从 JSON 还原、伪造或跨 session 复用。
4. 所有方法每次检查配置、portable、根 identity、宿主关键文件与项目 generation。变化时报 REAUTHORIZE/ROOT_REPLACED/HOST_CHANGED；调用方应停止并明确要求重新选择/重启，不静默换根。配置字节变化也会保守失效。
5. `resolveProjectRead` 只读该项目的 game/lib 数据，不做共享引擎回退。`resolvePreviewFile` 才模拟实际逐文件回退：普通项目 assets/index 来自共享引擎；custom 项目优先自己的文件，缺文件可回退；**custom 的 game/template 不回退**。`describeExportSource` 只是源描述，不复制/导出。
6. `planAttachmentWrite` 仅允许 game/attachments-v2 下文件；不能写原图、原剧情、config、引擎或任意路径。独立验证剧情未来需专门的 ownership 接口，不能扩大此方法的白名单代替。路径计划仍标注 `contentOwnershipValidated:false` 与 `runtimeCompatibility:NOT_VALIDATED`。
7. 存在异步间隔后调用 `revalidateWritePlan`，重新检查授权、根/链接与叶子文件版本；即使路径仍在允许根内，已出现/修改的文件也会拒绝旧计划。最终写入仍须后续事务层的全文所有权、冲突检测、备份、失败回滚及创建新文件时的排他打开。不能把路径计划当作已保存或兼容成功。
8. library 默认只读；写计划必须另给 `authorizedAuthoringRoot` 精确根。新安装目录复用旧资料库时必须显式绑定原 Authoring 根；不搬迁、不合并、不重新 seed 用户资料。此阶段不会修改现有资料库位置。

## 有意保守的边界

- Windows 本地盘为本次目标；UNC、设备路径、卷根、`..`、二次编码/编码分隔符、反斜线相对路径、ADS、设备名、尾点/尾空格以及字面 `%` 路径不支持，返回错误，不偷偷改名。相对参数是已解码文件名；URL 只进入专门的一次解码入口。
- 祖先和最终叶子的 symlink/junction（含 dangling、指向根内别名）、已有硬链接文件拒绝；不把链接当授权扩张。真实 Windows junction/hardlink fixture 已验证。
- 错误 JSON/BOM/过大配置、异常 data 非目录等 fail closed。上游 readConfig 会回退默认，本适配器不在异常时擅自选另一个数据根；需提示用户修正配置。相对配置中的上级跳转也保守拒绝。
- 同步路径检查和重验证不是对恶意本地进程的内核级原子沙箱，不能保证检查与实际 open 之间不存在 TOCTOU；目前根本没有提供写操作。最终安装/保存事务仍待实现及故障注入。
- 未改旧 service.ps1/creator-server.mjs、Terre backend/controller、图形卡片或 Creator 工作台。不能直接运行旧服务并假设它已经使用这些接口；实际接线、端口/Origin/session 防护、Runtime 兼容门禁和普通 GUI 仍待后续。

## 测试

在本迁移任务目录运行 `15_terre-project-paths/run-tests.mjs`（现有 portable Node）。测试代码只在该阶段 fixtures 下造数据/链接，不改真实游戏。包含真实上游 TS 的 CPU 路径差分，以及已有 hostfix1-local + 既有隔离 data 的只读探针。模块本身无需构建；Engine/Terre 本轮无源码变化，不重跑旧 519 项或历史 Hotfix37 测试。
