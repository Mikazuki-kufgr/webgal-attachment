export interface SceneSaveStatus {
  path: string;
  status: 'saving' | 'saved' | 'error';
  message?: string;
}

// Keep status with the document, including while its toolbar is unmounted.
const states = new Map<string, Readonly<SceneSaveStatus>>();
const listeners = new Set<() => void>();

export function getSceneSaveStatus(path: string): Readonly<SceneSaveStatus> | undefined {
  return states.get(path);
}

export function subscribeSceneSaveStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishSceneSaveStatus(state: SceneSaveStatus): void {
  states.set(state.path, Object.freeze({ ...state }));
  listeners.forEach((listener) => listener());
}
