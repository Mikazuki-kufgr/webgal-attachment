import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, payload } from './creator-fixtures.mjs';

test('game deployment generates ordered light checkpoints with independent targets and explicit reset', () => {
  const f = fixture(); const store = f.store();
  try {
    const start = fs.readFileSync(path.join(f.project, 'game/scene/start.txt'));
    const body = { ...payload(), expectedRevision: null };
    const result = store.saveToGame(body);
    const scene = fs.readFileSync(path.join(f.project, result.exampleScene), 'utf8');
    const extra = scene.slice(scene.indexOf('测试说明:【12 '));
    const transforms = extra.split('\n').filter(line => line.startsWith('setTransform:')).map(line => ({
      values: JSON.parse(line.slice(13, line.indexOf(' -duration='))),
      target: / -target=([^ ]+)/.exec(line)[1],
    }));
    assert.equal(transforms.length, 7);
    assert.equal(transforms[0].target, 'creator-current-preview');
    assert.equal(transforms[0].values.bevel, 0.85);
    assert.equal(transforms[1].values.bevelRotation, -135);
    assert.equal(transforms[1].values.bloom, 0.55);
    assert.equal(transforms[3].target, 'creator:current-attachment');
    assert.equal(transforms[3].values.bevelBlue, 140);
    assert(extra.indexOf('【16 分离后光效 准备】') < extra.indexOf('stageEntity:detach'));
    assert(extra.indexOf('stageEntity:detach') < extra.indexOf('【16 分离后光效 检查点】'));
    assert(extra.indexOf('【17 关闭与重连 准备】') < extra.indexOf('stageEntity:reattach'));
    assert(extra.indexOf('stageEntity:reattach') < extra.indexOf('【17 关闭与重连 检查点】'));
    const defaults = { bevel:0, bevelThickness:0, bevelRotation:0, bevelSoftness:0, bevelRed:255, bevelGreen:255, bevelBlue:255, bloom:0, bloomBrightness:1, bloomBlur:0, bloomThreshold:0 };
    for (const index of [2, 5, 6]) assert.deepEqual(transforms[index].values, defaults);
    assert.equal(transforms[5].target, 'creator-current-preview');
    assert.equal(transforms[6].target, 'creator:current-attachment');
    for (let n = 12; n <= 17; n++) assert(extra.includes(`【${n} `));
    assert(extra.includes('执行到此句'));
    assert.deepEqual(fs.readFileSync(path.join(f.project, 'game/scene/start.txt')), start);
    assert.equal(store.saveToGame({ ...body, expectedRevision: result.revision }).noOp, true);
  } finally { store.close(); }
});
