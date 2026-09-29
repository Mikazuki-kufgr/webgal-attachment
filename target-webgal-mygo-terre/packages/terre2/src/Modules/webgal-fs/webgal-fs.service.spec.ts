import { ConsoleLogger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { join, resolve } from 'path';
import AdmZip = require('adm-zip');

jest.mock('trash', () => ({ __esModule: true, default: jest.fn() }));

import {
  TextFileWriteConflictError,
  TextFileWriteError,
  WebgalFsService,
} from './webgal-fs.service';

describe('WebgalFsService', () => {
  const testRoot = join(
    process.cwd(),
    'tmp',
    'webgal-fs-service-spec',
    `run-${Date.now()}`,
  );
  let service: WebgalFsService;

  beforeEach(async () => {
    service = new WebgalFsService(new ConsoleLogger());
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('allows regular Windows absolute paths in segment validation', () => {
    expect(
      WebgalFsService.hasInvalidPathSegments(
        'C:\\repo\\public\\games\\demo\\scene.txt',
        'win32',
      ),
    ).toBe(false);
  });

  it('rejects invalid marks in path segments', () => {
    expect(
      WebgalFsService.hasInvalidPathSegments(
        'C:\\repo\\public\\games\\bad|name.txt',
        'win32',
      ),
    ).toBe(true);
  });

  it('rejects traversal path segments', () => {
    expect(
      WebgalFsService.hasInvalidPathSegments(
        '/home/app/public/../secret.txt',
        'linux',
      ),
    ).toBe(true);
  });

  it('creates an empty file for valid path', async () => {
    const targetFilePath = join(testRoot, 'valid.txt');
    const ret = await service.createEmptyFile(targetFilePath);
    expect(ret).toBe('created');
    await expect(fs.stat(targetFilePath)).resolves.toBeDefined();
  });

  it('returns a confirmed rename result and refuses to overwrite an existing target', async () => {
    const source = join(testRoot, 'source.txt');
    const target = join(testRoot, 'target.txt');
    await fs.writeFile(source, 'SENTINEL_A');
    await fs.writeFile(target, 'SENTINEL_B');

    await expect(service.renameFile(source, ' target.txt ')).rejects.toMatchObject({ status: 409 });
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('SENTINEL_A');
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('SENTINEL_B');

    const result = await service.renameFile(source, 'renamed.txt');
    expect(result).toMatchObject({ ok: true, source, target: join(testRoot, 'renamed.txt') });
    await expect(fs.readFile(join(testRoot, 'renamed.txt'), 'utf8')).resolves.toBe('SENTINEL_A');
    await expect(fs.stat(source)).rejects.toBeDefined();
  });

  it('propagates a failed disk rename as an error without changing the source', async () => {
    const source = join(testRoot, 'failure.txt');
    await fs.writeFile(source, 'SENTINEL');
    const rename = jest.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('occupied'), { code: 'EPERM' }),
    );
    try {
      await expect(service.renameFile(source, 'renamed-failure.txt')).rejects.toMatchObject({ status: 400 });
      await expect(fs.readFile(source, 'utf8')).resolves.toBe('SENTINEL');
      await expect(fs.stat(join(testRoot, 'renamed-failure.txt'))).rejects.toBeDefined();
    } finally {
      rename.mockRestore();
    }
  });

  it('separates renamed and recreated path generations', async () => {
    const source = join(testRoot, 'reused.txt');
    const renamed = join(testRoot, 'reused-next.txt');
    const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    await fs.writeFile(source, 'old');
    await service.updateTextFile(source, 'old revision', {
      saveSessionId: 'old-session', revision: 10, contentHash: hash('old revision'),
    });
    await service.renameFile(source, 'reused-next.txt');
    await expect(service.updateTextFile(renamed, 'next revision', {
      saveSessionId: 'old-session', revision: 11, contentHash: hash('next revision'),
    })).resolves.toMatchObject({ ok: true, revision: 11 });

    await service.createEmptyFile(source);
    await expect(service.updateTextFile(source, 'stale old callback', {
      saveSessionId: 'old-session', revision: 1, contentHash: hash('stale old callback'),
    })).rejects.toBeInstanceOf(TextFileWriteConflictError);
    await expect(service.updateTextFile(source, 'new generation', {
      saveSessionId: 'new-session', revision: 1, contentHash: hash('new generation'),
    })).resolves.toMatchObject({ ok: true, revision: 1 });
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('new generation');
  });

  it('rejects text write failures instead of resolving a success-shaped string', async () => {
    const missingParent = join(testRoot, 'missing', 'scene.txt');

    await expect(
      service.updateTextFile(missingParent, 'draft'),
    ).rejects.toBeInstanceOf(TextFileWriteError);
  });

  it('rejects an older revision that arrives after a newer save and preserves the newer text', async () => {
    const targetFilePath = join(testRoot, 'revisioned.txt');
    const hash = (text: string) =>
      createHash('sha256').update(text, 'utf8').digest('hex');

    await service.updateTextFile(targetFilePath, 'B', {
      saveSessionId: 'session-a',
      revision: 2,
      contentHash: hash('B'),
    });

    await expect(
      service.updateTextFile(targetFilePath, 'A', {
        saveSessionId: 'session-a',
        revision: 1,
        contentHash: hash('A'),
      }),
    ).rejects.toBeInstanceOf(TextFileWriteConflictError);
    await expect(fs.readFile(targetFilePath, 'utf8')).resolves.toBe('B');
  });

  it('does not acknowledge a failed atomic replacement and permits the same revision to retry', async () => {
    const file = join(testRoot, 'commit-failure.txt');
    await fs.writeFile(file, 'OLD');
    const metadata = {
      saveSessionId: 'failed-commit',
      revision: 1,
      contentHash: createHash('sha256').update('NEW').digest('hex'),
    };
    const rename = jest
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('replacement denied'), { code: 'EPERM' }),
      );
    try {
      await expect(
        service.updateTextFile(file, 'NEW', metadata),
      ).rejects.toMatchObject({ code: 'SCENE_WRITE_FAILED', ioCode: 'EPERM' });
      expect(await fs.readFile(file, 'utf8')).toBe('OLD');
    } finally {
      rename.mockRestore();
    }
    await expect(
      service.updateTextFile(file, 'NEW', metadata),
    ).resolves.toMatchObject({ ok: true, idempotent: false });
    expect(await fs.readFile(file, 'utf8')).toBe('NEW');
  });

  it('treats an exact retry of an already committed revision as idempotent', async () => {
    const targetFilePath = join(testRoot, 'retry.txt');
    const contentHash = createHash('sha256')
      .update('stable', 'utf8')
      .digest('hex');
    const metadata = {
      saveSessionId: 'session-b',
      revision: 1,
      contentHash,
    };

    const first = await service.updateTextFile(
      targetFilePath,
      'stable',
      metadata,
    );
    const second = await service.updateTextFile(
      targetFilePath,
      'stable',
      metadata,
    );

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: true,
      idempotent: true,
      revision: 1,
      contentHash,
    });
    await expect(fs.readFile(targetFilePath, 'utf8')).resolves.toBe('stable');
  });

  it('rejects a claimed content hash that does not match the submitted text', async () => {
    const targetFilePath = join(testRoot, 'hash-mismatch.txt');

    await expect(
      service.updateTextFile(targetFilePath, 'actual', {
        saveSessionId: 'session-c',
        revision: 1,
        contentHash: '0'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(TextFileWriteConflictError);
    await expect(fs.stat(targetFilePath)).rejects.toBeDefined();
  });

  it('rejects historical retries after another session or an external writer changes the disk', async () => {
    const file = join(testRoot, '历史确认 中文.txt');
    const metadata = (session: string, text: string) => ({
      saveSessionId: session,
      revision: 1,
      contentHash: createHash('sha256').update(text).digest('hex'),
    });
    await service.updateTextFile(file, 'A', metadata('one', 'A'));
    await service.updateTextFile(file, 'B', metadata('two', 'B'));
    await expect(
      service.updateTextFile(file, 'A', metadata('one', 'A')),
    ).rejects.toBeInstanceOf(TextFileWriteConflictError);
    await expect(fs.readFile(file, 'utf8')).resolves.toBe('B');
    await fs.writeFile(file, 'external C');
    await expect(
      service.updateTextFile(file, 'B', metadata('two', 'B')),
    ).rejects.toBeInstanceOf(TextFileWriteConflictError);
    await expect(fs.readFile(file, 'utf8')).resolves.toBe('external C');
  });

  it('checks clean documents without writing even without session history or after deletion', async () => {
    const file = join(testRoot, 'verify-only.txt');
    await fs.writeFile(file, 'A');
    const metadata = {
      saveSessionId: 'fresh',
      revision: 1,
      contentHash: createHash('sha256').update('A').digest('hex'),
      verifyOnly: true,
    };
    const write = jest.spyOn(fs, 'writeFile');
    try {
      await expect(
        service.updateTextFile(file, 'A', metadata),
      ).resolves.toMatchObject({ verifiedCurrent: true, idempotent: true });
      await fs.unlink(file);
      await expect(
        service.updateTextFile(file, 'A', metadata),
      ).rejects.toBeInstanceOf(TextFileWriteError);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it('blocks creating files out of workspace', async () => {
    const outsidePath = join(
      resolve(process.cwd(), '..'),
      `webgal-fs-outside-${Date.now()}.txt`,
    );
    const ret = await service.createEmptyFile(outsidePath);
    expect(ret).toBe('path error or no right.');
  });

  it('compresses a directory into a zip file path', async () => {
    const sourceDir = join(testRoot, 'source');
    const zipPath = join(testRoot, 'source.zip');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(join(sourceDir, 'template.json'), '{}');

    await expect(service.compressedDirectory(sourceDir, zipPath)).resolves.toBe(
      true,
    );
    expect((await fs.stat(zipPath)).isFile()).toBe(true);
  });

  it('returns null when reading an invalid zip buffer', () => {
    expect(
      service.readFileInZipToBuffer(Buffer.from('not a zip'), 'template.json'),
    ).toBeNull();
  });

  it('detects zip entry paths that would escape the target directory', () => {
    const hasUnsafeZipEntryPath = (
      service as unknown as {
        hasUnsafeZipEntryPath: (entryPath: string) => boolean;
      }
    ).hasUnsafeZipEntryPath.bind(service);

    expect(hasUnsafeZipEntryPath('../outside.txt')).toBe(true);
    expect(hasUnsafeZipEntryPath('/outside.txt')).toBe(true);
    expect(hasUnsafeZipEntryPath('C:/outside.txt')).toBe(true);
    expect(hasUnsafeZipEntryPath('template/assets/main.css')).toBe(false);
  });

  it('does not extract normalized zip entries outside the target directory', async () => {
    const zip = new AdmZip();
    zip.addFile('../outside.txt', Buffer.from('blocked'));
    const outsidePath = join(testRoot, '..', 'outside.txt');
    const extractedPath = join(testRoot, 'out', 'outside.txt');

    try {
      await expect(
        service.decompressedDirectory(zip.toBuffer(), join(testRoot, 'out')),
      ).resolves.toBe(true);
      await expect(fs.stat(extractedPath)).resolves.toBeDefined();
      await expect(fs.stat(outsidePath)).rejects.toBeDefined();
    } finally {
      await fs.rm(outsidePath, { force: true });
    }
  });
});
