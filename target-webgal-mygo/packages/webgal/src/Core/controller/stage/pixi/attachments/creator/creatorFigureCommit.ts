/** Inventory refresh must not rebind an old adaptation between replacement and commit. */
export async function commitCreatorFigureSelection<T>(options: {
  suspend: () => () => void;
  acquire: () => Promise<T>;
  refresh: () => Promise<void>;
  current: () => boolean;
  commit: (ready: T) => void;
}): Promise<boolean> {
  const release = options.suspend();
  try {
    const ready = await options.acquire();
    if (!options.current()) return false;
    await options.refresh();
    if (!options.current()) return false;
    options.commit(ready);
    return true;
  } finally {
    release();
  }
}
