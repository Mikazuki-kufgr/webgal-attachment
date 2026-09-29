/** All asynchronous scene entry points share one latest-intent owner. */
export type SceneMutationSource =
  | 'initialize'
  | 'start-game'
  | 'continue-game'
  | 'load-game'
  | 'fast-save-load'
  | 'backlog'
  | 'call-scene'
  | 'change-scene'
  | 'restore-scene'
  | 'terre-sync'
  | 'terre-temp'
  | 'terre-snippet'
  | 'preview-connection-reset'
  | 'end-game'
  | 'stage-reset';

export interface SceneMutationToken {
  readonly epoch: number;
  readonly source: SceneMutationSource;
  readonly signal: AbortSignal;
}

let epoch = 0;
let activeToken: SceneMutationToken | undefined;
let activeController: AbortController | undefined;
let inheritedToken: SceneMutationToken | undefined;

export function beginSceneMutation(source: SceneMutationSource): SceneMutationToken {
  const previousController = activeController;
  const controller = new AbortController();
  const token = Object.freeze({ epoch: ++epoch, source, signal: controller.signal });
  // Publish before abort: synchronous abort callbacks can themselves request a newer scene.
  activeToken = token;
  activeController = controller;
  previousController?.abort();
  return token;
}

export function isSceneMutationCurrent(token: SceneMutationToken): boolean {
  return activeToken === token && !token.signal.aborted;
}

export function commitSceneMutation(token: SceneMutationToken, commit: () => void): boolean {
  if (!isSceneMutationCurrent(token)) return false;
  commit();
  return isSceneMutationCurrent(token);
}

export function invalidateSceneMutation(source: SceneMutationSource = 'stage-reset'): void {
  beginSceneMutation(source);
}

export function getSceneMutationEpochForDiagnostics(): number {
  return epoch;
}

export function isSceneMutationEpochCurrent(candidate: number): boolean {
  return activeToken?.epoch === candidate && !activeToken.signal.aborted;
}

/** Synchronous scope only: every continuation after await must enter its own scope. */
export function withSceneMutationContext<T>(token: SceneMutationToken, action: () => T): T | undefined {
  if (!isSceneMutationCurrent(token)) return undefined;
  const previousToken = inheritedToken;
  inheritedToken = token;
  try {
    return action();
  } finally {
    inheritedToken = previousToken;
  }
}

export function inheritSceneMutationToken(): SceneMutationToken | undefined {
  // Retain a superseded scope: falling back to begin() would resurrect its old intent.
  return inheritedToken;
}
