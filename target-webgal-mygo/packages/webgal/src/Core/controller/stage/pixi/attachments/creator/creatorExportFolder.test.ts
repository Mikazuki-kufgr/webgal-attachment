import { describe, expect, it } from 'vitest';
import { writeCreatorPackage, type CreatorDirectoryHandle } from './creatorExport';
import type { CreatorPackage } from './creatorTypes';

function destination(existing: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(existing));
  const dirs = new Set(['']);
  for (const file of files.keys()) {
    const pieces = file.split('/');
    pieces.pop();
    while (pieces.length) {
      dirs.add(pieces.join('/'));
      pieces.pop();
    }
  }
  const handle = (prefix = ''): CreatorDirectoryHandle => ({
    name: prefix,
    async getDirectoryHandle(name, options) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (!dirs.has(p) && !options?.create) throw new DOMException('', 'NotFoundError');
      dirs.add(p);
      return handle(p);
    },
    async getFileHandle(name, options) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (!files.has(p) && !options?.create) throw new DOMException('', 'NotFoundError');
      return {
        async createWritable() {
          return {
            async write(bytes: Uint8Array) {
              files.set(p, bytes);
            },
            async close() {},
          };
        },
      };
    },
  });
  return { root: handle(), files, dirs };
}
const pack = {
  files: ['hat/attachment.json', 'hat/images/front.png', 'hat/manifest.json', 'hat/README.md'].map((path, index) => ({
    path,
    bytes: new Uint8Array([index + 1]),
    sha256: String(index),
    mime: 'application/octet-stream',
  })),
} as CreatorPackage;
describe('complete folder export', () => {
  it('writes the complete hierarchy with original bytes and without changing input identity', async () => {
    const target = destination(),
      before = structuredClone(pack);
    await writeCreatorPackage(target.root, pack, false);
    expect([...target.files.keys()]).toEqual(pack.files.map((f) => f.path));
    for (const f of pack.files) expect(target.files.get(f.path)).toEqual(f.bytes);
    expect(pack).toEqual(before);
  });
  it('finds even a late file conflict before creating or changing any output', async () => {
    const target = destination({ 'hat/README.md': new Uint8Array([99]) });
    const before = [...target.files],
      dirs = [...target.dirs];
    await expect(writeCreatorPackage(target.root, pack, false)).rejects.toThrow('CREATOR_EXPORT_CONFLICT');
    expect([...target.files]).toEqual(before);
    expect([...target.dirs]).toEqual(dirs);
  });
});
