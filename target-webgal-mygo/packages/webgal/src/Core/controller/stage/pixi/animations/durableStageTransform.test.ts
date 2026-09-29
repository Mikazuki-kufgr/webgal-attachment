import cloneDeep from 'lodash/cloneDeep';
import { describe, expect, it } from 'vitest';

import { createCommittedStageSnapshot } from '@/Core/Modules/stage/stageEntityPersistence';
import { initState } from '@/Core/Modules/stage/stageStateManager';
import { durableStageTransform } from './durableStageTransform';

describe('durable stage transform from a Pixi animation endpoint', () => {
  it('removes animation-only duration/ease before the effect enters persisted stage state', () => {
    const endpoint = {
      position: { x: 12, y: -3 },
      scale: { x: 0.8, y: 0.9 },
      rotation: 4,
      alpha: 1,
      duration: 0,
      ease: 'linear',
    };
    const before = cloneDeep(endpoint);
    const transform = durableStageTransform(endpoint);

    expect(transform).toEqual({
      position: { x: 12, y: -3 },
      scale: { x: 0.8, y: 0.9 },
      rotation: 4,
      alpha: 1,
    });
    expect(endpoint).toEqual(before);

    const contaminatedStage = cloneDeep(initState);
    contaminatedStage.effects.push({
      target: 'creator-current-preview',
      transform: endpoint,
    });
    expect(() => createCommittedStageSnapshot(contaminatedStage)).toThrow(/transform\.duration/);

    const stage = cloneDeep(initState);
    stage.effects.push({ target: 'creator-current-preview', transform });
    expect(
      createCommittedStageSnapshot(stage).effects.find((effect) => effect.target === 'creator-current-preview'),
    ).toEqual({
      target: 'creator-current-preview',
      transform,
    });
  });
});
