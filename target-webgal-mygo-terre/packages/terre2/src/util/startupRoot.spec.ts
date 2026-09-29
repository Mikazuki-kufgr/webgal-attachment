import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveStartupRoot } from './startupRoot';

describe('startup root before filesystem initialization', () => {
  let temp: string;
  let host: string;
  let foreign: string;
  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terre-startup-'));
    host = path.join(temp, '安装 中文 % 目录');
    foreign = path.join(temp, 'caller');
    fs.mkdirSync(path.join(host, 'public'), { recursive: true });
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(host, 'public/index.html'), 'editor');
  });
  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
  const exe = () => path.join(host, 'WebGAL_Terre.exe');
  it('uses the packaged executable directory even from another cwd', () => {
    expect(resolveStartupRoot([], foreign, exe(), true)).toBe(host);
    expect(fs.readdirSync(foreign)).toEqual([]);
  });
  it('preserves an explicit absolute or relative cwd override', () => {
    for (const value of [host, path.relative(foreign, host)]) {
      expect(resolveStartupRoot(['--cwd', value], foreign, path.join(foreign, 'other.exe'), true)).toBe(host);
    }
  });
  it('keeps source Node startup at its inherited cwd', () => {
    expect(resolveStartupRoot([], foreign, exe(), false)).toBe(foreign);
  });
  it('rejects a missing override argument', () => {
    for (const args of [['--cwd'], ['--cwd', ''], ['--cwd', '--other']]) {
      expect(() => resolveStartupRoot(args, foreign, exe(), true)).toThrow('TERRE_STARTUP_CWD_REQUIRED');
    }
  });
  it('rejects incomplete installs without falling back or writing', () => {
    expect(() => resolveStartupRoot(['--cwd', foreign], foreign, exe(), true)).toThrow('TERRE_STARTUP_ROOT_INVALID');
    expect(fs.readdirSync(foreign)).toEqual([]);
  });
});
