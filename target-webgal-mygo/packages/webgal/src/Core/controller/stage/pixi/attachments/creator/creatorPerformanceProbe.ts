export interface CreatorPerformanceStatistics {
  sampleCount: number;
  elapsedMs: number;
  averageFps: number;
  averageFrameMs: number;
  medianFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  framesOver33Ms: number;
  framesOver50Ms: number;
}

export interface CreatorTickerLike {
  deltaMS: number;
  add(callback: () => void): void;
  remove(callback: () => void): void;
}

export interface CreatorPerformanceCapture {
  startedAt: string;
  finishedAt: string;
  durationTargetMs: number;
  documentVisibility: DocumentVisibilityState;
  raf: CreatorPerformanceStatistics;
  pixiTicker: CreatorPerformanceStatistics;
}

function rounded(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(sorted: readonly number[], fraction: number) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

export function summarizeCreatorFrameIntervals(
  intervals: readonly number[],
  elapsedMs: number,
): CreatorPerformanceStatistics {
  const valid = intervals.filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...valid].sort((a, b) => a - b);
  const total = valid.reduce((sum, value) => sum + value, 0);
  return {
    sampleCount: valid.length,
    elapsedMs: rounded(elapsedMs),
    averageFps: elapsedMs > 0 ? rounded((valid.length * 1000) / elapsedMs) : 0,
    averageFrameMs: valid.length ? rounded(total / valid.length) : 0,
    medianFrameMs: rounded(percentile(sorted, 0.5)),
    p95FrameMs: rounded(percentile(sorted, 0.95)),
    p99FrameMs: rounded(percentile(sorted, 0.99)),
    maxFrameMs: rounded(sorted.at(-1) ?? 0),
    framesOver33Ms: valid.filter((value) => value > 33.4).length,
    framesOver50Ms: valid.filter((value) => value > 50).length,
  };
}

export function captureCreatorPerformance(
  durationMs: number,
  ticker: CreatorTickerLike | undefined,
  signal?: AbortSignal,
): Promise<CreatorPerformanceCapture> {
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 60_000) {
    throw new Error('CREATOR_PERFORMANCE_DURATION_INVALID');
  }
  if (signal?.aborted) return Promise.reject(new Error('CREATOR_PERFORMANCE_CANCELLED'));

  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const visibility = document.visibilityState;
    const rafIntervals: number[] = [];
    const tickerIntervals: number[] = [];
    let previousRaf: number | undefined;
    let rafId = 0;
    let timeoutId = 0;
    let settled = false;

    const onTicker = () => {
      const delta = ticker?.deltaMS;
      if (typeof delta === 'number' && Number.isFinite(delta) && delta >= 0) tickerIntervals.push(delta);
    };
    const onRaf = (timestamp: number) => {
      if (previousRaf !== undefined) rafIntervals.push(timestamp - previousRaf);
      previousRaf = timestamp;
      rafId = requestAnimationFrame(onRaf);
    };
    const cleanup = () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      ticker?.remove(onTicker);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('CREATOR_PERFORMANCE_CANCELLED'));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      const elapsedMs = performance.now() - started;
      cleanup();
      resolve({
        startedAt,
        finishedAt: new Date().toISOString(),
        durationTargetMs: durationMs,
        documentVisibility: visibility,
        raf: summarizeCreatorFrameIntervals(rafIntervals, elapsedMs),
        pixiTicker: summarizeCreatorFrameIntervals(tickerIntervals, elapsedMs),
      });
    };

    ticker?.add(onTicker);
    signal?.addEventListener('abort', onAbort, { once: true });
    rafId = requestAnimationFrame(onRaf);
    timeoutId = window.setTimeout(finish, durationMs);
  });
}
