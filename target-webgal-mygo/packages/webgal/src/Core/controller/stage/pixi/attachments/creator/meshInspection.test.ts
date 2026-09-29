import { expect, it } from 'vitest';
import { inspectMesh, topologyDigest } from './meshInspection';
function model() {
  const dc = { _$VS: 0.5, baseOpacity: 0.4, _$IS: [false] };
  const data = {
    draw() {
      return 'this._$Qi baseOpacity';
    },
    getNumPoints: () => 3,
    getTextureNo: () => 1,
    getIndexArray: () => [0, 1, 2],
    _$Qi: [0, 0, 1, 0, 0, 1],
    getOpacity: () => 0.5,
    getClipIDList: () => ['mask'],
  };
  const m = {
    textures: [{}, {}],
    internalModel: {
      getDrawableIndex: () => 0,
      getDrawableVertices: () => [0, 0, 2, 0, 0, 3],
      coreModel: { getModelContext: () => ({ getDrawData: () => data, _$C2: () => dc }) },
    },
  };
  return { m: m as never, dc, data };
}
it('reads checked Cubism2 texture/triangles and final part opacity, including hidden hand state', () => {
  const { m, dc } = model();
  const r = inspectMesh(m, 'hand');
  expect(r.texture).toBe(1);
  expect(r.opacity).toBeCloseTo(0.1);
  expect(r.masked).toBe(true);
  dc._$IS[0] = true;
  expect(inspectMesh(m, 'hand').opacity).toBe(0);
});
it('does not guess unsupported ABI or malformed UV/index arrays', () => {
  const { m, data } = model();
  data._$Qi = [0, 0];
  expect(() => inspectMesh(m, 'hand')).toThrow('结构无法核对');
  data.draw = () => '';
  expect(() => inspectMesh(m, 'hand')).toThrow('SDK不支持');
  const n = model();
  n.data.getIndexArray = () => [0, 1, 999];
  expect(() => inspectMesh(n.m, 'hand')).toThrow('结构无法核对');
});
it('topology identity remains independent of current pose but detects connectivity changes', async () => {
  expect(await topologyDigest(3, [0, 1, 2])).toHaveLength(64);
  expect(await topologyDigest(3, [0, 1, 2])).not.toBe(await topologyDigest(3, [0, 2, 1]));
});
