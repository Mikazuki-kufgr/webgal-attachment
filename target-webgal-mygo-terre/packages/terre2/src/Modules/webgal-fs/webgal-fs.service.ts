import { BadRequestException, ConflictException, ConsoleLogger, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import archiver = require('archiver');
import AdmZip = require('adm-zip');
import { basename, dirname, extname, isAbsolute, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UserDataService } from '../user-data/user-data.service';
import trash from 'trash';
import {
  assertPathSegments,
  assertFileName,
  assertNoSymlink,
  invalidPath,
} from '../../util/pathSafety';
import { atomicTextWrite } from '../../util/atomicTextWrite';

const pExecFile = promisify(execFile);

export interface IFileInfo {
  name: string;
  isDir: boolean;
  extName: string;
  path: string;
  size?: number;
  lastModified?: number;
}

export interface IUploadFileInfo {
  fileName: string;
  file: Buffer;
}

interface FileList {
  fileName: string;
  file: Buffer;
}

export interface TextFileWriteMetadata {
  saveSessionId: string;
  revision: number;
  contentHash: string;
  verifyOnly?: boolean;
}

export interface TextFileWriteResult {
  ok: true;
  path: string;
  saveSessionId?: string;
  revision?: number;
  contentHash: string;
  idempotent: boolean;
  verifiedCurrent?: boolean;
}

interface CommittedTextFileRevision {
  revision: number;
  contentHash: string;
}

interface TextFileWriteState {
  tail: Promise<void>;
  committedBySession: Map<string, CommittedTextFileRevision>;
  blockedSessions: Set<string>;
  retired: boolean;
}

export class TextFileWriteConflictError extends Error {
  readonly code = 'SCENE_WRITE_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'TextFileWriteConflictError';
  }
}

export class TextFileWriteError extends Error {
  readonly code = 'SCENE_WRITE_FAILED';
  readonly ioCode?: string;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TextFileWriteError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
    this.ioCode =
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      typeof cause.code === 'string'
        ? cause.code
        : undefined;
  }
}

// All paths passed to filesystem operations are literal, checked paths.

@Injectable()
export class WebgalFsService {
  private readonly textFileWriteStates = new Map<string, TextFileWriteState>();

  constructor(private readonly logger: ConsoleLogger) {}

  static checkFileName(name: string): boolean {
    return name.search(/[\/\\\:\*\?"\<\>\|]/) === -1;
  }

  static hasInvalidPathSegments(
    rawPath: string,
    platform: NodeJS.Platform = process.platform,
  ): boolean {
    const segments = rawPath.replace(/\\/g, '/').split('/');
    return segments.some((segment, index) => {
      if (segment === '' || segment === '.') return false;
      if (segment === '..') return true;
      if (platform === 'win32' && index === 0 && /^[a-zA-Z]:$/.test(segment)) {
        return false;
      }
      return !WebgalFsService.checkFileName(segment);
    });
  }

  private isPathInsideAllowedRoots(pathToCheck: string): boolean {
    return UserDataService.isPathInsideAllowedRoots(pathToCheck);
  }

  private normalizeFsPath(_path: string): string {
    assertPathSegments(_path);
    const target = isAbsolute(_path) ? _path : this.getPathFromRoot(_path);
    if (!this.isPathInsideAllowedRoots(target)) invalidPath();
    assertNoSymlink(target);
    return target;
  }

  private getTextFileWriteState(path: string): TextFileWriteState {
    const key = this.textFileWriteStateKey(path);
    const existing = this.textFileWriteStates.get(key);
    if (existing) return existing;
    const state = this.createTextFileWriteState();
    this.textFileWriteStates.set(key, state);
    return state;
  }

  private textFileWriteStateKey(path: string): string {
    return process.platform === 'win32' ? path.toLocaleLowerCase() : path;
  }

  private createTextFileWriteState(blockedSessions?: Iterable<string>): TextFileWriteState {
    const state: TextFileWriteState = {
      tail: Promise.resolve(),
      committedBySession: new Map(),
      blockedSessions: new Set(blockedSessions),
      retired: false,
    };
    return state;
  }

  private migrateTextFileWriteState(sourcePath: string, targetPath: string): void {
    const sourceKey = this.textFileWriteStateKey(sourcePath);
    const targetKey = this.textFileWriteStateKey(targetPath);
    if (sourceKey === targetKey) return;

    const sourceState = this.textFileWriteStates.get(sourceKey);
    if (!sourceState) return;

    const targetState = this.textFileWriteStates.get(targetKey);
    const blockedSessions = new Set([
      ...sourceState.blockedSessions,
      ...(targetState?.blockedSessions ?? []),
    ]);
    if (targetState?.retired) {
      for (const session of targetState.committedBySession.keys()) blockedSessions.add(session);
    }

    sourceState.retired = true;
    const migrated = this.createTextFileWriteState(blockedSessions);
    for (const [session, revision] of sourceState.committedBySession) {
      migrated.committedBySession.set(session, revision);
    }
    this.textFileWriteStates.set(targetKey, migrated);
  }

  private resetRecreatedTextFileWriteState(path: string): void {
    const key = this.textFileWriteStateKey(path);
    const existing = this.textFileWriteStates.get(key);
    const blockedSessions = new Set(existing?.blockedSessions ?? []);
    if (existing?.retired) {
      for (const session of existing.committedBySession.keys()) blockedSessions.add(session);
    }
    this.textFileWriteStates.set(key, this.createTextFileWriteState(blockedSessions));
  }

  private hasUnsafeZipEntryPath(entryPath: string): boolean {
    const normalizedEntryPath = entryPath.replace(/\\/g, '/');
    return (
      normalizedEntryPath.includes('\0') ||
      normalizedEntryPath.startsWith('/') ||
      /^[a-zA-Z]:($|\/)/.test(normalizedEntryPath) ||
      WebgalFsService.hasInvalidPathSegments(normalizedEntryPath)
    );
  }

  greet() {
    this.logger.log('Welcome to WebGAl Files System Service!');
  }

  /**
   * 获取目录下文件信息
   * @param dir 目录，需用 path 处理。
   */
  async getDirInfo(_dir: string): Promise<IFileInfo[]> {
    const dir = this.normalizeFsPath(_dir);
    const fileNames = await fs.readdir(dir);
    const dirInfoPromises = fileNames.map(async (name) => {
      const elementPath = this.normalizeFsPath(join(dir, name));
      const result = await fs.stat(elementPath);
      return {
        name,
        isDir: result.isDirectory(),
        extName: extname(elementPath),
        path: elementPath,
        size: result.isDirectory() ? 0 : result.size,
        lastModified: result.mtimeMs,
      };
    });
    return await Promise.all(dirInfoPromises);
  }

  /**
   * 复制（递归复制），路径需使用 path 处理。
   * @param src 源文件夹
   * @param dest 目标文件夹
   */
  async copy(src: string, dest: string): Promise<boolean> {
    try {
      src = this.normalizeFsPath(src);
      dest = this.normalizeFsPath(dest);
      this.logger.log(`复制: ${src} -> ${dest}`);
      await fs.cp(src, dest, { recursive: true });
      return true;
    } catch (error) {
      this.logger.error(`复制失败: ${src} -> ${dest}, ${String(error)}`);
      return false;
    }
  }

  /**
   * 将字符串路径解析，根目录是进程运行目录
   * @param rawPath 字符串路径
   */
  getPathFromRoot(rawPath: string) {
    return UserDataService.resolveLogicalPath(rawPath);
  }

  /**
   * 新建文件夹
   * @param src 文件夹建立目录，必须用 path 处理过。
   * @param dirName 文件夹名称
   */
  async mkdir(src, dirName) {
    if (dirName !== '') assertFileName(dirName);
    const dirPath = this.normalizeFsPath(
      join(this.normalizeFsPath(src), dirName),
    );

    return await fs
      .mkdir(dirPath)
      .then(() => {
        this.logger.log(`创建文件夹: ${dirPath}`);
      })
      .catch(() => {
        this.logger.log(`跳过文件夹创建（已存在）: ${dirPath}`);
      });
  }

  /**
   * 将字符串路径解析
   * @param rawPath 字符串路径
   */
  getPath(_rawPath: string) {
    const rawPath = _rawPath;
    if (rawPath[0] === '/') {
      return join('/', ...rawPath.split('/'));
    }
    return join(...rawPath.split('/'));
  }

  /**
   * 对文件进行重命名
   * @param path 文件原路径
   * @param newName 新文件名
   */
  async renameFile(path: string, newName: string) {
    const normalizedName = newName.trim();
    assertFileName(normalizedName);
    const oldPath = this.normalizeFsPath(path);
    const newPath = this.normalizeFsPath(join(dirname(oldPath), normalizedName));

    if (this.textFileWriteStateKey(oldPath) !== this.textFileWriteStateKey(newPath)) {
      try {
        await fs.lstat(newPath);
        throw new ConflictException('目标文件或文件夹已存在，拒绝覆盖。');
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    try {
      await fs.rename(oldPath, newPath);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'UNKNOWN';
      this.logger.warn(`重命名文件失败: ${oldPath} -> ${newPath}; ${String(error)}`);
      throw new BadRequestException({
        code: 'FILE_RENAME_FAILED',
        message: `重命名失败（${code}），磁盘未改变。`,
      });
    }

    this.migrateTextFileWriteState(oldPath, newPath);
    this.logger.log(`重命名文件: ${oldPath} -> ${newPath}`);
    return { ok: true as const, source: oldPath, target: newPath };
  }

  /**
   * 删除文件
   * @param path 文件路径
   */
  async deleteFile(path: string) {
    path = this.normalizeFsPath(path);
    return await new Promise((resolve) => {
      fs.unlink(path)
        .then(() => {
          this.logger.log(`删除文件: ${path}`);
          resolve('File Deleted');
        })
        .catch(() => {
          this.logger.warn(`删除文件失败（文件不存在）: ${path}`);
          resolve('File not exist!');
        });
    });
  }

  /**
   * 删除文件或目录
   * @param path
   */
  async deleteFileOrDirectory(_path: string): Promise<boolean> {
    try {
      const path = this.normalizeFsPath(_path);

      const stat = await fs.lstat(path);

      if (stat.isDirectory()) {
        const files = await fs.readdir(path);
        await Promise.all(
          files.map(async (file) => {
            const filePath = `${path}/${file}`;
            await this.deleteFileOrDirectory(filePath);
          }),
        );
        await fs.rmdir(path);
        this.logger.log(`删除目录: ${path}`);
      } else {
        await fs.unlink(path);
        this.logger.log(`删除文件: ${path}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`删除失败: ${_path}, ${String(error)}`);
      return false;
    }
  }

  /**
   * 重命名文件或目录
   * @param path
   * @param newName
   */
  async renameFileOrDirectory(
    _path: string,
    newName: string,
  ): Promise<boolean> {
    assertFileName(newName);
    try {
      const path = this.normalizeFsPath(_path);

      const newPath = this.normalizeFsPath(join(dirname(path), newName));

      await fs.rename(path, newPath);
      this.logger.log(`重命名: ${path} -> ${newPath}`);

      return true;
    } catch (error) {
      this.logger.error(`重命名失败: ${_path}, ${String(error)}`);
      return false;
    }
  }

  /**
   * 丢弃文件或目录(回收站)
   * @param path
   */
  async trashFileOrDirectory(_path: string): Promise<boolean> {
    try {
      const path = this.normalizeFsPath(_path);
      const stat = await fs.stat(path);

      if (stat.isDirectory()) {
        this.logger.log(`丢弃目录: ${path}`);
      } else {
        this.logger.log(`丢弃文件: ${path}`);
      }

      // 打包后 trash 库定位不到随包分发的原生二进制，改用可执行文件同级 lib 目录下的副本
      const trashBinary = {
        darwin: 'macos-trash',
        win32: 'windows-trash.exe',
      }[process.platform];
      const trashBinaryPath =
        trashBinary && join(dirname(process.execPath), 'lib', trashBinary);

      if (trashBinaryPath && (await this.exists(trashBinaryPath))) {
        try {
          await pExecFile(trashBinaryPath, [path]);
          return true;
        } catch (error) {
          // macOS 上二进制可能因执行位丢失或 Gatekeeper 隔离而无法运行, 回退到库实现
          this.logger.warn(`回收站二进制不可用, 回退: ${String(error)}`);
        }
      }

      await trash(path, { glob: false });

      return true;
    } catch (error) {
      this.logger.error(`丢弃失败: ${_path}, ${String(error)}`);
      return false;
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(_path: string): Promise<boolean> {
    const path = this.normalizeFsPath(_path);

    return await fs
      .stat(path)
      .then(() => true)
      .catch(() => false);
  }

  /**
   * 检查文件夹是否存在
   * @param path 文件夹路径
   * @returns
   */
  async existsDir(path: string): Promise<boolean> {
    const normalizedPath = this.normalizeFsPath(path);
    return await fs
      .stat(normalizedPath)
      .then((stats) => stats.isDirectory())
      .catch(() => false);
  }

  /**
   * 创建一个空文件
   * @param path 文件路径
   */
  async createEmptyFile(path: string) {
    try {
      const decodedPath = this.normalizeFsPath(path);
      if (!this.isPathInsideAllowedRoots(decodedPath)) {
        throw new Error('Path is out of allowed roots');
      }
      if (WebgalFsService.hasInvalidPathSegments(decodedPath)) {
        throw new Error('There are unexpected marks in path');
      }
      const directory = dirname(decodedPath);

      if (!(await this.existsDir(directory))) {
        await fs.mkdir(directory, { recursive: true });
        this.logger.log(`创建目录: ${directory}`);
      }

      await fs.writeFile(decodedPath, '', { flag: 'wx' });
      this.resetRecreatedTextFileWriteState(decodedPath);
      this.logger.log(`创建空文件: ${decodedPath}`);
      return 'created';
    } catch (error) {
      this.logger.error(`创建文件失败: ${String(error)}`);
      return 'path error or no right.';
    }
  }

  /**
   * 更新文本
   * @param path 要更新的文本的路径
   * @param content 文本内容
   */
  async updateTextFile(
    path: string,
    content: string,
    metadata?: TextFileWriteMetadata,
  ): Promise<TextFileWriteResult> {
    const decodedPath = this.normalizeFsPath(path);
    const contentHash = createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
    const state = this.getTextFileWriteState(decodedPath);

    const operation = state.tail
      .catch(() => undefined)
      .then(async () => {
        if (state.retired) {
          throw new TextFileWriteConflictError(
            'Scene path was renamed; reopen the current file before saving',
          );
        }
        if (metadata) {
          if (
            metadata.saveSessionId.trim() === '' ||
            !Number.isSafeInteger(metadata.revision) ||
            metadata.revision < 1 ||
            !/^[a-f0-9]{64}$/i.test(metadata.contentHash) ||
            (metadata.verifyOnly !== undefined &&
              typeof metadata.verifyOnly !== 'boolean')
          ) {
            throw new TextFileWriteConflictError(
              'Invalid scene save revision metadata',
            );
          }
          if (metadata.contentHash.toLowerCase() !== contentHash) {
            throw new TextFileWriteConflictError(
              'Scene save content hash does not match submitted text',
            );
          }

          if (state.blockedSessions.has(metadata.saveSessionId)) {
            throw new TextFileWriteConflictError(
              'Scene save belongs to an older document generation',
            );
          }

          const committed = state.committedBySession.get(
            metadata.saveSessionId,
          );
          if (committed) {
            if (metadata.revision < committed.revision) {
              throw new TextFileWriteConflictError(
                'Scene save revision is older than the committed revision',
              );
            }
            if (metadata.revision === committed.revision) {
              if (
                metadata.contentHash.toLowerCase() !== committed.contentHash
              ) {
                throw new TextFileWriteConflictError(
                  'Scene save revision was reused with different content',
                );
              }
              await this.verifyCurrentTextFile(decodedPath, contentHash);
              return {
                ok: true as const,
                path: decodedPath,
                saveSessionId: metadata.saveSessionId,
                revision: metadata.revision,
                contentHash,
                idempotent: true,
                verifiedCurrent: true,
              };
            }
          }
          if (metadata.verifyOnly) {
            await this.verifyCurrentTextFile(decodedPath, contentHash);
            return {
              ok: true as const,
              path: decodedPath,
              saveSessionId: metadata.saveSessionId,
              revision: metadata.revision,
              contentHash,
              idempotent: true,
              verifiedCurrent: true,
            };
          }
        }

        try {
          await atomicTextWrite(decodedPath, content);
        } catch (error) {
          this.logger.error(`更新文件失败: ${decodedPath}; ${String(error)}`);
          throw new TextFileWriteError(
            '剧情保存失败，未提交新稿；请保留编辑区草稿，检查文件占用和写入权限后重试。',
            error,
          );
        }

        if (metadata) {
          state.committedBySession.set(metadata.saveSessionId, {
            revision: metadata.revision,
            contentHash,
          });
        }
        this.logger.log(`更新文件: ${decodedPath}`);
        return {
          ok: true as const,
          path: decodedPath,
          ...(metadata
            ? {
                saveSessionId: metadata.saveSessionId,
                revision: metadata.revision,
              }
            : {}),
          contentHash,
          idempotent: false,
        };
      });

    state.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
  private async verifyCurrentTextFile(
    path: string,
    expectedHash: string,
  ): Promise<void> {
    let current: Buffer;
    try {
      current = await fs.readFile(path);
    } catch (error) {
      throw new TextFileWriteError(
        '无法核对磁盘中的剧情，已停止保存与执行；请检查文件是否存在及读取权限。',
        error,
      );
    }
    if (createHash('sha256').update(current).digest('hex') !== expectedHash) {
      throw new TextFileWriteConflictError(
        '剧情已被其他窗口或外部程序修改，已停止保存与执行，未覆盖磁盘。请先复制保留编辑区草稿，再刷新页面载入磁盘版本并核对。',
      );
    }
  }
  /**
   * 替换文本文件中的文本
   * @param path 文件路径
   * @param text 要替换的文本
   * @param newText 替换后的文本
   */
  async replaceTextFile(
    _path: string,
    text: RegExp | string | RegExp[] | string[],
    newText: string | string[],
  ) {
    try {
      const path = this.normalizeFsPath(_path);

      const textFile: string | unknown = await this.readTextFile(path);

      if (typeof textFile === 'string') {
        let newTextFile: string = textFile;
        if (typeof text === 'string' && typeof newText === 'string') {
          newTextFile = newTextFile.replace(new RegExp(text, 'g'), newText);
        } else if (text instanceof RegExp && typeof newText === 'string') {
          newTextFile = newTextFile.replace(text, newText);
        } else if (text instanceof Array && typeof newText === 'string') {
          text.map((item) => {
            newTextFile = newTextFile.replace(new RegExp(item, 'g'), newText);
          });
        } else if (
          text instanceof Array &&
          text instanceof Array &&
          text.length === newText.length
        ) {
          text.map((item: RegExp | string, index: number) => {
            newTextFile = newTextFile.replace(
              item instanceof RegExp ? item : new RegExp(item, 'g'),
              newText[index],
            );
          });
        } else return false;

        return await new Promise((resolve) => {
          atomicTextWrite(path, newTextFile)
            .then(() => {
              this.logger.log(`替换文件内容: ${path}`);
              resolve('Replaced.');
            })
            .catch(() => {
              this.logger.error(`替换文件内容失败: ${path}`);
              resolve('Path error or no text');
            });
        });
      } else return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 读取文本文件
   * @param path 要读取的文本文件路径
   */
  async readTextFile(path: string) {
    path = this.normalizeFsPath(path);
    return await new Promise((resolve) => {
      fs.readFile(path)
        .then((r) => resolve(r.toString()))
        .catch(() => resolve('file not exist'));
    });
  }

  async writeFiles(
    _targetDirectory: string,
    fileList: FileList[],
  ): Promise<boolean> {
    try {
      const targetDirectory = _targetDirectory;
      const targetPath = this.normalizeFsPath(targetDirectory);
      if (!this.isPathInsideAllowedRoots(targetPath)) {
        throw new Error('Path is out of allowed roots');
      }
      const files = fileList.map((file) => {
        // Existing upload protocol encodes multipart names once, before path checks.
        let name = file.fileName;
        try {
          name = decodeURI(name);
        } catch {
          /* literal percent name */
        }
        assertFileName(name);
        return {
          filePath: this.normalizeFsPath(join(targetPath, name)),
          file: file.file,
        };
      });
      await fs.mkdir(targetPath, { recursive: true });
      this.logger.log(`创建目录: ${targetPath}`);
      for (const file of files) {
        const filePath = file.filePath;
        await fs.writeFile(filePath, file.file);
        this.logger.log(`写入文件: ${filePath}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`写入文件失败: ${String(error)}`);
      return false;
    }
  }

  /**
   * 复制文件并以“原文件名_编号.扩展名”方式增量保存
   */
  async copyFileWithIncrement(filePath: string): Promise<string> {
    filePath = this.normalizeFsPath(filePath);
    const dir = dirname(filePath);
    const ext = extname(filePath);
    const base = basename(filePath, ext);

    // 读取目录下所有文件
    const files = await fs.readdir(dir);
    // 匹配类似 xxx_序号.txt 的文件
    const regex = new RegExp(`^${base}_(\\d{3})${ext.replace('.', '\\.')}$`);
    let maxNum = 0;
    for (const file of files) {
      const match = file.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const nextNum = (maxNum + 1).toString().padStart(3, '0');
    const newName = `${base}_${nextNum}${ext}`;
    const newPath = join(dir, newName);

    await fs.copyFile(filePath, newPath);
    this.logger.log(`复制文件: ${filePath} -> ${newPath}`);
    return newPath;
  }

  /**
   * 压缩指定目录为指定压缩格式
   */
  async compressedDirectory(
    sourceDir: string,
    outPath: string,
    format: archiver.Format = 'zip',
  ): Promise<boolean> {
    try {
      const decodedSourceDir = this.normalizeFsPath(sourceDir);
      const decodedOutPath = this.normalizeFsPath(outPath);
      if (
        !this.isPathInsideAllowedRoots(decodedSourceDir) ||
        !this.isPathInsideAllowedRoots(decodedOutPath)
      ) {
        throw new Error('Path is out of allowed roots');
      }

      const dir = dirname(decodedOutPath);
      await fs.mkdir(dir, { recursive: true });
      const fileHandle = await fs.open(decodedOutPath, 'w');
      const output = fileHandle.createWriteStream();
      const archive = archiver.create(format, {
        zlib: { level: 9 },
      });

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };

        archive.on('error', (err) => {
          this.logger.error(`压缩目录失败: ${String(err)}`);
          finish(false);
        });
        archive.on('warning', (err) => {
          if (err.code === 'ENOENT') {
            this.logger.warn(`压缩目录警告: ${String(err)}`);
          }
        });
        output.on('error', (err) => {
          this.logger.error(`写入压缩文件失败: ${String(err)}`);
          finish(false);
        });
        output.on('close', () => {
          finish(true);
        });
        archive.pipe(output);
        archive.directory(decodedSourceDir, false);
        archive.finalize().catch((err) => {
          this.logger.error(`压缩目录失败: ${String(err)}`);
          finish(false);
        });
      });
    } catch (error) {
      this.logger.error(`压缩目录失败: ${String(error)}`);
      return false;
    }
  }

  /**
   * 解压缩指定文件到指定目录
   */
  async decompressedDirectory(
    sourceZip: string | Buffer,
    targetDir: string,
  ): Promise<boolean> {
    try {
      const decodedTargetDir = this.normalizeFsPath(targetDir);
      if (!this.isPathInsideAllowedRoots(decodedTargetDir)) {
        throw new Error('Path is out of allowed roots');
      }

      if (typeof sourceZip === 'string')
        sourceZip = this.normalizeFsPath(sourceZip);
      const zip = new AdmZip(sourceZip);
      const hasUnsafeEntry = zip
        .getEntries()
        .some((entry) => this.hasUnsafeZipEntryPath(entry.entryName));

      if (hasUnsafeEntry) {
        throw new Error('Zip contains unsafe entry path');
      }

      for (const entry of zip.getEntries()) {
        this.normalizeFsPath(join(decodedTargetDir, entry.entryName));
      }
      await fs.mkdir(decodedTargetDir, { recursive: true });

      return await new Promise<boolean>((resolve) => {
        zip.extractAllToAsync(decodedTargetDir, true, true, (err) => {
          if (err) {
            this.logger.error(`解压缩失败: ${String(err)}`);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch (error) {
      this.logger.error(`解压缩失败: ${String(error)}`);
      return false;
    }
  }

  /**
   * 读取压缩包中的文件内容
   */
  readFileInZipToBuffer(
    zipPath: string | Buffer,
    entryPath: string,
  ): Buffer | null {
    try {
      if (typeof zipPath === 'string') zipPath = this.normalizeFsPath(zipPath);
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry(entryPath);
      if (!entry) {
        return null;
      }
      const buf = zip.readFile(entry);
      return buf;
    } catch (error) {
      this.logger.error(`读取压缩包文件失败: ${String(error)}`);
      return null;
    }
  }
}
