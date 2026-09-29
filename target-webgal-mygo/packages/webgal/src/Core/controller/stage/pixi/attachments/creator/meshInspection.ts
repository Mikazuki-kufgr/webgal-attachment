import type { Live2DModel } from 'pixi-live2d-display-webgal';
export interface MeshInspection {
  id: string;
  vertexCount: number;
  indices: number[];
  uv: number[];
  texture: number;
  opacity: number;
  masked: boolean;
}
interface DrawData {
  getTextureNo(): number;
  getNumPoints(): number;
  getIndexArray(): ArrayLike<number>;
  getOpacity(context: unknown, drawContext: unknown): number;
  getClipIDList?(): unknown[];
  draw: Function;
  _$Qi: ArrayLike<number>;
}
interface DrawContext {
  _$VS: number;
  baseOpacity: number;
  _$IS: boolean[];
}
/** Deliberately version-specific Cubism2 ABI, checked against the real SDK draw call.
 * Unknown runtimes do not guess field names from array sizes. This never changes model state. */
export function inspectMesh(model: Live2DModel, id: string): MeshInspection {
  const im = model.internalModel;
  const core = im.coreModel as unknown as {
    getModelContext(): { getDrawData(i: number): DrawData; _$C2(i: number): DrawContext };
  };
  const i = im.getDrawableIndex(id),
    count = im.getDrawableVertices(i).length / 2;
  const mc = core.getModelContext(),
    d = mc.getDrawData(i);
  if (
    !d ||
    typeof d.draw !== 'function' ||
    !String(d.draw).includes('this._$Qi') ||
    !String(d.draw).includes('baseOpacity') ||
    typeof d.getTextureNo !== 'function' ||
    typeof d.getNumPoints !== 'function' ||
    typeof mc._$C2 !== 'function'
  )
    throw new Error('当前模型SDK不支持纹理检查；仍可观察顶点并手工命名。');
  const dc = mc._$C2(i),
    indices = Array.from(d.getIndexArray()),
    uv = Array.from(d._$Qi);
  const texture = d.getTextureNo();
  if (
    d.getNumPoints() !== count ||
    uv.length !== count * 2 ||
    !uv.every((v) => Number.isFinite(v) && v >= -0.01 && v <= 1.01) ||
    !indices.length ||
    indices.length % 3 ||
    indices.some((v) => !Number.isInteger(v) || v < 0 || v >= count) ||
    !Number.isInteger(texture) ||
    texture < 0 ||
    texture >= model.textures.length
  )
    throw new Error('网格纹理结构无法核对，不展示猜测的贴图。');
  const opacity = dc._$IS[0] ? 0 : d.getOpacity(mc, dc) * dc._$VS * dc.baseOpacity;
  if (!Number.isFinite(opacity)) throw new Error('无法读取当前网格透明度。');
  return { id, vertexCount: count, indices, uv, texture, opacity, masked: !!d.getClipIDList?.()?.length };
}
export async function topologyDigest(vertexCount: number, indices: number[]) {
  const bytes = new TextEncoder().encode(JSON.stringify([vertexCount, indices]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
/** Atlas UV triangles, not a bounding-box crop of unrelated neighbouring artwork. */
export function drawMeshTexture(canvas: HTMLCanvasElement, model: Live2DModel, mesh: MeshInspection) {
  const image = (model.textures[mesh.texture].baseTexture.resource as unknown as { source: CanvasImageSource }).source;
  if (!image) throw new Error('模型贴图尚未解码，无法生成预览。');
  const tex = model.textures[mesh.texture].baseTexture;
  const flip = model.internalModel.textureFlipY;
  const pts = Array.from({ length: mesh.vertexCount }, (_, i) => ({
    x: mesh.uv[i * 2] * tex.width,
    y: (flip ? 1 - mesh.uv[i * 2 + 1] : mesh.uv[i * 2 + 1]) * tex.height,
  }));
  const minX = Math.min(...pts.map((p) => p.x)),
    minY = Math.min(...pts.map((p) => p.y));
  const width = Math.max(1, Math.max(...pts.map((p) => p.x)) - minX),
    height = Math.max(1, Math.max(...pts.map((p) => p.y)) - minY);
  const scale = Math.min((canvas.width - 12) / width, (canvas.height - 12) / height);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate((canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2);
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  ctx.beginPath();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map((j) => pts[j]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(image, 0, 0, tex.width, tex.height);
  ctx.restore();
}
