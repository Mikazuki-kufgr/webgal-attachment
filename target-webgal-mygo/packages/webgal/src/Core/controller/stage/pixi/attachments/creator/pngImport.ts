import type { CreatorBinaryInput, CreatorLayerMetadata } from './creatorTypes';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
export const CREATOR_PNG_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const CREATOR_PNG_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const CREATOR_PNG_MAX_DIMENSION = 8192;
export const CREATOR_PNG_MAX_PIXELS = 16 * 1024 * 1024;

export class CreatorPngError extends Error {
  public constructor(
    public readonly code:
      | 'EMPTY_FILE'
      | 'NOT_PNG'
      | 'INVALID_DIMENSIONS'
      | 'FILE_TOO_LARGE'
      | 'TOTAL_BYTES_TOO_LARGE'
      | 'DIMENSIONS_TOO_LARGE'
      | 'PIXEL_COUNT_TOO_LARGE'
      | 'DECODE_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CreatorPngError';
  }
}

export function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function sha256Bytes(bytes: Uint8Array) {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', source)));
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

export function inspectPngBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new CreatorPngError('EMPTY_FILE', 'PNG 文件为 0 bytes');
  if (
    bytes.byteLength < 24 ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  ) {
    throw new CreatorPngError('NOT_PNG', '文件扩展名或 MIME 不能替代 PNG signature 校验');
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new CreatorPngError('INVALID_DIMENSIONS', 'PNG 宽高必须为正整数');
  }
  if (width > CREATOR_PNG_MAX_DIMENSION || height > CREATOR_PNG_MAX_DIMENSION) {
    throw new CreatorPngError(
      'DIMENSIONS_TOO_LARGE',
      `PNG 单边不能超过 ${CREATOR_PNG_MAX_DIMENSION}px（当前 ${width}×${height}）`,
    );
  }
  if (width * height > CREATOR_PNG_MAX_PIXELS) {
    throw new CreatorPngError(
      'PIXEL_COUNT_TOO_LARGE',
      `PNG 总像素不能超过 ${CREATOR_PNG_MAX_PIXELS.toLocaleString()}（当前 ${(width * height).toLocaleString()}）`,
    );
  }
  return { width, height };
}

function safeOutputFileName(layer: 'back' | 'front') {
  return `${layer}.png`;
}

export async function importPngFile(
  file: File,
  layer: 'back' | 'front',
): Promise<CreatorBinaryInput> {
  if (file.size > CREATOR_PNG_MAX_FILE_BYTES) {
    throw new CreatorPngError(
      'FILE_TOO_LARGE',
      `单张 PNG 不能超过 ${CREATOR_PNG_MAX_FILE_BYTES / 1024 / 1024} MiB（当前 ${(file.size / 1024 / 1024).toFixed(2)} MiB）`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = inspectPngBytes(bytes);
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) {
      bitmap.close();
      throw new CreatorPngError('DECODE_FAILED', '浏览器解码尺寸与 PNG IHDR 不一致');
    }
    bitmap.close();
  } catch (error) {
    if (error instanceof CreatorPngError) throw error;
    throw new CreatorPngError(
      'DECODE_FAILED',
      `浏览器无法解码该 PNG：${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  const metadata: CreatorLayerMetadata = {
    sourceFileName: file.name,
    mime: file.type || 'application/octet-stream',
    bytes: bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    sha256: await sha256Bytes(bytes),
    outputFileName: safeOutputFileName(layer),
  };
  return { metadata, bytes };
}

export async function importProjectPngBytes(options: {
  bytes: Uint8Array;
  layer: 'back' | 'front';
  sourceFileName: string;
  outputPath: string;
}): Promise<CreatorBinaryInput> {
  const dimensions = inspectPngBytes(options.bytes);
  const metadata: CreatorLayerMetadata = {
    sourceFileName: options.sourceFileName,
    mime: 'image/png',
    bytes: options.bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    sha256: await sha256Bytes(options.bytes),
    outputFileName: options.sourceFileName,
    outputPath: options.outputPath,
  };
  return { metadata, bytes: options.bytes };
}
