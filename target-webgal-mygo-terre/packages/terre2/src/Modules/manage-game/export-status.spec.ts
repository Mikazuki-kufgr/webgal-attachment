import { Test } from '@nestjs/testing';
import { ConsoleLogger, InternalServerErrorException } from '@nestjs/common';
import { ManageGameController } from './manage-game.controller';
import { ManageGameService } from './manage-game.service';
import { WebgalFsService } from '../webgal-fs/webgal-fs.service';

// Controller contract tests never export a real game or initialize user directories.
jest.mock('./manage-game.service', () => ({ ManageGameService: class {} }));
jest.mock('../webgal-fs/webgal-fs.service', () => ({
  WebgalFsService: class {},
}));
jest.mock('../user-data/user-data.service', () => ({
  UserDataService: class {},
}));

describe('Export response status', () => {
  const routes = [
    ['ejectGameAsWeb', 'web'],
    ['ejectGameAsExe', 'electron-windows'],
    ['ejectGameAsAndroid', 'android'],
  ] as const;

  it.each(routes)(
    '%s rejects an unsuccessful export as HTTP 500',
    async (method, target) => {
      const exportGame = jest.fn().mockResolvedValue(false);
      const log = jest.fn();
      const module = await Test.createTestingModule({
        controllers: [ManageGameController],
        providers: [
          { provide: ManageGameService, useValue: { exportGame } },
          { provide: WebgalFsService, useValue: {} },
          { provide: ConsoleLogger, useValue: { log } },
        ],
      }).compile();
      try {
        const controller = module.get(ManageGameController);
        const error = await controller[method]('中文 游戏').catch((e) => e);
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect(error.getStatus()).toBe(500);
        expect(error.getResponse()).toMatchObject({
          message: 'EXPORT_FAILED',
          statusCode: 500,
        });
        expect(exportGame).toHaveBeenCalledWith('中文 游戏', target);
        expect(log).not.toHaveBeenCalled();
      } finally {
        await module.close();
      }
    },
  );

  it.each(routes)(
    '%s preserves successful completion and propagates rejection',
    async (method, target) => {
      const exportGame = jest.fn().mockResolvedValue(true);
      const log = jest.fn();
      const controller = new ManageGameController(
        {} as WebgalFsService,
        { exportGame } as unknown as ManageGameService,
        { log } as unknown as ConsoleLogger,
      );
      await expect(controller[method]('game')).resolves.toBeUndefined();
      expect(exportGame).toHaveBeenCalledWith('game', target);
      expect(log).toHaveBeenCalledTimes(1);
      log.mockClear();
      const failure = new Error('original diagnostic');
      exportGame.mockRejectedValueOnce(failure);
      await expect(controller[method]('game')).rejects.toBe(failure);
      expect(log).not.toHaveBeenCalled();
    },
  );
});
