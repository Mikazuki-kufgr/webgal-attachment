import * as fs from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { atomicTextWrite } from './atomicTextWrite';

describe('atomic scene replacement', () => {
  let root: string;
  let target: string;
  beforeEach(async () => {
    await fs.mkdir(join(process.cwd(), 'tmp'), { recursive: true });
    root = await fs.mkdtemp(join(process.cwd(), 'tmp', 'atomic-save-'));
    target = join(root, '中文 空格 100%.txt');
    await fs.writeFile(target, '原稿完整');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('commits complete UTF-8 text and leaves no temp file', async () => {
    await atomicTextWrite(target, '新稿完整\n第二行');
    expect(await fs.readFile(target, 'utf8')).toBe('新稿完整\n第二行');
    expect(await fs.readdir(root)).toEqual(['中文 空格 100%.txt']);
  });

  it.each(['write', 'sync', 'rename'])(
    'preserves old bytes when %s fails, then permits retry',
    async (stage) => {
      const failure = Object.assign(new Error('injected failure'), {
        code: 'EIO',
      });
      if (stage === 'rename')
        jest.spyOn(fs, 'rename').mockRejectedValueOnce(failure);
      else {
        const open = fs.open.bind(fs);
        jest
          .spyOn(fs, 'open')
          .mockImplementationOnce(
            async (...args: Parameters<typeof fs.open>) => {
              const handle = await open(...args);
              if (stage === 'write')
                jest
                  .spyOn(handle, 'writeFile')
                  .mockImplementationOnce(async () => {
                    await handle.write(Buffer.from('半稿'));
                    throw failure;
                  });
              else jest.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
              return handle;
            },
          );
      }
      await expect(atomicTextWrite(target, '新稿')).rejects.toBe(failure);
      expect(await fs.readFile(target, 'utf8')).toBe('原稿完整');
      expect(await fs.readdir(root)).toHaveLength(1);
      jest.restoreAllMocks();
      await atomicTextWrite(target, '重试成功');
      expect(await fs.readFile(target, 'utf8')).toBe('重试成功');
    },
  );

  it('preserves a readonly destination and reports failure', async () => {
    await fs.chmod(target, 0o444);
    try {
      await expect(atomicTextWrite(target, '不应覆盖')).rejects.toBeDefined();
      expect(await fs.readFile(target, 'utf8')).toBe('原稿完整');
    } finally {
      await fs.chmod(target, 0o666);
    }
  });

  (process.platform === 'win32' ? it : it.skip)(
    'preserves a Windows file held without delete sharing',
    async () => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$stream = [IO.File]::Open($env:TERRE_LOCK_TEST_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); Write-Output 'LOCK_READY'; [Console]::ReadLine() | Out-Null; $stream.Dispose()",
        ],
        {
          env: { ...process.env, TERRE_LOCK_TEST_FILE: target },
          windowsHide: true,
        },
      );
      const closed = new Promise<void>((resolve) =>
        child.on('close', () => resolve()),
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Lock helper timeout')),
            10000,
          );
          child.stdout.on('data', (data) => {
            if (String(data).includes('LOCK_READY')) {
              clearTimeout(timeout);
              resolve();
            }
          });
          child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
        await expect(atomicTextWrite(target, '不应覆盖')).rejects.toBeDefined();
        expect(await fs.readFile(target, 'utf8')).toBe('原稿完整');
      } finally {
        child.stdin.end('\n');
        await closed;
      }
      await atomicTextWrite(target, '解除占用后保存');
      expect(await fs.readFile(target, 'utf8')).toBe('解除占用后保存');
    },
    15000,
  );
});
