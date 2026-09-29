import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  TextFileWriteConflictError,
  TextFileWriteError,
  type TextFileWriteResult,
  WebgalFsService,
} from '../webgal-fs/webgal-fs.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

jest.mock('trash', () => ({ __esModule: true, default: jest.fn() }));

describe('AssetsController scene text writes', () => {
  it('forwards read-only verification and rejects verification without revision metadata', async () => {
    const update = jest.fn().mockResolvedValue({ ok: true });
    await createController(update).editTextFile({ ...request, verifyOnly: true });
    expect(update.mock.calls[0][2].verifyOnly).toBe(true);
    await expect(createController(update).editTextFile({ path: request.path, textFile: request.textFile, verifyOnly: true })).rejects.toBeDefined();
    expect(update).toHaveBeenCalledTimes(1);
  });
  const request = {
    path: 'games/demo/scene/start.txt',
    textFile: 'latest',
    saveSessionId: 'session-a',
    revision: 2,
    contentHash: 'a'.repeat(64),
  };

  function createController(updateTextFile: jest.Mock) {
    const webgalFs = {
      getPathFromRoot: jest.fn((path: string) => `resolved/${path}`),
      updateTextFile,
    } as unknown as WebgalFsService;
    return new AssetsController(webgalFs, {} as AssetsService);
  }

  it('returns the structured persisted revision receipt', async () => {
    const result: TextFileWriteResult = {
      ok: true,
      path: 'resolved/public/games/demo/scene/start.txt',
      saveSessionId: request.saveSessionId,
      revision: request.revision,
      contentHash: request.contentHash,
      idempotent: false,
    };
    const updateTextFile = jest.fn().mockResolvedValue(result);

    await expect(
      createController(updateTextFile).editTextFile(request),
    ).resolves.toEqual(result);
    expect(updateTextFile).toHaveBeenCalledWith(
      'resolved/public/games/demo/scene/start.txt',
      request.textFile,
      {
        saveSessionId: request.saveSessionId,
        revision: request.revision,
        contentHash: request.contentHash,
      },
    );
  });

  it('maps a stale revision to HTTP 409 with a stable code', async () => {
    const updateTextFile = jest
      .fn()
      .mockRejectedValue(
        new TextFileWriteConflictError(
          'Scene save revision is older than the committed revision',
        ),
      );

    await expect(
      createController(updateTextFile).editTextFile(request),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: {
        code: 'SCENE_WRITE_CONFLICT',
        path: request.path,
      },
    });
  });

  it('maps an I/O failure to HTTP 500 and preserves the OS error code', async () => {
    const updateTextFile = jest.fn().mockRejectedValue(
      new TextFileWriteError('Failed to persist scene text', {
        code: 'ENOSPC',
      }),
    );

    await expect(
      createController(updateTextFile).editTextFile(request),
    ).rejects.toMatchObject({
      constructor: InternalServerErrorException,
      response: {
        code: 'SCENE_WRITE_FAILED',
        ioCode: 'ENOSPC',
        path: request.path,
      },
    });
  });
});
