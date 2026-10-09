# 爱音冬服 · 全动作手型调用参考

覆盖当前 `anon/school_winter-2023` 的 **664 个动作入口 / 664 个动作文件**，共 14 个实际手部参数。资料快照：2026-10-09。

[下载离线检索网页](https://raw.githubusercontent.com/Mikazuki-kufgr/webgal-attachment/main/docs/reference/anon-winter-hand-motions/index.html)（保存为HTML后双击，可断网使用），[动作总表CSV](motions.csv)、[逐参数时段CSV](hand-calls.csv)、[完整JSON](motions.json)。网页支持动作名/前缀/参数侧/手型筛选、时序展开和筛选结果CSV下载。GitHub文件页只显示HTML源码；本次没有配置GitHub Pages。

## 如何理解

- L/R是文件参数标识，不直接等同屏幕左/右，也不替角色左右命名。手型编号不代表抓握/张手等语义；具体外观需看对应模型。
- 正值调用按采样值>0收录，>0.5仅作便于查找的门槛，不证明网格可见或唯一主导；允许两种手型同时混合。
- 未声明的参数保留“未声明”，不能当作零；播放时可能沿用模型/前序动作状态。已声明但全零与未声明不同。
- 时间是动作文件的离散采样首末帧，包含端点；末采样=(帧数−1)/fps，帧跨度=帧数/fps。短通道按末值延展供索引查询；Runtime插值、淡入淡出、参数覆盖、物理和最终网格透明度另行观察。文件/入口淡入值在JSON分别保留；缺失文件fade字段标null，不猜默认配置。
- 所有动作来自同一model.json；不同前缀只是入口名称，不证明对应人物或其他服装兼容。表格不是664动作的视觉验收，也不承诺全部手型有附件适配。
- 仅发布派生索引，没有上传model.json、moc、贴图或原始mtn文件。SHA256用于辨认这一版文件，不构成插件内容兼容门禁。

## 来源与复核

读取本项目当前隔离验收所用爱音冬服model.json及其每一个motion引用；不改源文件。model.json SHA256：`3a12fd70f2703423ee11dc80179c4d63b038f7a4ed13e10aeb770e08247cc8ed`。逐动作相对路径/哈希随JSON与总表提供。生成方法为逐行解析MTN数值通道、取全通道最大采样数和文件fps，再统计实际PARAM_HAND参数；详见[方法与验证](METHOD.md)。

## 各参数覆盖

|参数|已声明入口|正值调用入口|>0.5入口|
|---|---:|---:|---:|
|PARAM_HAND_L_01_001|664|342|342|
|PARAM_HAND_L_02_001|664|21|21|
|PARAM_HAND_L_03_001|664|15|15|
|PARAM_HAND_L_04_001|664|9|9|
|PARAM_HAND_L_05_001|664|109|109|
|PARAM_HAND_L_06_001|664|12|12|
|PARAM_HAND_L_07_001|664|207|207|
|PARAM_HAND_R_01_001|664|272|272|
|PARAM_HAND_R_02_001|664|54|54|
|PARAM_HAND_R_03_001|664|7|6|
|PARAM_HAND_R_04_001|664|10|8|
|PARAM_HAND_R_05_001|664|218|218|
|PARAM_HAND_R_06_001|664|11|11|
|PARAM_HAND_R_09_001|664|140|140|

## 全动作总表

“—”指该侧没有声明参数超过0.5，不代表手部不可见。详细声明情况及区间见JSON/逐参数CSV。

|动作入口|末采样秒|L侧正值调用|R侧正值调用|L侧>0.5序列|R侧>0.5序列|
|---|---:|---|---|---|---|
|anon/angry01|4.967|L01, L05|R01, R05|0s:05 → 0.833s:01|0s:05 → 0.833s:01|
|anon/angry02|6.467|L07|R09|0s:07|0s:09|
|anon/angry03|6.467|L01, L05|R01, R05|0s:05 → 0.7s:01|0s:05 → 0.7s:01|
|anon/angry04|7.967|L01|R01|0s:01|0s:01|
|anon/bye01|6.467|L01|R04|0s:01|0s:04|
|anon/cry01|6.467|L05|R05|0s:05|0s:05|
|anon/cry02|4.967|L06|R06|0s:06|0s:06|
|anon/gacha_b2024_01|6.467|L05|R01|0s:05|0s:01|
|anon/gacha_c_a_01|5.967|L01, L02|R02, R05|0s:01 → 2.267s:— → 2.3s:02|0s:05 → 2.267s:— → 2.3s:02|
|anon/gacha_df3_01|6.467|L05|R01|0s:05|0s:01|
|anon/gacha_e235_01|7.967|L01|R05|0s:01|0s:05|
|anon/gacha_e253_01|10.367|L01, L02, L05, L07|R01, R02, R05, R09|0s:02 → 3.367s:— → 3.4s:07 → 4.167s:05 → 7.033s:01|0s:02 → 3.367s:— → 3.4s:09 → 4.167s:05 → 7.033s:01|
|anon/idle01|5.967|L01|R01|0s:01|0s:01|
|anon/kandou01|8.967|L06|R06|0s:06|0s:06|
|anon/kandou02|8.967|L07|R05|0s:07|0s:05|
|anon/kime01|5.967|L02|R02|0s:02|0s:02|
|anon/kime02|6.967|L01|R05, R09|0s:01|0s:09 → 1.433s:05|
|anon/nf_left01|6.467|L07|R01|0s:07|0s:01|
|anon/nf_right01|6.967|L07|R02|0s:07|0s:02|
|anon/nf01|6.967|L01|R05|0s:01|0s:05|
|anon/nf02|5.467|L01|R02|0s:01|0s:02|
|anon/nf03|6.967|L07|R01|0s:07|0s:01|
|anon/nf04|7.467|L01|R01|0s:01|0s:01|
|anon/nf05|6.967|L02|R05|0s:02|0s:05|
|anon/nnf03|6.933|L07|R01|0s:07|0s:01|
|anon/nnf04|7.467|L01|R01|0s:01|0s:01|
|anon/nnf05|6.967|L02|R05|0s:02|0s:05|
|anon/sad01|5.967|L01|R01|0s:01|0s:01|
|anon/sad02|8.467|L01|R05, R09|0s:01|0s:09 → 1.9s:05|
|anon/serious01|7.967|L01|R05|0s:01|0s:05|
|anon/serious02|8.967|L07|R05|0s:07|0s:05|
|anon/shame01|7.967|L01|R01|0s:01|0s:01|
|anon/shame02|7.967|L01|R02|0s:01|0s:02|
|anon/smile01|5.967|L01, L02|R02, R05|0s:01 → 2.267s:— → 2.3s:02|0s:05 → 2.267s:— → 2.3s:02|
|anon/smile01_ingameV2_01|10.367|L01, L02, L05, L07|R01, R02, R05, R09|0s:02 → 3.367s:— → 3.4s:07 → 4.167s:05 → 7.033s:01|0s:02 → 3.367s:— → 3.4s:09 → 4.167s:05 → 7.033s:01|
|anon/smile01_ingameV2_02|7.967|L01|R05|0s:01|0s:05|
|anon/smile02|6.467|L05|R01|0s:05|0s:01|
|anon/smile03|6.967|L01|R01|0s:01|0s:01|
|anon/smile04|8.967|L01|R01|0s:01|0s:01|
|anon/surprised01|7.467|L01|R01|0s:01|0s:01|
|anon/thinking01|9.967|L07|R09|0s:07|0s:09|
|anon/thinking02|9.967|L07|R09|0s:07|0s:09|
|anon/thinking03|8.967|L07|R09|0s:07|0s:09|
|anon/wink01|7.467|L01|R05, R09|0s:01|0s:09 → 1.333s:05|
|mana/angry01|3.8|L01|R01|0s:01|0s:01|
|mana/bye01|3.6|L04|R04|0s:04|0s:04|
|mana/cry01|3.867|L05, L07|R05, R09|0s:07 → 1s:05+07 → 1.033s:05|0s:09 → 0.9s:05+09 → 0.933s:05|
|mana/eeto01|4.367|L07|R09|0s:07|0s:09|
|mana/gattsu01|3.667|L05|R05|0s:05|0s:05|
|mana/idle01|5.967|L01|R01|0s:01|0s:01|
|mana/jaan01|3.933|L04, L05|R04, R05|0s:05 → 0.833s:04|0s:05 → 0.833s:04|
|mana/nf_left01|3.633|L01|R05|0s:01|0s:05|
|mana/nf_right01|3.6|L01|R01|0s:01|0s:01|
|mana/nf01|4.267|L01|R01|0s:01|0s:01|
|mana/nf02|3.633|L05|R01|0s:05|0s:01|
|mana/nf03|4.267|L07|R01|0s:07|0s:01|
|mana/nf04|3.6|L01|R01|0s:01|0s:01|
|mana/nf05|4.467|L05|R05|0s:05|0s:05|
|mana/nnf_left01|3.633|L01|R05|0s:01|0s:05|
|mana/nnf_right01|3.6|L01|R01|0s:01|0s:01|
|mana/nnf01|4.267|L01|R01|0s:01|0s:01|
|mana/nnf02|3.633|L05|R01|0s:05|0s:01|
|mana/nnf03|4.267|L07|R01|0s:07|0s:01|
|mana/nnf04|3.6|L01|R01|0s:01|0s:01|
|mana/nnf05|4.467|L05|R05|0s:05|0s:05|
|mana/sad01|3.3|L01|R01|0s:01|0s:01|
|mana/shame01|4.6|L01|R09|0s:01|0s:09|
|mana/smile01|3.9|L01|R01|0s:01|0s:01|
|mana/smile02|3.8|L05|R01|0s:05|0s:01|
|mana/smile03|3.8|L01|R01|0s:01|0s:01|
|mana/surprised01|4.2|L01|R01|0s:01|0s:01|
|mutsumi/angry01|4|L01|R01|0s:01|0s:01|
|mutsumi/bow|5.533|L07|R05|0s:07|0s:05|
|mutsumi/bye01|5.533|L01|R01|0s:01|0s:01|
|mutsumi/idle01|6|L01|R01|0s:01|0s:01|
|mutsumi/kime01|4.367|L05|R01|0s:05|0s:01|
|mutsumi/maskon/angry01|4|L01|R01|0s:01|0s:01|
|mutsumi/maskon/bow|5.533|L07|R05|0s:07|0s:05|
|mutsumi/maskon/bye01|5.533|L01|R01|0s:01|0s:01|
|mutsumi/maskon/idle01|6|L01|R01|0s:01|0s:01|
|mutsumi/maskon/kime01|4.367|L05|R01|0s:05|0s:01|
|mutsumi/maskon/nf_left01|4|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nf_right01|4|L07|R05|0s:07|0s:05|
|mutsumi/maskon/nf01|4.1|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nf02|3.533|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nf03|4.567|L07|R01|0s:07|0s:01|
|mutsumi/maskon/nf04|4.167|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nf05|3.933|L05|R01|0s:05|0s:01|
|mutsumi/maskon/nnf_left01|4|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nnf_right01|4.1|L07|R05|0s:07|0s:05|
|mutsumi/maskon/nnf01|4.1|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nnf02|3.533|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nnf03|4.567|L07|R01|0s:07|0s:01|
|mutsumi/maskon/nnf04|4.167|L01|R01|0s:01|0s:01|
|mutsumi/maskon/nnf05|3.933|L05|R01|0s:05|0s:01|
|mutsumi/maskon/odoodo01|3.933|L07|R05|0s:07|0s:05|
|mutsumi/maskon/sad01|4.333|L01|R01|0s:01|0s:01|
|mutsumi/maskon/sad02|4.333|L01|R01|0s:01|0s:01|
|mutsumi/maskon/sad03|4.1|L05|R05|0s:05|0s:05|
|mutsumi/maskon/sad04|4.333|L05|R05|0s:05|0s:05|
|mutsumi/maskon/smile01|4.5|L01|R01|0s:01|0s:01|
|mutsumi/maskon/smile02|4.5|L01|R01|0s:01|0s:01|
|mutsumi/maskon/smile04|4.5|L01|R05|0s:01|0s:05|
|mutsumi/maskon/surprised01|3.233|L01|R01|0s:01|0s:01|
|mutsumi/maskon/thinking01|4.967|L07|R05|0s:07|0s:05|
|mutsumi/mts/angry01|4|L02|R02|0s:02|0s:02|
|mutsumi/mts/angry02|3.3|L05|R05|0s:05|0s:05|
|mutsumi/mts/angry03|4|L05|R05|0s:05|0s:05|
|mutsumi/mts/angry04|2.967|L05|R06, R09|0s:05|0s:06 → 0.633s:— → 0.733s:09|
|mutsumi/mts/cry01|3.967|L05|R05|0s:05|0s:05|
|mutsumi/mts/idle01|6|L01|R01|0s:01|0s:01|
|mutsumi/mts/nf_left01|4|L07|R05|0s:07|0s:05|
|mutsumi/mts/nf_right01|4|L07|R05|0s:07|0s:05|
|mutsumi/mts/nf01|4.1|L01|R01|0s:01|0s:01|
|mutsumi/mts/nf02|3.533|L01|R01|0s:01|0s:01|
|mutsumi/mts/nf03|4.567|L01|R05|0s:01|0s:05|
|mutsumi/mts/nf04|3.833|L01|R01|0s:01|0s:01|
|mutsumi/mts/nf05|3.933|L02|R01|0s:02|0s:01|
|mutsumi/mts/nnf_left01|4|L07|R05|0s:07|0s:05|
|mutsumi/mts/nnf_right01|4|L07|R05|0s:07|0s:05|
|mutsumi/mts/nnf01|4.1|L01|R01|0s:01|0s:01|
|mutsumi/mts/nnf02|3.533|L01|R01|0s:01|0s:01|
|mutsumi/mts/nnf03|4.567|L01|R05|0s:01|0s:05|
|mutsumi/mts/nnf04|3.833|L01|R01|0s:01|0s:01|
|mutsumi/mts/nnf05|3.933|L02|R01|0s:02|0s:01|
|mutsumi/mts/sad01|4.333|L05|R05|0s:05|0s:05|
|mutsumi/mts/sad02|3.3|L07|R05|0s:07|0s:05|
|mutsumi/mts/sad03|4.633|L07|R05|0s:07|0s:05|
|mutsumi/mts/smile01|4.5|L05|R01|0s:05|0s:01|
|mutsumi/mts/smile02|4.3|L03|R01|0s:03|0s:01|
|mutsumi/mts/smile03|3.633|L07|R01|0s:07|0s:01|
|mutsumi/nf_left01|4|L01|R01|0s:01|0s:01|
|mutsumi/nf_right01|4|L07|R05|0s:07|0s:05|
|mutsumi/nf01|4.1|L01|R01|0s:01|0s:01|
|mutsumi/nf02|3.533|L01|R01|0s:01|0s:01|
|mutsumi/nf03|4.567|L07|R01|0s:07|0s:01|
|mutsumi/nf04|4.167|L01|R01|0s:01|0s:01|
|mutsumi/nf05|3.933|L05|R01|0s:05|0s:01|
|mutsumi/nnf_left01|4|L01|R01|0s:01|0s:01|
|mutsumi/nnf_right01|4.1|L07|R05|0s:07|0s:05|
|mutsumi/nnf01|4.1|L01|R01|0s:01|0s:01|
|mutsumi/nnf02|3.533|L01|R01|0s:01|0s:01|
|mutsumi/nnf03|4.567|L07|R01|0s:07|0s:01|
|mutsumi/nnf04|4.167|L01|R01|0s:01|0s:01|
|mutsumi/nnf05|3.933|L05|R01|0s:05|0s:01|
|mutsumi/odoodo01|3.933|L07|R05|0s:07|0s:05|
|mutsumi/sad01|4.333|L01|R01|0s:01|0s:01|
|mutsumi/sad02|4.333|L01|R01|0s:01|0s:01|
|mutsumi/sad03|4.1|L05|R05|0s:05|0s:05|
|mutsumi/sad04|4.333|L05|R05|0s:05|0s:05|
|mutsumi/smile01|4.5|L01|R01|0s:01|0s:01|
|mutsumi/smile02|4.5|L01|R01|0s:01|0s:01|
|mutsumi/smile04|4.5|L01|R05|0s:01|0s:05|
|mutsumi/surprised01|3.233|L01|R01|0s:01|0s:01|
|mutsumi/surprised02|3.533|L05, L07|R05, R09|0s:07 → 1s:05|0s:09 → 1s:05|
|mutsumi/thinking01|4.967|L07|R05|0s:07|0s:05|
|nyamu/angry01|3.967|L01|R01|0s:01|0s:01|
|nyamu/bored|4.667|L02|R02|0s:02|0s:02|
|nyamu/bow|3.933|L03, L04|R01|0s:04 → 1.6s:03|0s:01|
|nyamu/bye01|3.6|L04|R04|0s:04|0s:04|
|nyamu/cry01|5.6|L01|R01|0s:01|0s:01|
|nyamu/idle01|6.967|L01|R01|0s:01|0s:01|
|nyamu/kime01|4.067|L04|R01|0s:04|0s:01|
|nyamu/kime02|4.067|L05|R05|0s:05|0s:05|
|nyamu/maskoff|4.267|L04, L07|R01, R05|0s:07 → 1.367s:04|0s:05 → 1.367s:01|
|nyamu/maskon/angry01|3.967|L01|R01|0s:01|0s:01|
|nyamu/maskon/bored|4.667|L02|R02|0s:02|0s:02|
|nyamu/maskon/bow|3.933|L03, L04|R01|0s:04 → 1.6s:03|0s:01|
|nyamu/maskon/bye01|3.6|L04|R04|0s:04|0s:04|
|nyamu/maskon/cry01|5.6|L01|R01|0s:01|0s:01|
|nyamu/maskon/idle01|6.967|L01|R01|0s:01|0s:01|
|nyamu/maskon/kime01|4.067|L04|R01|0s:04|0s:01|
|nyamu/maskon/kime02|4.067|L05|R05|0s:05|0s:05|
|nyamu/maskon/nf_left01|4.5|L01|R01|0s:01|0s:01|
|nyamu/maskon/nf_right01|4.433|L01|R01|0s:01|0s:01|
|nyamu/maskon/nf01|3.3|L01|R09|0s:01|0s:09|
|nyamu/maskon/nf02|2.967|L01|R01|0s:01|0s:01|
|nyamu/maskon/nf03|4.633|L07|R01|0s:07|0s:01|
|nyamu/maskon/nf04|3.3|L01|R01|0s:01|0s:01|
|nyamu/maskon/nf05|3.9|L01|R02|0s:01|0s:02|
|nyamu/maskon/niyake|3.533|L02, L05|R02|0s:05 → 0.933s:02|0s:02|
|nyamu/maskon/nnf_left01|4.5|L01|R01|0s:01|0s:01|
|nyamu/maskon/nnf_right01|4.433|L01|R01|0s:01|0s:01|
|nyamu/maskon/nnf01|3.3|L01|R09|0s:01|0s:09|
|nyamu/maskon/nnf02|2.967|L01|R01|0s:01|0s:01|
|nyamu/maskon/nnf03|4.633|L07|R01|0s:07|0s:01|
|nyamu/maskon/nnf04|3.3|L01|R01|0s:01|0s:01|
|nyamu/maskon/nnf05|3.9|L01|R02|0s:01|0s:02|
|nyamu/maskon/sad01|4.333|L01|R05|0s:01|0s:05|
|nyamu/maskon/serious01|3.967|L01|R01|0s:01|0s:01|
|nyamu/maskon/smile01|3.5|L06|R06|0s:06|0s:06|
|nyamu/maskon/smile02|3.467|L05|R05|0s:05|0s:05|
|nyamu/maskon/smile03|4.033|L07|R09|0s:07|0s:09|
|nyamu/maskon/surprised01|4.667|L03|R03|0s:03|0s:03|
|nyamu/maskon/surprised02|3.333|L05, L07|R05, R09|0s:05 → 0.3s:07|0s:05 → 0.3s:09|
|nyamu/nf_left01|4.5|L01|R01|0s:01|0s:01|
|nyamu/nf_right01|4.433|L01|R01|0s:01|0s:01|
|nyamu/nf01|3.3|L01|R09|0s:01|0s:09|
|nyamu/nf02|2.967|L01|R01|0s:01|0s:01|
|nyamu/nf03|4.633|L07|R01|0s:07|0s:01|
|nyamu/nf04|3.3|L01|R01|0s:01|0s:01|
|nyamu/nf05|3.9|L01|R02|0s:01|0s:02|
|nyamu/niyake|3.533|L02, L05|R02|0s:05 → 0.933s:02|0s:02|
|nyamu/nnf_left01|4.5|L01|R01|0s:01|0s:01|
|nyamu/nnf_right01|4.433|L01|R01|0s:01|0s:01|
|nyamu/nnf01|3.3|L01|R09|0s:01|0s:09|
|nyamu/nnf02|2.967|L01|R01|0s:01|0s:01|
|nyamu/nnf03|4.633|L07|R01|0s:07|0s:01|
|nyamu/nnf04|3.3|L01|R01|0s:01|0s:01|
|nyamu/nnf05|3.9|L01|R02|0s:01|0s:02|
|nyamu/sad01|4.333|L01|R05|0s:01|0s:05|
|nyamu/serious01|3.967|L01|R01|0s:01|0s:01|
|nyamu/smile01|3.5|L06|R06|0s:06|0s:06|
|nyamu/smile02|3.467|L05|R05|0s:05|0s:05|
|nyamu/smile03|4.033|L07|R09|0s:07|0s:09|
|nyamu/surprised01|4.667|L03|R03|0s:03|0s:03|
|nyamu/surprised02|3.333|L05, L07|R05, R09|0s:05 → 0.3s:07|0s:05 → 0.3s:09|
|rana/angry01|4.467|L01|R01|0s:01|0s:01|
|rana/angry02|4.967|L07|R09|0s:07|0s:09|
|rana/angry03|4.467|L01|R01|0s:01|0s:01|
|rana/bye01|7|L01|R01|0s:01|0s:01|
|rana/cry01|4.467|L01|R01|0s:01|0s:01|
|rana/gacha_b2024_01|5.967|L01|R02|0s:01|0s:02|
|rana/gacha_c_a_01|8.967|L01|R05|0s:01|0s:05|
|rana/gacha_df3_01|5.467|L01|R05|0s:01|0s:05|
|rana/gacha_e240_01|5.967|L01|R02|0s:01|0s:02|
|rana/gacha_e286_01|11.5|L03, L05|R01|0s:05 → 0.233s:03 → 2.3s:05|0s:01|
|rana/gacha_e287_01|5.967|L01|R02|0s:01|0s:02|
|rana/idle01|5.967|L01|R01|0s:01|0s:01|
|rana/kime01|4.967|L01|R01|0s:01|0s:01|
|rana/nf_left01|4.967|L01|R01|0s:01|0s:01|
|rana/nf_right01|4.967|L01|R01|0s:01|0s:01|
|rana/nf01|8.967|L01|R05|0s:01|0s:05|
|rana/nf01_ingameV2|4.967|L01|R01|0s:01|0s:01|
|rana/nf02|4.967|L01|R01|0s:01|0s:01|
|rana/nf03|5.467|L07|R01|0s:07|0s:01|
|rana/nf04|5.467|L01|R01|0s:01|0s:01|
|rana/nf05|4.967|L01|R01|0s:01|0s:01|
|rana/niya01|6.467|L01|R09|0s:01|0s:09|
|rana/nnf01|4.967|L01|R01|0s:01|0s:01|
|rana/nnf04|5.467|L01|R01|0s:01|0s:01|
|rana/nnf05|4.967|L01|R01|0s:01|0s:01|
|rana/sad01|5.967|L01|R01|0s:01|0s:01|
|rana/serious01|5.467|L01|R01|0s:01|0s:01|
|rana/serious02|5.467|L01|R09|0s:01|0s:09|
|rana/shame01|4.967|L07|R09|0s:07|0s:09|
|rana/sigh01|4.967|L01|R01|0s:01|0s:01|
|rana/smile01|11.5|L03, L05|R01|0s:05 → 0.233s:03 → 2.3s:05|0s:01|
|rana/smile01_ingameV2|5.467|L01|R05|0s:01|0s:05|
|rana/smile02|5.967|L01|R02|0s:01|0s:02|
|rana/smile04|5.467|L01|R01|0s:01|0s:01|
|rana/surprised01|4.967|L01|R01|0s:01|0s:01|
|rana/thinking01|6.967|L07|R01|0s:07|0s:01|
|sakiko/angry01|4.133|L01|R01|0s:01|0s:01|
|sakiko/angry02|4|L05|R05|0s:05|0s:05|
|sakiko/angry03|4.3|L07|R05|0s:07|0s:05|
|sakiko/angry04|3.8|L07|R01|0s:07|0s:01|
|sakiko/angry05|3.6|L07|R01|0s:07|0s:01|
|sakiko/angry06|3.967|L07|R09|0s:07|0s:09|
|sakiko/angry07|4.067|L01|R05|0s:01|0s:05|
|sakiko/bow|3.967|L01|R01|0s:01|0s:01|
|sakiko/bye01|4.2|L07|R05|0s:07|0s:05|
|sakiko/bye02|4.2|L07|R05|0s:07|0s:05|
|sakiko/cry01|3.8|L07|R05|0s:07|0s:05|
|sakiko/cry02|3.8|L07|R09|0s:07|0s:09|
|sakiko/cry03|4.3|L07|R05|0s:07|0s:05|
|sakiko/cry04|3.867|L05|R05|0s:05|0s:05|
|sakiko/cry05|3.867|L05|R05|0s:05|0s:05|
|sakiko/cry06|4.6|L05|R05|0s:05|0s:05|
|sakiko/idle01|6.967|L07|R05|0s:07|0s:05|
|sakiko/kime01|4.033|L01|R09|0s:01|0s:09|
|sakiko/maskoff|4.633|L05, L07|R01|0s:05 → 0.167s:07|0s:01|
|sakiko/maskon/angry01|4.133|L01|R01|0s:01|0s:01|
|sakiko/maskon/angry02|4|L05|R05|0s:05|0s:05|
|sakiko/maskon/angry03|4.3|L07|R05|0s:07|0s:05|
|sakiko/maskon/angry04|3.8|L07|R01|0s:07|0s:01|
|sakiko/maskon/angry05|3.6|L07|R01|0s:07|0s:01|
|sakiko/maskon/angry06|3.967|L07|R09|0s:07|0s:09|
|sakiko/maskon/angry07|4.067|L01|R05|0s:01|0s:05|
|sakiko/maskon/bow|3.967|L01|R01|0s:01|0s:01|
|sakiko/maskon/bye01|4.2|L07|R05|0s:07|0s:05|
|sakiko/maskon/bye02|4.2|L07|R05|0s:07|0s:05|
|sakiko/maskon/cry01|3.8|L07|R05|0s:07|0s:05|
|sakiko/maskon/cry02|3.8|L07|R09|0s:07|0s:09|
|sakiko/maskon/cry03|4.3|L07|R05|0s:07|0s:05|
|sakiko/maskon/cry04|3.867|L05|R05|0s:05|0s:05|
|sakiko/maskon/cry05|3.867|L05|R05|0s:05|0s:05|
|sakiko/maskon/cry06|4.6|L05|R05|0s:05|0s:05|
|sakiko/maskon/idle01|6.967|L07|R05|0s:07|0s:05|
|sakiko/maskon/kime01|4.033|L01|R09|0s:01|0s:09|
|sakiko/maskon/nf_left01|4.133|L07|R01|0s:07|0s:01|
|sakiko/maskon/nf_right01|3.767|L07|R05|0s:07|0s:05|
|sakiko/maskon/nf01|4.333|L07|R05|0s:07|0s:05|
|sakiko/maskon/nf02|3.767|L07|R09|0s:07|0s:09|
|sakiko/maskon/nf03|3.8|L01|R09|0s:01|0s:09|
|sakiko/maskon/nf04|4.233|L01|R09|0s:01|0s:09|
|sakiko/maskon/nf05|4.033|L01|R05|0s:01|0s:05|
|sakiko/maskon/nnf_left01|4.133|L07|R01|0s:07|0s:01|
|sakiko/maskon/nnf_right01|3.767|L07|R05|0s:07|0s:05|
|sakiko/maskon/nnf01|4.333|L07|R05|0s:07|0s:05|
|sakiko/maskon/nnf02|3.767|L07|R09|0s:07|0s:09|
|sakiko/maskon/nnf03|3.8|L01|R09|0s:01|0s:09|
|sakiko/maskon/nnf04|4.233|L01|R09|0s:01|0s:09|
|sakiko/maskon/nnf05|4.033|L01|R05|0s:01|0s:05|
|sakiko/maskon/nod01|3.933|L01|R09|0s:01|0s:09|
|sakiko/maskon/odoodo01|3.8|L07|R09|0s:07|0s:09|
|sakiko/maskon/sad01|3.633|L07|R05|0s:07|0s:05|
|sakiko/maskon/sad02|3.967|L01|R09|0s:01|0s:09|
|sakiko/maskon/serious01|3.967|L05|R01|0s:05|0s:01|
|sakiko/maskon/serious02|4.533|L07|R05|0s:07|0s:05|
|sakiko/maskon/shame01|4.067|L05|R05|0s:05|0s:05|
|sakiko/maskon/shame02|4.467|L07|R05|0s:07|0s:05|
|sakiko/maskon/sigh01|4.6|L05|R09|0s:05|0s:09|
|sakiko/maskon/sigh02|4.7|L07|R09|0s:07|0s:09|
|sakiko/maskon/smile01|4.433|L01|R09|0s:01|0s:09|
|sakiko/maskon/smile02|4.333|L03|R01|0s:03|0s:01|
|sakiko/maskon/smile03|3.967|L01, L07|R01, R05|0s:01 → 0.333s:07|0s:01 → 0.333s:05|
|sakiko/maskon/smile04|4.333|L05|R05|0s:05|0s:05|
|sakiko/maskon/smile05|4.567|L07|R03|0s:07|0s:03|
|sakiko/maskon/smile06|4.467|L07|R05|0s:07|0s:05|
|sakiko/maskon/smile07|3.8|L06|R05|0s:06|0s:05|
|sakiko/maskon/surprised01|3.633|L05|R03|0s:05|0s:03|
|sakiko/maskon/surprised02|3.7|L05|R05|0s:05|0s:05|
|sakiko/maskon/thinking01|4.3|L07|R09|0s:07|0s:09|
|sakiko/maskon/thinking02|3.967|L05|R09|0s:05|0s:09|
|sakiko/nf_left01|4.133|L07|R01|0s:07|0s:01|
|sakiko/nf_right01|3.767|L07|R05|0s:07|0s:05|
|sakiko/nf01|4.333|L07|R05|0s:07|0s:05|
|sakiko/nf02|3.767|L07|R09|0s:07|0s:09|
|sakiko/nf03|3.8|L01|R09|0s:01|0s:09|
|sakiko/nf04|4.233|L01|R09|0s:01|0s:09|
|sakiko/nf05|4.033|L01|R05|0s:01|0s:05|
|sakiko/nnf_left01|4.133|L07|R01|0s:07|0s:01|
|sakiko/nnf_right01|3.767|L07|R05|0s:07|0s:05|
|sakiko/nnf01|4.333|L07|R05|0s:07|0s:05|
|sakiko/nnf02|3.767|L07|R09|0s:07|0s:09|
|sakiko/nnf03|3.8|L01|R09|0s:01|0s:09|
|sakiko/nnf04|4.233|L01|R09|0s:01|0s:09|
|sakiko/nnf05|4.033|L01|R05|0s:01|0s:05|
|sakiko/nod01|3.933|L01|R09|0s:01|0s:09|
|sakiko/odoodo01|3.8|L07|R09|0s:07|0s:09|
|sakiko/sad01|3.633|L07|R05|0s:07|0s:05|
|sakiko/sad02|3.967|L01|R09|0s:01|0s:09|
|sakiko/serious01|3.967|L05|R01|0s:05|0s:01|
|sakiko/serious02|4.533|L07|R05|0s:07|0s:05|
|sakiko/shame01|4.067|L05|R05|0s:05|0s:05|
|sakiko/shame02|4.467|L07|R05|0s:07|0s:05|
|sakiko/sigh01|4.6|L05|R09|0s:05|0s:09|
|sakiko/sigh02|4.7|L07|R09|0s:07|0s:09|
|sakiko/smile01|4.433|L01|R09|0s:01|0s:09|
|sakiko/smile02|4.333|L03|R01|0s:03|0s:01|
|sakiko/smile03|3.967|L01, L07|R01, R05|0s:01 → 0.333s:07|0s:01 → 0.333s:05|
|sakiko/smile04|4.333|L05|R05|0s:05|0s:05|
|sakiko/smile05|4.567|L07|R03|0s:07|0s:03|
|sakiko/smile06|4.467|L07|R05|0s:07|0s:05|
|sakiko/smile07|3.8|L06|R05|0s:06|0s:05|
|sakiko/surprised01|3.633|L05|R03|0s:05|0s:03|
|sakiko/surprised02|3.7|L05|R05|0s:05|0s:05|
|sakiko/thinking01|4.3|L07|R09|0s:07|0s:09|
|sakiko/thinking02|3.967|L05|R09|0s:05|0s:09|
|soyo/ando01|5.967|L01|R05, R09|0s:01|0s:09 → 1.733s:05|
|soyo/angry01|6.967|L05|R09|0s:05|0s:09|
|soyo/angry02|6.467|L01|R05|0s:01|0s:05|
|soyo/angry03|6.967|L01, L05|R01, R05|0s:05 → 1.067s:01|0s:05 → 1.067s:01|
|soyo/angry04|6.467|L01|R05|0s:01|0s:05|
|soyo/angry05|6.467|L07|R09|0s:07|0s:09|
|soyo/angry06|6.467|L05|R05|0s:05|0s:05|
|soyo/bye01|5.467|L01|R04|0s:01|0s:04|
|soyo/bye02|6.467|L01|R05|0s:01|0s:05|
|soyo/cry01|5.967|L07|R05, R09|0s:07|0s:09 → 1.2s:05|
|soyo/cry02|6.467|L05|R05|0s:05|0s:05|
|soyo/gacha_b2024_01|5.467|L01|R05|0s:01|0s:05|
|soyo/gacha_c_a_01|7.967|L07|R05|0s:07|0s:05|
|soyo/gacha_df3_01|5.967|L01|R05|0s:01|0s:05|
|soyo/gacha_e235_01|5.467|L01|R05|0s:01|0s:05|
|soyo/gacha_e250_01|5.467|L01|R05|0s:01|0s:05|
|soyo/gacha_e289_01|7.967|L01, L07|R09|0s:07 → 2.333s:01|0s:09|
|soyo/gacha_e297_01|9|L06, L07|R05, R06|0s:07 → 4.9s:06|0s:06 → 2.333s:05 → 4.8s:06|
|soyo/idle01|6.933|L01|R05|0s:01|0s:05|
|soyo/kandou01|12.467|L05|R05, R09|0s:05|0s:09 → 3.967s:05|
|soyo/kime01|6.467|L06|R06|0s:06|0s:06|
|soyo/nf_left01|4.967|L01|R05|0s:01|0s:05|
|soyo/nf_right01|4.967|L07|R09|0s:07|0s:09|
|soyo/nf01|6.967|L07|R09|0s:07|0s:09|
|soyo/nf02|5.467|L05|R05|0s:05|0s:05|
|soyo/nf03|6.467|L07|R09|0s:07|0s:09|
|soyo/nf04|5.967|L07|R09|0s:07|0s:09|
|soyo/nf05|5.967|L01|R05|0s:01|0s:05|
|soyo/nnf_left01|4.967|L01|R05|0s:01|0s:05|
|soyo/nnf_right01|4.967|L07|R09|0s:07|0s:09|
|soyo/nnf01|6.967|L07|R09|0s:07|0s:09|
|soyo/nnf02|5.467|L05|R05|0s:05|0s:05|
|soyo/nnf03|6.467|L07|R09|0s:07|0s:09|
|soyo/nnf04|5.967|L07|R09|0s:07|0s:09|
|soyo/nnf05|5.967|L01|R05|0s:01|0s:05|
|soyo/odoodo01|5.967|L07|R05|0s:07|0s:05|
|soyo/sad01|5.967|L07|R05|0s:07|0s:05|
|soyo/sad02|6.467|L07|R05, R09|0s:07|0s:09 → 1.4s:05|
|soyo/sad03|5.467|L05|R05|0s:05|0s:05|
|soyo/scared01|4.967|L07|R05|0s:07|0s:05|
|soyo/serious01|5.967|L01|R05|0s:01|0s:05|
|soyo/serious02|5.967|L07|R05|0s:07|0s:05|
|soyo/serious03|5.967|L07|R05|0s:07|0s:05|
|soyo/serious04|5.967|L07|R05|0s:07|0s:05|
|soyo/shame01|6.467|L01|R01|0s:01|0s:01|
|soyo/shame02|6.967|L07|R09|0s:07|0s:09|
|soyo/smile01|7.967|L01, L07|R09|0s:07 → 2.333s:01|0s:09|
|soyo/smile01_ingameV2|5.467|L01|R05|0s:01|0s:05|
|soyo/smile02|6.967|L05, L06|R05, R06|0s:05 → 1.6s:06|0s:05 → 1.6s:06|
|soyo/smile03|5.467|L01|R09|0s:01|0s:09|
|soyo/smile04|6.967|L06, L07|R05, R06|0s:07 → 1.867s:06|0s:05 → 1.867s:06|
|soyo/smile05|5.467|L07|R05|0s:07|0s:05|
|soyo/smile06|5.467|L01|R05|0s:01|0s:05|
|soyo/surprised01|4.967|L07|R05|0s:07|0s:05|
|soyo/thinking01|6.467|L07|R05|0s:07|0s:05|
|soyo/thinking02_01|7.967|L07|R05|0s:07|0s:05|
|soyo/thinking02_02|9|L06, L07|R05, R06|0s:07 → 4.9s:06|0s:06 → 2.333s:05 → 4.8s:06|
|soyo/thinking02_ingameV2|7.467|L07|R05, R09|0s:07|0s:05 → 1.367s:09|
|soyo/wink01|5.467|L06|R06|0s:06|0s:06|
|taki/ando01|5.633|L01|R05|0s:01|0s:05|
|taki/angry01|4.667|L07|R01|0s:07|0s:01|
|taki/angry02|6.067|L07|R09|0s:07|0s:09|
|taki/angry03|5.967|L01, L05|R05|0s:01 → 0.767s:01+05 → 0.8s:05|0s:05|
|taki/angry04|5.633|L05|R05|0s:05|0s:05|
|taki/bye01|5.3|L07|R04|0s:07|0s:04|
|taki/bye02|6.467|L01|R01|0s:01|0s:01|
|taki/cry01|4.467|L07|R09|0s:07|0s:09|
|taki/cry02|6.967|L05, L07|R01|0s:07 → 1.133s:05|0s:01|
|taki/gacha_b2024_01|4.233|L01|R02|0s:01|0s:02|
|taki/gacha_c_a_01|9.567|L01, L02|R02, R05|0s:01 → 4.8s:02|0s:05 → 4.867s:02|
|taki/gacha_df3_01|3.8|L01|R01|0s:01|0s:01|
|taki/gacha_e240_01|5.467|L01|R02|0s:01|0s:02|
|taki/gacha_e277_01|3.8|L01|R01|0s:01|0s:01|
|taki/gacha_e297_01|9.5|L01, L02, L05|R01, R05, R09|0s:01 → 0.4s:— → 0.433s:05 → 4.8s:— → 4.833s:02|0s:01 → 0.4s:— → 0.433s:09 → 4.367s:05 → 4.567s:01|
|taki/idle01|8.7|L07|R09|0s:07|0s:09|
|taki/kandou01|8.3|L01|R05, R09|0s:01|0s:09 → 1.367s:05|
|taki/kime01|5.467|L01|R02|0s:01|0s:02|
|taki/nf_left01|5.967|L07|R01|0s:07|0s:01|
|taki/nf_right01|4.3|L07|R09|0s:07|0s:09|
|taki/nf01|4.467|L01|R01|0s:01|0s:01|
|taki/nf02|9.567|L01, L02|R02, R05|0s:01 → 4.8s:02|0s:05 → 4.867s:02|
|taki/nf02_ingameV2|3.967|L01|R09|0s:01|0s:09|
|taki/nf03|4.633|L07|R09|0s:07|0s:09|
|taki/nf04|9.5|L01, L02, L05|R01, R05, R09|0s:01 → 0.4s:— → 0.433s:05 → 4.8s:— → 4.833s:02|0s:01 → 0.4s:— → 0.433s:09 → 4.367s:05 → 4.567s:01|
|taki/nf04_ingameV2|4.967|L02|R01|0s:02|0s:01|
|taki/nf05|4.967|L07|R09|0s:07|0s:09|
|taki/pui01|3.633|L07|R09|0s:07|0s:09|
|taki/sad01|4.3|L01|R01|0s:01|0s:01|
|taki/sad02|5.3|L01|R01|0s:01|0s:01|
|taki/sad03|6.8|L01|R01, R05, R09|0s:01|0s:01 → 0.667s:05 → 2.667s:09|
|taki/serious01|5.1|L01, L05|R05, R09|0s:01 → 1.133s:— → 1.167s:05|0s:09 → 1.067s:05|
|taki/serious02|6.5|L05, L07|R01|0s:07 → 0.9s:— → 0.933s:05|0s:01|
|taki/shame01|4.133|L01|R01|0s:01|0s:01|
|taki/shame02|6.133|L01|R09|0s:01|0s:09|
|taki/sigh01|4.3|L02|R02|0s:02|0s:02|
|taki/sigh02|5.967|L07|R01|0s:07|0s:01|
|taki/smile01|3.8|L01|R01|0s:01|0s:01|
|taki/smile02|4.233|L01|R02|0s:01|0s:02|
|taki/smile03|4.967|L02|R01|0s:02|0s:01|
|taki/smile04|4.467|L07|R09|0s:07|0s:09|
|taki/surprised01|3.1|L01|R01|0s:01|0s:01|
|taki/surprised02|3.1|L01|R05|0s:01|0s:05|
|taki/thinking01|3.867|L05|R09|0s:05|0s:09|
|tomori/angry01|4.467|L01|R01|0s:01|0s:01|
|tomori/angry02|5.967|L01|R01|0s:01|0s:01|
|tomori/bye01|3.967|L01|R03, R04|0s:01|0s:04|
|tomori/c_d3/angry01|4.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/angry02|5.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/bye01|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/cry01|3.867|L01|R01|0s:01|0s:01|
|tomori/c_d3/cry02|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/gacha01|6.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/idle01|5.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/kandou01|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/kandou02|8.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/kandou03|7.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/kime01|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/kime02|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf_left01|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf_right01|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf01|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf02|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf03|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf04|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nf05|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf_left01|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf_right01|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf01|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf02|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf03|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf04|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/nnf05|3.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/sad01|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/sad02|4.467|L01, L05|R01, R05|0s:01 → 1.1s:— → 1.233s:05|0s:01 → 1.1s:— → 1.233s:05|
|tomori/c_d3/sad03|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/sad04|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/serious01|4.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/serious02|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/shame01|6.467|L05|R05|0s:05|0s:05|
|tomori/c_d3/shame02|4.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/sing01|4.633|L05|R05|0s:05|0s:05|
|tomori/c_d3/sing02|4.633|L05|R05|0s:05|0s:05|
|tomori/c_d3/smile01|6.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/smile02|4.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/smile03|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/smile04|5.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/surprised01|4.467|L01|R01|0s:01|0s:01|
|tomori/c_d3/thinking01|5.967|L01|R01|0s:01|0s:01|
|tomori/c_d3/thinking02|5.967|L01|R01|0s:01|0s:01|
|tomori/cry01|3.867|L01|R04, R05|0s:01|0s:05|
|tomori/cry02|4.967|L05, L07|R05|0s:07 → 1.9s:05|0s:05|
|tomori/cry03|7.967|L05|R05|0s:05|0s:05|
|tomori/cry04|3.867|L01|R04, R05|0s:01|0s:05|
|tomori/cry05|4.967|L05, L07|R05|0s:07 → 1.767s:05|0s:05|
|tomori/gacha_b2024_01|4.467|L07|R05|0s:07|0s:05|
|tomori/gacha_c_a_01|4.967|L01|R05|0s:01|0s:05|
|tomori/gacha_df3_01|5.467|L07|R01|0s:07|0s:01|
|tomori/gacha_e235_01|3.967|L01|R05|0s:01|0s:05|
|tomori/gacha_e250_01|6.467|L01|R05|0s:01|0s:05|
|tomori/gacha_e286_01|11.967|L01, L03, L05|R05|0s:01 → 6.167s:05 → 6.367s:03|0s:05|
|tomori/gacha_e289_01|8.967|L05|R05|0s:— → 5.233s:05|0s:— → 5.233s:05|
|tomori/gacha_e297_01|6.967|L03|R01|0s:03|0s:01|
|tomori/idle01|5.967|L01|R05|0s:01|0s:05|
|tomori/kandou01|5.467|L05|R05|0s:05|0s:05|
|tomori/kandou02|8.967|L05|R05|0s:05|0s:05|
|tomori/kandou03|7.967|L05|R05|0s:05|0s:05|
|tomori/kime01|4.967|L01|R05|0s:01|0s:05|
|tomori/kime02|3.967|L01|R05|0s:01|0s:05|
|tomori/nf_left01|3.967|L01|R01|0s:01|0s:01|
|tomori/nf_right01|3.967|L05|R01|0s:05|0s:01|
|tomori/nf01|4.967|L01|R05|0s:01|0s:05|
|tomori/nf02|4.967|L01|R05|0s:01|0s:05|
|tomori/nf02_ingameV2|4.967|L01|R01|0s:01|0s:01|
|tomori/nf03|11.967|L01, L03, L05|R05|0s:01 → 6.167s:05 → 6.367s:03|0s:05|
|tomori/nf03_ingameV2|5.467|L07|R01|0s:07|0s:01|
|tomori/nf04|3.967|L01|R05|0s:01|0s:05|
|tomori/nf05|3.967|L01|R05|0s:01|0s:05|
|tomori/nnf_left01|3.967|L01|R01|0s:01|0s:01|
|tomori/nnf_right01|3.967|L05|R01|0s:05|0s:01|
|tomori/nnf01|4.967|L01|R05|0s:01|0s:05|
|tomori/nnf02|4.967|L01|R01|0s:01|0s:01|
|tomori/nnf03|5.467|L07|R01|0s:07|0s:01|
|tomori/nnf04|3.967|L01|R05|0s:01|0s:05|
|tomori/nnf05|3.967|L01|R05|0s:01|0s:05|
|tomori/sad01|4.967|L01|R05, R09|0s:01|0s:09 → 1.267s:05|
|tomori/sad02|4.467|L01, L05|R01, R05|0s:01 → 1.067s:05|0s:01 → 1.067s:05|
|tomori/sad03|4.967|L05|R05|0s:05|0s:05|
|tomori/sad04|5.467|L05|R05|0s:05|0s:05|
|tomori/serious01|4.467|L01|R05|0s:01|0s:05|
|tomori/serious02|5.467|L05, L07|R05|0s:07 → 2.7s:05|0s:05|
|tomori/shame01|6.467|L07|R05|0s:07|0s:05|
|tomori/shame02|4.967|L01|R09|0s:01|0s:09|
|tomori/sing01|4.633|L05|R05|0s:05|0s:05|
|tomori/sing02|4.633|L05|R05|0s:05|0s:05|
|tomori/smile01|6.467|L01|R05|0s:01|0s:05|
|tomori/smile01_e289|8.967|L05|R05|0s:— → 5.233s:05|0s:— → 5.233s:05|
|tomori/smile01_e297|6.967|L03|R01|0s:03|0s:01|
|tomori/smile02|4.467|L07|R05|0s:07|0s:05|
|tomori/smile03|5.467|L05|R05|0s:05|0s:05|
|tomori/smile04|5.467|L05|R05|0s:05|0s:05|
|tomori/surprised01|4.467|L05|R05|0s:05|0s:05|
|tomori/thinking01|5.967|L05|R05|0s:05|0s:05|
|tomori/thinking02|5.967|L01|R09|0s:01|0s:09|
|uika/angry01|4.733|L07|R09|0s:07|0s:09|
|uika/bow|3.967|L03|R01|0s:03|0s:01|
|uika/cry01|4.1|L07|R01|0s:07|0s:01|
|uika/idle01|5.967|L01|R01|0s:01|0s:01|
|uika/kime01|3.7|L01|R02|0s:01|0s:02|
|uika/maskoff|4.733|L07|R01|0s:07|0s:01|
|uika/maskon/angry01|4.733|L07|R09|0s:07|0s:09|
|uika/maskon/bow|3.967|L03|R01|0s:03|0s:01|
|uika/maskon/cry01|4.1|L07|R01|0s:07|0s:01|
|uika/maskon/idle01|5.967|L01|R01|0s:01|0s:01|
|uika/maskon/kime01|3.7|L01|R02|0s:01|0s:02|
|uika/maskon/mitore01|3.833|L07|R09|0s:07|0s:09|
|uika/maskon/nf_left01|4.467|L01|R01|0s:01|0s:01|
|uika/maskon/nf_right01|3.933|L01|R02|0s:01|0s:02|
|uika/maskon/nf01|4.833|L01|R01|0s:01|0s:01|
|uika/maskon/nf02|3.3|L01|R01|0s:01|0s:01|
|uika/maskon/nf03|3.967|L01|R02|0s:01|0s:02|
|uika/maskon/nf04|3.933|L01|R02|0s:01|0s:02|
|uika/maskon/nf05|3.633|L07|R09|0s:07|0s:09|
|uika/maskon/nnf_left01|4.467|L01|R01|0s:01|0s:01|
|uika/maskon/nnf_right01|3.933|L01|R02|0s:01|0s:02|
|uika/maskon/nnf01|4.833|L01|R01|0s:01|0s:01|
|uika/maskon/nnf02|3.3|L01|R01|0s:01|0s:01|
|uika/maskon/nnf03|3.967|L01|R02|0s:01|0s:02|
|uika/maskon/nnf04|3.933|L01|R02|0s:01|0s:02|
|uika/maskon/nnf05|3.633|L07|R09|0s:07|0s:09|
|uika/maskon/sad01|3.733|L01|R01|0s:01|0s:01|
|uika/maskon/serious01|3.5|L07|R09|0s:07|0s:09|
|uika/maskon/shame01|3.933|L01|R01|0s:01|0s:01|
|uika/maskon/smile01|3.8|L07|R09|0s:07|0s:09|
|uika/maskon/smile02|3.633|L07|R09|0s:07|0s:09|
|uika/maskon/smile03|3.8|L01|R02|0s:01|0s:02|
|uika/maskon/surprised01|3.9|L01|R01|0s:01|0s:01|
|uika/mitore01|3.833|L07|R09|0s:07|0s:09|
|uika/nf_left01|4.467|L01|R01|0s:01|0s:01|
|uika/nf_right01|3.933|L01|R02|0s:01|0s:02|
|uika/nf01|4.833|L01|R01|0s:01|0s:01|
|uika/nf02|3.3|L01|R01|0s:01|0s:01|
|uika/nf03|3.967|L01|R02|0s:01|0s:02|
|uika/nf04|3.933|L01|R02|0s:01|0s:02|
|uika/nf05|3.633|L07|R09|0s:07|0s:09|
|uika/nnf_left01|4.467|L01|R01|0s:01|0s:01|
|uika/nnf_right01|3.933|L01|R02|0s:01|0s:02|
|uika/nnf01|4.833|L01|R01|0s:01|0s:01|
|uika/nnf02|3.3|L01|R01|0s:01|0s:01|
|uika/nnf03|3.967|L01|R02|0s:01|0s:02|
|uika/nnf04|3.933|L01|R02|0s:01|0s:02|
|uika/nnf05|3.633|L07|R09|0s:07|0s:09|
|uika/sad01|3.733|L01|R01|0s:01|0s:01|
|uika/serious01|3.5|L07|R09|0s:07|0s:09|
|uika/shame01|3.933|L01|R01|0s:01|0s:01|
|uika/smile01|3.8|L07|R09|0s:07|0s:09|
|uika/smile02|3.633|L07|R09|0s:07|0s:09|
|uika/smile03|3.8|L01|R02|0s:01|0s:02|
|uika/surprised01|3.9|L01|R01|0s:01|0s:01|
|umiri/angry01|4.067|L07|R09|0s:07|0s:09|
|umiri/angry02|4.067|L07|R09|0s:07|0s:09|
|umiri/bow|3.467|L01|R01|0s:01|0s:01|
|umiri/bye01|3.567|L07|R09|0s:07|0s:09|
|umiri/idle01|4.967|L07|R09|0s:07|0s:09|
|umiri/kime01|3.533|L01|R02|0s:01|0s:02|
|umiri/maskon/angry01|4.067|L07|R09|0s:07|0s:09|
|umiri/maskon/angry02|4.067|L07|R09|0s:07|0s:09|
|umiri/maskon/bow|3.467|L01|R01|0s:01|0s:01|
|umiri/maskon/bye01|3.567|L07|R09|0s:07|0s:09|
|umiri/maskon/idle01|4.967|L07|R09|0s:07|0s:09|
|umiri/maskon/kime01|3.533|L01|R02|0s:01|0s:02|
|umiri/maskon/nf_left01|4.367|L07|R09|0s:07|0s:09|
|umiri/maskon/nf_right01|3.667|L01|R02|0s:01|0s:02|
|umiri/maskon/nf01|4.633|L07|R09|0s:07|0s:09|
|umiri/maskon/nf02|3.867|L07|R09|0s:07|0s:09|
|umiri/maskon/nf03|4.3|L01|R02|0s:01|0s:02|
|umiri/maskon/nf04|4.033|L07|R09|0s:07|0s:09|
|umiri/maskon/nf05|3.667|L01|R02|0s:01|0s:02|
|umiri/maskon/sad01|5.8|L07|R09|0s:07|0s:09|
|umiri/maskon/serious01|3.433|L07|R09|0s:07|0s:09|
|umiri/maskon/sigh01|4.167|L07|R09|0s:07|0s:09|
|umiri/maskon/smile01|3.7|L01|R02|0s:01|0s:02|
|umiri/maskon/smile02|3.9|L07|R09|0s:07|0s:09|
|umiri/maskon/smile03|3.7|L07|R09|0s:07|0s:09|
|umiri/maskon/smile04|3.9|L07|R09|0s:07|0s:09|
|umiri/maskon/smile05|3.7|L07|R05|0s:07|0s:05|
|umiri/maskon/surprised01|3.2|L01|R01|0s:01|0s:01|
|umiri/maskon/thinking01|4.133|L07|R01|0s:07|0s:01|
|umiri/nf_left01|4.367|L07|R09|0s:07|0s:09|
|umiri/nf_right01|3.667|L01|R02|0s:01|0s:02|
|umiri/nf01|4.633|L07|R09|0s:07|0s:09|
|umiri/nf02|3.867|L07|R09|0s:07|0s:09|
|umiri/nf03|4.3|L01|R02|0s:01|0s:02|
|umiri/nf04|4.033|L07|R09|0s:07|0s:09|
|umiri/nf05|3.667|L01|R02|0s:01|0s:02|
|umiri/sad01|5.8|L07|R09|0s:07|0s:09|
|umiri/serious01|3.433|L07|R09|0s:07|0s:09|
|umiri/sigh01|4.167|L07|R09|0s:07|0s:09|
|umiri/smile01|3.7|L01|R02|0s:01|0s:02|
|umiri/smile02|3.9|L07|R09|0s:07|0s:09|
|umiri/smile03|3.7|L07|R09|0s:07|0s:09|
|umiri/smile04|3.9|L07|R09|0s:07|0s:09|
|umiri/smile05|3.7|L07|R05|0s:07|0s:05|
|umiri/surprised01|3.2|L01|R01|0s:01|0s:01|
|umiri/thinking01|4.133|L07|R01|0s:07|0s:01|
