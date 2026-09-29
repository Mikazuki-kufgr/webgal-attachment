import type { IncomingMessage } from 'http';
import type { Request, Response, NextFunction } from 'express';
import { WsAdapter } from '@nestjs/platform-ws';

export const LOCAL_LISTEN_HOST = '127.0.0.1';
const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      hosts.has(url.hostname) &&
      !url.username &&
      !url.password &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

// Local editor, Creator and development servers use different ports. Trust only
// literal loopback origins, not arbitrary domains resolving to loopback. This
// does not authenticate local processes or services hosted on other local ports.
export function allowLocalRequest(
  request: IncomingMessage,
  port: number,
): boolean {
  const host = request.headers.host;
  if (
    typeof host !== 'string' ||
    ![...hosts].some((name) => host.toLowerCase() === `${name}:${port}`)
  )
    return false;
  const origin = request.headers.origin;
  if (
    origin !== undefined &&
    (typeof origin !== 'string' || !isLocalOrigin(origin))
  )
    return false;
  // Requests without Origin remain available to native local clients. Browser
  // cross-site requests without Origin (e.g. image GETs) are rejected as well.
  if (
    origin === undefined &&
    request.headers['sec-fetch-site'] === 'cross-site'
  )
    return false;
  return true;
}

export function localAccessMiddleware(port: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!allowLocalRequest(req, port)) {
      res
        .status(403)
        .json({
          code: 'LOCAL_ACCESS_ONLY',
          message: '仅允许本机编辑器访问，请使用本机启动入口打开。',
        });
      return;
    }
    next();
  };
}

export class LocalWsAdapter extends WsAdapter {
  constructor(
    app: ConstructorParameters<typeof WsAdapter>[0],
    private readonly localPort: number,
  ) {
    super(app);
  }

  create(port: number, options: Record<string, any> = {}) {
    return super.create(port, {
      ...options,
      host: LOCAL_LISTEN_HOST,
      verifyClient: (info: { req: IncomingMessage }) =>
        allowLocalRequest(info.req, this.localPort),
    });
  }
}
