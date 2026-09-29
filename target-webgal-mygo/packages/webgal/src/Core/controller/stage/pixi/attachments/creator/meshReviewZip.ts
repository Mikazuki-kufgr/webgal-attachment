/** Small uncompressed ZIP writer. Fixed generated names only; no external executable. */
export function meshReviewZip(files: { name: string; bytes: Uint8Array }[]) {
  const encoder = new TextEncoder(),
    chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const crc = (data: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of data) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  for (const f of files) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(f.name) || f.name.includes('..')) throw new Error('导出文件名无效');
    const name = encoder.encode(f.name),
      local = new Uint8Array(30 + name.length),
      v = new DataView(local.buffer),
      sum = crc(f.bytes);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint32(14, sum, true);
    v.setUint32(18, f.bytes.length, true);
    v.setUint32(22, f.bytes.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    const dir = new Uint8Array(46 + name.length),
      d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint32(16, sum, true);
    d.setUint32(20, f.bytes.length, true);
    d.setUint32(24, f.bytes.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    chunks.push(local, f.bytes);
    central.push(dir);
    offset += local.length + f.bytes.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' });
}
