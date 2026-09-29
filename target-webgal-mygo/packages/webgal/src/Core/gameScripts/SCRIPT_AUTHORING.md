# GameScript 实现指南

这里的 gameScript 指 `packages/webgal/src/Core/gameScripts` 下的内核命令实现。它不是给游戏作者看的脚本语法文档，而是给内核命令维护者看的执行模型说明。

核心原则：命令函数负责推进可恢复的演算状态，`IPerform` 负责 commit 后的运行时演出。不要把这两件事混在一起。

## 一条命令做什么

一个命令实现接收 `ISentence`，返回 `IPerform`。

```ts
export function someCommand(sentence: ISentence): IPerform {
  // 1. 解析 sentence.content / sentence.args
  // 2. 修改 calculationStageState 中可恢复、可被后续命令读取的状态
  // 3. 返回 perform，让 commit 后的运行时层启动或清理演出
}
```

命令注册入口在 `Core/parser/sceneParser.ts`。没有运行时演出的命令应返回 `createNonePerform()`。

## 执行顺序

用户正常步进时，主流程是：

1. `preForward()` 检查当前正在运行的 perform 是否阻塞下一步。
2. `forward()` 清理未提交的临时 perform，开始收集本轮 perform。
3. `scriptExecutor()` 执行当前句；如果有 `-next`，会在同一轮 `forward()` 内继续执行后续句。
4. 命令函数只修改 `calculationStageState`，并把返回的 perform 放进 pending 列表。
5. `commitForward()` 调用 `stageStateManager.commit({ applyPixiEffects: false })`，把演算态提交成 `viewStageState`。
6. stage commit handler 同步 Pixi/React/audio 等视图对象。
7. `performController.commitPendingPerforms()` 启动 pending perform 的 `startFunction`。
8. `stageStateManager.applyCommittedPixiEffects()` 把提交后的 `effects` 应用到未被动画锁定的 Pixi 对象。

因此，命令函数里不要主动 `commit()`。命令可能运行在 `-next` 链、快速预览、回放恢复、跳转恢复等流程里，提前 commit 会破坏统一提交点。

## 两种状态

`calculationStageState` 是脚本执行期间的权威状态。后续命令、条件判断、快速预览都会从这里继续算。

`viewStageState` 是提交后的视图状态。React、Pixi 同步层和运行时演出应基于提交后的状态工作。

如果后续命令需要读取某个结果，这个结果必须在命令函数阶段写进 `calculationStageState`，或者在特殊的 pending discard 结算钩子里补写。不要只写在 `startFunction`、Pixi loader 回调、动画结束回调里；这些代码在快速预览历史行里可能根本不会执行。

## IPerform 生命周期

`IPerform` 有三个常见状态：

1. pending：命令函数已经返回，但本轮还没有 commit，`startFunction` 还没执行。
2. running：commit 后 `startFunction` 已执行，perform 在 `performList` 中等待自然结束或手动卸载。
3. discarded：pending perform 在 commit 前被丢弃，不会进入 running。

字段职责：

- `performName`：用于去重、保存和卸载。目标相关演出应使用稳定前缀，例如 `animation-${target}`。
- `duration`：非 hold 演出的自动回收时间。
- `isHoldOn`：是否为保持型演出。保持型演出会留在状态中，直到显式卸载。
- `startFunction`：只做运行时动作，例如注册 Pixi 动画、播放媒体、挂载 UI。它只在 commit 后执行。
- `stopFunction`：清理已经启动的运行时动作。它只应该假设 `startFunction` 已经执行过。
- `blockingNext`：是否阻塞用户下一步。
- `blockingAuto`：是否阻塞自动播放。
- `blockingStateCalculation`：是否阻塞继续演算后续状态。只有需要外部输入才能确定后续状态时才使用，例如选项和用户输入。

## 演算状态只允许顺序写

附件扩展的有界例外：上游 3.2.1 已取消原生命令的 `settleStateOnDiscard`；本分支仅为需要等待人物/锚点首帧的附件 add 保留该回调。它只在快速预览丢弃尚未提交的表现层时，核对同一最新 add intent 与绑定后结算可见性，不恢复原生命令的延迟写模式。相关反例由 attachment.commands 与 Runtime01 CPU 集成测试覆盖。

演算状态（`calculationStageState`）的写入必须发生在命令函数阶段，顺序与语句顺序一致。

**不要把状态写入推迟到 `startFunction`、`stopFunction`、动画结束回调或 `setTimeout` 里。** 这类"延迟写"注册于语句 N，却执行于一个与语句顺序无关的时点，会覆盖语句 N+1 已经写好的状态。历史上 `settleStateOnDiscard` 就是为了给这种延迟写打补丁而存在的，现已连同问题一起移除。

正确的分工：

- **命令函数阶段**：算出终态并写入演算状态。终态必须是同步可算的——如果算不出来，说明这个状态不该由这条命令负责。
- **`startFunction`**：只做运行时动作（注册 Pixi 动画、播放媒体、挂载 UI），不写演算状态。
- **`stopFunction`**：只清理运行时动作。

这样一条命令的 perform 无论被启动、被提前结算还是被丢弃，演算状态都一样，快速预览与正常播放自然一致。

## 快速预览为什么仍然特殊

实时预览快进会连续调用 `forward()`，中间不 commit，只在到达目标位置后提交一次。前一轮 `forward()` 收集到的非 hold pending perform，会在下一轮 `forward()` 开头被丢弃，因此不会执行 `startFunction` 和 `stopFunction`。

这只影响**视觉**，不影响演算状态——前提是命令遵守上面那条规则。如果某个命令把状态写进了这两个回调，快速预览就会丢状态，这是命令实现的 bug，不是预览机制的缺陷。

## 动画命令

动画命令要区分两件事：

- 演算终态：后续命令、存档、恢复、快速预览要读取的状态。
- 运行时动画：当前画面上逐帧播放的效果。

`setAnimation`、`setTransform`、`setTempAnimation` 这类命令通常应该在命令函数阶段调用 `applyAnimationEndState()` 或等价逻辑，把终态写入 `calculationStageState.effects`。运行时动画再由 returned perform 的 `startFunction` 注册。

`-parallel` 下只能写动画实际控制的字段。例如只改 `scale` 的并行动画不应该把 `position` 重置成默认值。生成 timeline 或写终态时要使用局部字段合并，而不是完整覆盖目标 transform。

新背景、新立绘的进入动画不是特殊情况，遵循同一条规则：`changeBg`、`changeFigure` 在命令函数阶段调用 `applyAnimationEndState()` 写入终态，进入动画由 returned perform 的 `startFunction` 用 `registerAnimation()` 注册。因此不存在"延迟结算"，快速预览与正常播放读到的演算状态一致。

进入动画的演出名与 `setTransform` 等共用 `animation-<target>`，同一目标上的动画冲突由演出去重统一裁决：后写的命令顶掉先写的，不需要按 `effects` 是否存在来猜测。视图层（`syncPixiStageState`）只负责创建和移除舞台对象，不再补写进入动画。

## 参数和资源

参数解析使用 `getStringArgByKey`、`getNumberArgByKey`、`getBooleanArgByKey` 等工具。注意区分参数缺省和显式传入 `false`。

资源路径使用 `assetSetter()` 处理，不要在命令里手写资源目录拼接。

JSON 参数必须 try/catch。解析失败时应回退到旧语义或安全默认值，不能让脚本执行器抛出异常中断整个 `forward()`。

## 状态更新原则

只把可恢复、可存档、可被后续命令依赖的内容写入 stage state。临时 DOM、Pixi ticker、timer、音频实例、loader 中间状态都不应该写进 stage state。

直接访问 `WebGAL.gameplay.pixiStage` 的代码尽量放在 `startFunction`、`stopFunction` 或 stage sync 层。命令函数阶段如果必须访问 Pixi，只能用于不会决定可恢复状态的标记或清理。

修改已有目标时，先判断 URL、id、target 是否真的变化。资源未变化时应保留旧 transform、Live2D 参数、metadata 等状态，只更新显式传入的字段。

## 附件分离、重新绑定与位置坐标

`setTransform` 的 position 是目标值，不是相对上一位置的增量。普通立绘的 x/y 是相对实际站位布局原点的偏移；单位是游戏舞台单位，不是预览窗口 CSS 像素。left/right 会改变原点，而不是给 x 加一个永久变换；具体布局还依赖宿主定位版本、舞台及素材尺寸、贴底规则。不能把所有 (0,0) 都解释为屏幕中心。

默认 `stageEntity:detach`（也可显式 `-coordinates=figure`）保留当帧世界位置，并冻结父立绘的原生布局原点，不包含父立绘另设的 x/y。后续自由附件的 position 使用这个固定原点，与立绘相同的轴向、单位和目标偏移语义；人物随后移动、替换或退场不会拖动它。重新绑定完成后清除自由基准、恢复原锚点局部摆放；再次分离捕获新父体基准。绑定状态的附件 placement/变换仍相对锚点。

例如原生中间立绘布局原点为 (960,540)，自由附件目标 (-180,-100) 对应内部舞台位置 (780,440)；左侧立绘原点若为 (530,540)，同样目标对应 (350,440)。这些原点仅是示例，不是硬编码值。编辑器基线、预览、拖拽及保存恢复使用同一冻结基准。内部 visualState/effects 仍为世界值，不得再手工追加基准。

兼容：旧存档中没有 freePositionOrigin 的自由实体继续使用旧舞台绝对坐标，不猜测迁移。旧脚本重新执行默认 detach 将采用新语义；要保留原效果，可在其分离句显式使用 `-coordinates=world`，Terre 对应“旧版舞台绝对坐标”。此模式 (0,0) 才是舞台左上角；不会自动改写用户文件。新模式的冻结基准随存档保存，不依赖原父体继续存在。

重新绑定沿指定时长和缓动追踪当帧锚点，恢复原局部摆放，不能把回位期间的人物动作差保存成新的偏移。内部回位轨迹直接使用世界值，不经过作者位置换算。

detach/reattach 使用 `-continue` 表示成功后继续，不允许 `-next`。快进请求拥有其屏障后的推进权，不应再消费第二次自动继续；失败/取消不得显示下一句成功说明。对同次 replay 的 add→detach，不能把已提交声明误认为已物化 Runtime；须等待同一身份/代际的资源及真实可用帧，取消、超时、加载失败和替换必须终止原等待。

## 检查清单

- 后续命令需要读取的状态是否已经写入 `calculationStageState`？
- perform 在快速预览历史行中被丢弃时，最终状态是否仍然正确？
- 是否有任何演算状态的写入被推迟到了 `startFunction`、`stopFunction` 或定时器里？
- `startFunction` 是否只依赖已 commit 的状态？
- `stopFunction` 是否只清理已经启动过的运行时动作？
- `-next`、`-continue`、`-parallel`、`-keep` 下状态是否一致？
- 并行动画是否只写自己控制的 transform 字段？
- 没有运行时演出的命令是否使用了 `createNonePerform()`？
