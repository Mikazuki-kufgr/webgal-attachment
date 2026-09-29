import { describe, expect, it } from 'vitest';

import { summarizeCreatorFrameIntervals } from './creatorPerformanceProbe';

describe('creator performance probe', () => {
  it('summarizes frame cadence and slow-frame thresholds deterministically', () => {
    expect(summarizeCreatorFrameIntervals([16, 16, 17, 34, 51], 134)).toEqual({
      sampleCount: 5,
      elapsedMs: 134,
      averageFps: 37.31,
      averageFrameMs: 26.8,
      medianFrameMs: 17,
      p95FrameMs: 51,
      p99FrameMs: 51,
      maxFrameMs: 51,
      framesOver33Ms: 2,
      framesOver50Ms: 1,
    });
  });

  it('ignores invalid intervals and handles an empty sample', () => {
    expect(summarizeCreatorFrameIntervals([Number.NaN, -1, Number.POSITIVE_INFINITY], 0)).toEqual({
      sampleCount: 0,
      elapsedMs: 0,
      averageFps: 0,
      averageFrameMs: 0,
      medianFrameMs: 0,
      p95FrameMs: 0,
      p99FrameMs: 0,
      maxFrameMs: 0,
      framesOver33Ms: 0,
      framesOver50Ms: 0,
    });
  });
});
