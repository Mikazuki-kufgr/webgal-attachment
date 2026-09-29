import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { adaptationState } from './creatorAuthoringState';

// Execute the actual orchestration body; real DOM/PNG/Live2D coverage is a separate browser probe.
const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8');
const ast = ts.createSourceFile('workbench.ts', source, ts.ScriptTarget.Latest, true);
let declaration = '';
function visit(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'showSelectedLibraryFigure') declaration = n.getText(ast);
  ts.forEachChild(n, visit);
}
visit(ast);
const js = ts.transpileModule('const ' + declaration, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function harness(images: boolean) {
  const profile = { modelProfileId: 'user-profile-hand', characterId: 'anon', modelId: 'winter', modelPath: 'anon/model.json', anchors: [{ name: 'user.hand' }, { name: 'user.second' }] };
  const placement = { x: 31, y: -4, scale: 0.7 };
  let committed: any;
  let clears = 0;
  let binds = 0;
  const statuses: Array<{ message: string; result: unknown }> = [];
  const env: any = {
    profileLabel: (p: any) => p.modelId, adaptationState, adaptationBaseline: '', adaptationConfirmed: false,
    withBusyButton: async (_b: unknown, _t: unknown, fn: () => Promise<unknown>) => fn(), showLibraryProfileButton: {},
    WebGAL: { gameplay: { pixiStage: {} } }, anchorStudio: { requestModelChange: () => true },
    binaries: images ? { front: { bytes: 'retained' } } : {}, captureCurrentAdaptation: async () => {},
    draft: { anchorName: 'head', modelProfileId: 'old', placement, presetId: 'keep-id' },
    anchorField: { select: { value: 'head' } },
    cloneCreatorDraft: structuredClone, retainedAdaptations: [], attachmentDefaults: {}, pendingAdaptationDrafts: new Map(),
    switchCreatorAdaptation: (draft: any) => ({ draft: structuredClone(draft), created: false }),
    libraryFigureSwitchRevision: 0, clearPreview: async () => { clears++; return true; }, beginPreviewFlow: () => 1,
    setStatus: (message: string, result: unknown) => { statuses.push({ message, result }); }, updateTargetAvailability() {}, audit() {}, isPreviewFlowCurrent: () => true,
    bindPreview: async () => { binds++; return true; },
    commitProfileFigure: async (_p: unknown, draft: any) => { committed = draft; env.draft = draft; return true; },
  };
  const run = new Function('env', 'with(env){' + js + '; return showSelectedLibraryFigure;}')(env);
  return { profile, env, run, committed: () => committed, clears: () => clears, binds: () => binds, statuses: () => statuses };
}
describe('authoring Profile application', () => {
  it('uses an available custom anchor when a fresh image would inherit missing head', async () => {
    const h = harness(false); expect(await h.run(true, h.profile)).toBe(true);
    expect(h.committed().anchorName).toBe('user.hand');
  });
  it('carries the explicit authoring selection instead of a valid but different previous anchor', async () => {
    const h = harness(false); h.env.draft.anchorName = 'user.hand'; await h.run(true, h.profile, 'user.second');
    expect(h.committed().anchorName).toBe('user.second');
  });
  it('explicitly rebinds existing content without losing placement, identity or image', async () => {
    const h = harness(true); await h.run(true, h.profile, 'user.hand');
    expect(h.committed()).toMatchObject({ anchorName: 'user.hand', presetId: 'keep-id', placement: { x: 31, y: -4, scale: 0.7 } });
    expect(h.env.binaries.front.bytes).toBe('retained');
  });
  it('does not silently replace a missing anchor in an existing adaptation during ordinary selection', async () => {
    const h = harness(true); await h.run(true, h.profile); expect(h.committed().anchorName).toBe('head');
    expect(h.binds()).toBe(0);
    expect(h.statuses().at(-1)?.message).toContain('请选择');
  });
  it('refuses a stale explicit anchor before clearing the existing preview', async () => {
    const h = harness(true); await expect(h.run(true, h.profile, 'missing')).rejects.toThrow('CREATOR_ANCHOR_NOT_FOUND');
    expect(h.clears()).toBe(0); expect(h.committed()).toBeUndefined();
  });
  it('keeps a new target image and uses its first valid anchor as an uncalibrated starting point', async () => {
    const h = harness(true);
    h.env.switchCreatorAdaptation = (draft: any) => ({
      draft: { ...structuredClone(draft), modelProfileId: h.profile.modelProfileId, anchorName: '' },
      created: true,
    });
    await h.run(true, h.profile);
    expect(h.committed().anchorName).toBe('user.hand');
    expect(h.env.binaries.front.bytes).toBe('retained');
    expect(h.binds()).toBe(1);
    expect(h.statuses().at(-1)).toMatchObject({ result: 'warning' });
    expect(h.statuses().at(-1)?.message).toContain('尚未校准');
  });
  it('does not use a cached anchor missing from the target Profile', async () => {
    const h = harness(true);
    h.env.pendingAdaptationDrafts.set(JSON.stringify([h.profile.modelProfileId, 'user.hand']), {
      anchorName: 'missing', placement: { x: 42, y: 3, scale: 1 }, visualState: { opacity: 0.8 },
    });
    await h.run(true, h.profile);
    expect(h.committed().anchorName).toBe('user.hand');
    expect(h.committed().placement.x).toBe(42);
    expect(h.binds()).toBe(1);
    expect(h.statuses().at(-1)?.message).toContain('尚未校准');
  });
  it('keeps the image and asks for an anchor when the target Profile has none', async () => {
    const h = harness(true);
    h.profile.anchors = [];
    h.env.switchCreatorAdaptation = (draft: any) => ({
      draft: { ...structuredClone(draft), modelProfileId: h.profile.modelProfileId, anchorName: '' },
      created: true,
    });
    await h.run(true, h.profile);
    expect(h.committed().anchorName).toBe('');
    expect(h.env.binaries.front.bytes).toBe('retained');
    expect(h.binds()).toBe(0);
    expect(h.statuses().at(-1)?.message).toContain('请选择');
  });
  it('restores a valid cached anchor and placement when returning to the target Profile', async () => {
    const h = harness(true);
    h.env.anchorField.select.value = 'user.second';
    h.env.pendingAdaptationDrafts.set(JSON.stringify([h.profile.modelProfileId, 'user.second']), {
      anchorName: 'user.second', placement: { x: 42, y: 3, scale: 1 }, visualState: { opacity: 0.8 },
    });
    await h.run(true, h.profile);
    expect(h.committed()).toMatchObject({ anchorName: 'user.second', placement: { x: 42 }, visualState: { opacity: 0.8 } });
    expect(h.binds()).toBe(1);
  });
});
