import { Test } from '@nestjs/testing';
import { ConsoleLogger, INestApplication } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AddressInfo } from 'net';
import * as http from 'http';
import WebSocket = require('ws');
import { AssetsController } from '../Modules/assets/assets.controller';
import { AssetsService } from '../Modules/assets/assets.service';
import { UserDataService } from '../Modules/user-data/user-data.service';
import { WebgalFsService } from '../Modules/webgal-fs/webgal-fs.service';
import { LogicalStaticController } from '../Modules/user-data/logical-static.controller';
import {
  LOCAL_LISTEN_HOST,
  LocalWsAdapter,
  localAccessMiddleware,
} from './localAccess';

jest.mock('trash', () => ({ __esModule: true, default: jest.fn() }));

describe('local HTTP and WebSocket resource boundary', () => {
  let app: INestApplication,
    root: string,
    data: string,
    port: number,
    oldState: unknown;
  let adapter: LocalWsAdapter, socketServer: WebSocket.Server;
  const request = (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: LOCAL_LISTEN_HOST,
          port,
          path: url,
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode!, text }));
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  beforeAll(async () => {
    await fs.mkdir(path.join(process.cwd(), 'tmp'), { recursive: true });
    root = await fs.mkdtemp(path.join(process.cwd(), 'tmp', 'terre-http-'));
    data = path.join(root, 'allowed');
    await fs.mkdir(path.join(data, 'games', '中文 100%', 'game', 'scene'), {
      recursive: true,
    });
    oldState = (UserDataService as any).state;
    (UserDataService as any).state = Object.fromEntries(
      [
        'appRoot',
        'activeUserDataRoot',
        'configRoot',
        'portableDataRoot',
        'defaultUserDataRoot',
        'configuredUserDataRoot',
      ].map((key) => [key, data]),
    );
    const module = await Test.createTestingModule({
      controllers: [AssetsController, LogicalStaticController],
      providers: [
        WebgalFsService,
        AssetsService,
        {
          provide: ConsoleLogger,
          useValue: { log() {}, warn() {}, error() {} },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req, res, next) => localAccessMiddleware(port)(req, res, next));
    await app.listen(0, LOCAL_LISTEN_HOST);
    port = (app.getHttpServer().address() as AddressInfo).port;
    adapter = new LocalWsAdapter(app.getHttpServer(), port);
    socketServer = adapter.create(0, { path: '/api/webgalsync' });
    socketServer.on('connection', (client) => client.send('READY'));
  });
  afterAll(async () => {
    await adapter.close(socketServer);
    await app.close();
    (UserDataService as any).state = oldState;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('binds exclusively to IPv4 loopback', () => {
    expect(app.getHttpServer().address().address).toBe(LOCAL_LISTEN_HOST);
  });
  it.each([
    'http://evil.example',
    'null',
    'http://localhost.evil.example',
    'file://',
  ])('rejects HTTP Origin %s before a write', async (origin) => {
    expect(
      (
        await request(
          'POST',
          '/api/assets/editTextFile',
          { path: 'games/blocked.txt', textFile: 'bad' },
          { Origin: origin },
        )
      ).status,
    ).toBe(403);
    await expect(
      fs.stat(path.join(data, 'games/blocked.txt')),
    ).rejects.toBeDefined();
  });
  it('rejects rebinding Host and cross-site requests without Origin', async () => {
    expect(
      (
        await request('GET', '/api/assets/readAssets/games', undefined, {
          Host: `evil.example:${port}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('GET', '/api/assets/readAssets/games', undefined, {
          'Sec-Fetch-Site': 'cross-site',
        })
      ).status,
    ).toBe(403);
  });
  it.each([
    undefined,
    'http://localhost:3000',
    'http://127.0.0.1:19339',
    'http://[::1]:3001',
  ])('allows native/dev/preview local client %s', async (origin) => {
    expect(
      (
        await request(
          'GET',
          '/api/assets/readAssets/games',
          undefined,
          origin ? { Origin: origin } : {},
        )
      ).status,
    ).toBe(200);
  });
  it('round-trips Chinese, space and literal encoded-looking names through save/list/static/rename/delete', async () => {
    const source = 'games/中文 100%/game/scene/原稿 %2e%2e.txt';
    expect(
      (
        await request('POST', '/api/assets/editTextFile', {
          path: source,
          textFile: '中文稿',
        })
      ).status,
    ).toBe(201);
    const list = await request(
      'GET',
      '/api/assets/readAssets/' +
        encodeURIComponent('games/中文 100%/game/scene'),
    );
    expect(list.status).toBe(200);
    expect(list.text).toContain('原稿 %2e%2e.txt');
    expect(
      (
        await request(
          'GET',
          '/games/' +
            encodeURIComponent('中文 100%') +
            '/game/scene/' +
            encodeURIComponent('原稿 %2e%2e.txt'),
        )
      ).text,
    ).toBe('中文稿');
    expect(
      (
        await request('POST', '/api/assets/rename', {
          source,
          newName: '改名 %25.txt',
        })
      ).status,
    ).toBe(201);
    expect(
      await fs.readFile(
        path.join(data, 'games/中文 100%/game/scene/改名 %25.txt'),
        'utf8',
      ),
    ).toBe('中文稿');
    expect(
      (
        await request('POST', '/api/assets/delete', {
          source: 'games/中文 100%/game/scene/改名 %25.txt',
        })
      ).text,
    ).toBe('true');
  });
  it.each([
    '../outside.txt',
    '%2e%2e/outside.txt',
    '%252e%252e/outside.txt',
    '%25252e%25252e/outside.txt',
    '..\\outside.txt',
  ])(
    'never writes or deletes outside the approved root with %s',
    async (attack) => {
      const sentinel = path.join(root, 'outside.txt');
      await fs.writeFile(sentinel, 'SAFE');
      for (const source of [
        'games/' + attack,
        'games/' + attack.replace('outside', '../../outside'),
      ]) {
        await request('POST', '/api/assets/editTextFile', {
          path: source,
          textFile: 'ATTACK',
        });
        await request('POST', '/api/assets/delete', { source });
        expect(await fs.readFile(sentinel, 'utf8')).toBe('SAFE');
      }
    },
  );
  it('keeps the original triple-encoded review input literal through the final I/O', async () => {
    const segment = '%25252e%25252e';
    const sentinel = path.join(data, 'review-sentinel.txt');
    await fs.writeFile(sentinel, 'SAFE');
    await fs.mkdir(path.join(data, 'games', segment));
    const source = `games/${segment}/review-sentinel.txt`;
    expect(
      (
        await request('POST', '/api/assets/editTextFile', {
          path: source,
          textFile: 'LITERAL',
        })
      ).status,
    ).toBe(201);
    expect(await fs.readFile(path.join(data, source), 'utf8')).toBe('LITERAL');
    expect(await fs.readFile(sentinel, 'utf8')).toBe('SAFE');
    expect((await request('POST', '/api/assets/delete', { source })).text).toBe(
      'true',
    );
    expect(await fs.readFile(sentinel, 'utf8')).toBe('SAFE');
  });
  it('rejects encoded upload separators and rename traversal before touching the target', async () => {
    const service = app.get(WebgalFsService);
    expect(
      await service.writeFiles(path.join(data, 'games'), [
        { fileName: '..%5coutside.txt', file: Buffer.from('BAD') },
      ]),
    ).toBe(false);
    await expect(
      service.renameFile(path.join(data, 'games/test.txt'), '..\\outside.txt'),
    ).rejects.toBeDefined();
  });
  it('rejects a junction escaping the allowed root', async () => {
    const link = path.join(data, 'games', 'linked');
    await fs.symlink(root, link, 'junction');
    try {
      expect(
        (
          await request('POST', '/api/assets/editTextFile', {
            path: 'games/linked/outside.txt',
            textFile: 'BAD',
          })
        ).status,
      ).toBe(400);
    } finally {
      await fs.unlink(link);
    }
  });
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:19339',
    'http://evil.example',
    'null',
  ])('checks WebSocket Origin %s before upgrade', async (origin) => {
    const accepted = await new Promise<boolean>((resolve) => {
      const client = new WebSocket(
        `ws://${LOCAL_LISTEN_HOST}:${port}/api/webgalsync`,
        { origin },
      );
      client.on('message', () => {
        client.close();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });
    expect(accepted).toBe(
      origin.includes('localhost') || origin.includes('127.0.0.1'),
    );
  });
});
