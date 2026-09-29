/** Keyframe time follows elapsed real time, including frames delayed by a busy renderer. */
export function wallClockDriver(update: (delta: number) => void) {
  let active = false;
  let frame: number | undefined;
  let previous = 0;
  const tick = () => {
    if (!active) return;
    frame = undefined;
    const now = performance.now();
    const delta = Math.max(0, now - previous);
    previous = now;
    update(delta);
    // Completion or replacement may stop the driver from inside update.
    if (active) frame = requestAnimationFrame(tick);
  };
  return {
    start: () => {
      if (active) return;
      active = true;
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    },
    stop: () => {
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}
