import cloneDeep from 'lodash/cloneDeep';
import { describe, expect, it } from 'vitest';
import { FIGURE_POSITIONS, figureStateKeyByPosition } from './stageInterface';
import { initState } from './stageStateManager';
import { sanitizeStageStateForRestore } from './stageEntityPersistence';
import { sanitizeSerializedPerforms } from './stagePersistenceBoundary';
import { declaredAttachmentFigureSource } from '@/Core/controller/stage/pixi/attachments/attachmentStageBridge';
import { ATTACHMENT_COMMAND_ABI } from 'webgal-parser';
import { commandType } from '@/Core/controller/scene/sceneInterface';

describe('321 native positions and persisted script boundary', () => {
  it.each(FIGURE_POSITIONS)('preserves and resolves fixed/free %s position', (position) => {
    const stage = cloneDeep(initState);
    stage[figureStateKeyByPosition[position]] = 'model.json';
    stage.freeFigure = [{ key: 'custom', name: 'other.json', basePosition: position }];
    const restored = sanitizeStageStateForRestore(stage, ATTACHMENT_COMMAND_ABI);
    expect(restored.freeFigure).toEqual(stage.freeFigure);
    expect(declaredAttachmentFigureSource(restored, `fig-${position}`)).toBe('model.json');
    expect(declaredAttachmentFigureSource(restored, 'custom')).toBe('other.json');
  });
  it('never replays return or a folded continuation as a durable performer', () => {
    const row = { id: 'native', isHoldOn: true, script: { command: commandType.return, commandRaw: 'return', content: '', args: [], isLineBreakHolder: false } };
    expect(() => sanitizeSerializedPerforms([row], ATTACHMENT_COMMAND_ABI)).toThrow('STAGE_PERFORM_NOT_REPLAYABLE');
    Object.assign(row.script, { command: commandType.say, commandRaw: 'say', isLineBreakHolder: true });
    expect(() => sanitizeSerializedPerforms([row], ATTACHMENT_COMMAND_ABI)).toThrow('STAGE_PERFORM_NOT_REPLAYABLE');
  });
});
