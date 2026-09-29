import { BadRequestException } from '@nestjs/common';
import { lstatSync } from 'fs';
import * as path from 'path';

export function invalidPath(): never {
  throw new BadRequestException({
    code: 'UNSAFE_RESOURCE_PATH',
    message: '资源路径不安全或超出允许目录，请检查文件名和目录。',
  });
}

// HTTP route parameters are decoded by Express. JSON and filesystem paths are
// literal text. Never URI-decode an already resolved filesystem path.
export function assertPathSegments(value: string): void {
  if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) invalidPath();
  const parts = value.replace(/\\/g, '/').split('/');
  for (const [index, part] of parts.entries()) {
    if (part === '' || part === '.') continue;
    if (part === '..') invalidPath();
    if (process.platform === 'win32' && index === 0 && /^[a-z]:$/i.test(part))
      continue;
    if (/[<>:"|?*]/.test(part)) invalidPath();
    if (
      process.platform === 'win32' &&
      (/[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
    )
      invalidPath();
  }
  if (/^(?:\\\\|\/\/)/.test(value)) invalidPath();
}

export function assertFileName(value: string): void {
  if (!value || value === '.' || /[\\/]/.test(value)) invalidPath();
  assertPathSegments(value);
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative))
  );
}

export function assertNoSymlink(target: string): void {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) invalidPath();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}
