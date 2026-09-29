import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handPreviewLines } from '../runtime/creator-hand-preview.mjs';
import { fixture, payload } from './creator-fixtures.mjs';

function assertGuidedSteps(lines, prefix) {
  let pending = null;
  let commandCount = 0;
  let completed = 0;
  for (const line of lines) {
    if (line.startsWith(`${prefix}:【`) && line.includes(' 准备】')) {
      assert.equal(pending, null, `previous step has no checkpoint: ${line}`);
      pending = line.match(/【(.+) 准备】/)[1];
      commandCount = 0;
    } else if (line.startsWith(`${prefix}:【`) && line.includes(' 检查点】')) {
      const label = line.match(/【(.+) 检查点】/)[1];
      assert.equal(label, pending, `checkpoint belongs to a different step: ${line}`);
      assert(commandCount > 0, `step has no command: ${label}`);
      assert(line.includes('是否正常？'), `checkpoint does not ask for feedback: ${label}`);
      pending = null;
      completed++;
    } else if (!line.startsWith(`${prefix}:`)) {
      assert.notEqual(pending, null, `command ran before the next preparation: ${line}`);
      commandCount++;
    }
  }
  assert.equal(pending, null, 'final step has no checkpoint');
  return completed;
}

test('hand scene separates every action from the next checkpoint, including reverse flip and hide', () => {
  const lines = handPreviewLines({
    modelResource: 'anon/school_winter-2023/model.json',
    presetId: 'v2/test-hand', profileId: 'profile-a', anchor: 'user.hand-state-contact',
    slot: 'custom-slot', motions: ['nyamu/bow', 'anon/idle01'],
  });
  assert.equal(assertGuidedSteps(lines, '手部专项'), 14);
  const reverseCheck = lines.findIndex(line => line.includes('【H04 反向翻转 检查点】'));
  const hidePrepare = lines.findIndex(line => line.includes('【H05 隐藏 准备】'));
  const hideCommand = lines.findIndex(line => line.startsWith('stageEntity:hide '));
  assert(reverseCheck > 0 && reverseCheck < hidePrepare && hidePrepare < hideCommand);
  assert(lines[reverseCheck].includes('始终可见'));
  const unsupported = handPreviewLines({
    modelResource: 'other/model.json', presetId: 'v2/test-hand', profileId: 'profile-a',
    anchor: 'user.hand-state-contact', slot: 'custom-slot', motions: [],
  });
  assert(unsupported.some(line => line.includes('【H03 跳过】')));
  assert.equal(assertGuidedSteps(unsupported, '手部专项'), 12);
});

test('ordinary generated scene gives every command group a preparation and a feedback checkpoint', () => {
  const f = fixture();
  const store = f.store();
  try {
    const result = store.saveToGame({ ...payload(), expectedRevision: null });
    const lines = fs.readFileSync(path.join(f.project, result.exampleScene), 'utf8').trim().split('\n');
    assert.equal(assertGuidedSteps(lines, '测试说明'), 20);
    assert(lines[0].includes('载入人物'));
    assert(!lines.some(line => line.startsWith('changeBg:')));
    assert.equal(fs.readFileSync(path.join(f.project, 'game/scene/start.txt'), 'utf8'), '用户原剧情不变;');
  } finally {
    store.close();
  }
});
