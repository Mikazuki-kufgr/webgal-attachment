import * as fs from 'fs/promises';
import { constants } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { assertNoSymlink } from './pathSafety';

// No unlink-old fallback: failed writes/flushes/renames leave the old file intact.
// Abrupt termination may leave a uniquely named temp file, never a partial scene.
export async function atomicTextWrite(
  target: string,
  text: string,
): Promise<void> {
  assertNoSymlink(target);
  let mode: number | undefined;
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile())
      throw Object.assign(new Error('Target is not a regular file'), {
        code: 'EINVAL',
      });
    mode = stat.mode;
    await fs.access(target, constants.W_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(target), `.terre-save-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', mode);
  let closed = false;
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    closed = true;
    assertNoSymlink(target);
    await fs.rename(temporary, target);
  } finally {
    if (!closed) await handle.close().catch(() => undefined);
    // Only our exclusive temporary file is eligible for cleanup.
    await fs.unlink(temporary).catch(() => undefined);
  }
}
