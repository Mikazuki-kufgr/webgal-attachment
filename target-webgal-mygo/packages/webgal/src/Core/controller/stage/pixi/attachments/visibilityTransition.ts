import * as popmotion from 'popmotion';

export interface AttachmentVisibilityTransitionControls {
  stop(): void;
}

export interface AttachmentVisibilityTransitionRequest {
  from: number;
  to: number;
  duration: number;
  ease?: string | null;
  onUpdate(value: number): void;
  onComplete(): void;
}

export function clampVisibilityFactor(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function attachmentVisibilityEasing(ease = ''): popmotion.Easing {
  switch (ease) {
    case 'easeIn': return popmotion.easeIn;
    case 'easeOut': return popmotion.easeOut;
    case 'circInOut': return popmotion.circInOut;
    case 'circIn': return popmotion.circIn;
    case 'circOut': return popmotion.circOut;
    case 'backInOut': return popmotion.backInOut;
    case 'backIn': return popmotion.backIn;
    case 'backOut': return popmotion.backOut;
    case 'bounceInOut': return popmotion.bounceInOut;
    case 'bounceIn': return popmotion.bounceIn;
    case 'bounceOut': return popmotion.bounceOut;
    case 'linear': return popmotion.linear;
    case 'anticipate': return popmotion.anticipate;
    case 'easeInOut':
    default:
      return popmotion.easeInOut;
  }
}

/**
 * Animates only the ephemeral show/hide factor. Authored opacity remains on
 * the stage-entity transform host and is never written from these frames.
 */
export function startAttachmentVisibilityTransition(
  request: AttachmentVisibilityTransitionRequest,
): AttachmentVisibilityTransitionControls {
  const from = clampVisibilityFactor(request.from);
  const to = clampVisibilityFactor(request.to);
  const duration = Math.max(0, request.duration);
  if (duration === 0 || from === to) {
    request.onUpdate(to);
    request.onComplete();
    return { stop() {} };
  }
  const playback = popmotion.animate({
    from,
    to,
    duration,
    ease: attachmentVisibilityEasing(request.ease ?? ''),
    onUpdate: (value) => request.onUpdate(clampVisibilityFactor(value)),
    onComplete: request.onComplete,
  });
  return { stop: () => playback.stop() };
}
