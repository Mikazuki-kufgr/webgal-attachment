/** New hand-specific checks. Existing accepted generic/light checks are not replayed. */
export function handPreviewLines({modelResource,presetId,profileId,anchor,slot,motions}) {
  const figure='creator-current-preview',entity='creator:current-attachment';
  const native=motions.includes('nyamu/bow') && motions.includes('anon/idle01') && modelResource==='anon/school_winter-2023/model.json' ? 'nyamu/bow' : undefined;
  const figureCommand=`changeFigure:${modelResource} -id=${figure} -duration=0${native?' -motion='+native:''}`;
  const add=`attachment:add -figure=${figure} -id=creator-current-attachment -entity=${entity} -config=${presetId} -profile=${profileId} -anchor=${anchor} -slot=${slot} -duration=0 -next;`;
  const prepare=(label,description)=>`手部专项:【${label} 准备】${description}。点击继续后执行，请观察过程。;`;
  const check=(label,expectation)=>`手部专项:【${label} 检查点】上一项命令组已触发；如有动画，请等画面稳定后检查：${expectation}。刚才这一步是否正常？如有异常，请停在此处并记录编号与看到的现象。;`;
  return [
    prepare('H01 人物','加载人物和演示动作；此时尚不添加附件'),
    figureCommand+' -next;',
    check('H01 人物','人物已完整显示，动作与姿态正常'),
    prepare('H02 首次附着','将附件添加到当前人物；附件只支持保存的手型，其他手型会隐藏'),
    add,
    check('H02 首次附着','附件只有一份，接点、朝向和遮挡符合预期；原模型既有穿插不在此项修复范围'),
    ...(native?[
      prepare('H03 待机','切换到已有待机动作；如果该手型未配置附件，附件应隐藏'),
      `changeFigure:${modelResource} -id=${figure} -duration=0 -motion=anon/idle01 -next;`,
      check('H03 待机','人物进入待机，附件显示状态与已保存手型配置一致'),
      prepare('H03 鞠躬','切回已有鞠躬动作；观察手型交接中的朝向、镜像和淡入淡出'),
      figureCommand+' -next;',
      check('H03 鞠躬','动作稳定后附件随手型正确显示；交接过程没有多份实例或错误方向'),
    ]:[
      '手部专项:【H03 跳过】当前模型没有本剧情指定的待机与鞠躬动作组合；本段未执行动作切换，不能据此认定该模型的手型交接通过。;',
    ]),
    prepare('H04 正向翻转','将整个人物水平翻转；附件应随人物整体变化，不换绑另一只手'),
    `setTransform:{"scale":{"x":-1,"y":1}} -target=${figure} -duration=700 -next;`,
    check('H04 正向翻转','人物和附件一起翻转，附件保持可见且跟随正确'),
    prepare('H04 反向翻转','将人物翻回原朝向；附件在整个翻回过程中保持显示，下一检查点前不会隐藏'),
    `setTransform:{"scale":{"x":1,"y":1}} -target=${figure} -duration=700 -next;`,
    check('H04 反向翻转','人物和附件已翻回原朝向，附件始终可见且位置正确'),
    prepare('H05 隐藏','隐藏附件；人物应保持显示'),
    `stageEntity:hide -entity=${entity};`,
    check('H05 隐藏','附件已消失，人物仍在'),
    prepare('H05 显示','重新显示附件；应在原位置只出现一份'),
    `stageEntity:show -entity=${entity};`,
    check('H05 显示','附件恢复到原位置且只有一份；附件自身滤镜不在此项测试范围'),
    prepare('H06 分离','解除附件与人物的绑定，然后移动人物；附件应留在解除时的世界位置和方向'),
    `stageEntity:detach -entity=${entity} -continue;`,
    `setTransform:{"position":{"x":250,"y":0}} -target=${figure} -duration=700 -next;`,
    check('H06 分离','人物已移动，附件仍留在原世界位置和方向；若手型持续混合使分离失败，应显示明确诊断'),
    prepare('H07 重新绑定','将自由附件重新绑定到当前人物；观察回位过渡'),
    `stageEntity:reattach -entity=${entity} -figure=${figure} -profile=${profileId} -anchor=${anchor} -duration=700 -continue;`,
    check('H07 重新绑定','附件回到正确接点，方向正确且只有一份；未知目标应给出诊断'),
    prepare('H08 移除','从舞台彻底移除附件；人物应继续显示'),
    `stageEntity:remove -entity=${entity};`,
    check('H08 移除','附件已完全消失，人物仍在'),
    prepare('H09 清除人物','先清除人物，之后会用同一 ID 建立新人物；此步只检查清除，不应复活已移除附件'),
    `changeFigure:none -id=${figure} -duration=0 -next;`,
    check('H09 清除人物','人物已消失，旧附件也没有出现'),
    prepare('H09 人物换代','重新建立人物，先不添加附件'),
    figureCommand+' -next;',
    check('H09 人物换代','新人物完整载入，旧附件没有复活'),
    prepare('H09 新实例','重新添加同一配置的附件；新舞台实例应只有一份'),
    add,
    check('H09 新实例','附件只有一份且跟随新人物。正式独立游戏可在此处另做存读档检查；Terre 预览不能替代该验收'),
  ];
}
