import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { CreatorPreviewFlowOwnership } from './creatorPreviewFlowOwnership';

const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8');
const ast = ts.createSourceFile('workbench.ts', source, ts.ScriptTarget.Latest, true);
let body = '';
function visit(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'changeSelectedAnchor') body = n.getText(ast);
  ts.forEachChild(n, visit);
}
visit(ast);
const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function harness(withImage = true) {
  const flow = new CreatorPreviewFlowOwnership(() => {}),
    calls: string[] = [],
    statuses: unknown[][] = [];
  const env: any = {
    destroyed: false,
    activeBusyControl: undefined,
    libraryFigureSwitchInProgress: false,
    draft: {
      modelProfileId: 'profile-a',
      anchorName: 'head',
      placement: { offset: { x: 15, y: -15 }, localScaleX: 0.35 },
      visualState: { opacity: 0.8 },
    },
    binaries: withImage ? { front: { bytes: new Uint8Array([1, 2, 3]), metadata: { fileName: 'front.png' } } } : {},
    anchorField: { select: { value: 'mouth' } },
    cloneCreatorDraft: structuredClone,
    retainedAdaptations: [],
    attachmentDefaults: { offset: { x: 15, y: -15 }, localScaleX: 0.35 },
    pendingAdaptationDrafts: new Map(),
    captureCurrentAdaptation: async () => {},
    switchCreatorAdaptation: (draft: any, _rows: unknown[], _profile: unknown, _allow: boolean, _seed: unknown, anchor: string) => ({ draft: { ...draft, anchorName: anchor } }),
    defaultParametersFromPreset: () => undefined,
    writeDraftInputs() {},
    refreshAnchors(name: string) { env.anchorField.select.value = name; },
    previewFlow: flow,
    readDraftInputs() {},
    invalidateExportPlan() {},
    updateTargetFacts() {},
    updateTargetAvailability() {},
    beginPreviewFlow: () => flow.begin(),
    isPreviewFlowCurrent: (r: number) => flow.isCurrent(r),
    clearPreview: (r: number) =>
      flow.clear(async () => {
        calls.push('clear');
      }, r),
    selectedProfile: () => ({ modelProfileId: 'profile-a', anchors: [{ name: 'head' }, { name: 'mouth' }] }),
    compatibleAnchorNames: (name: string) => [name],
    bindPreview: async () => {
      calls.push('bind:' + env.draft.anchorName);
      return true;
    },
    setStatus: (...args: unknown[]) => statuses.push(args),
    errorMessage: (e: Error) => e.message,
  };
  const change = new Function('env', 'with(env){' + js + ';return changeSelectedAnchor;}')(env);
  return { env, change, calls, statuses, flow };
}
describe('shipped Workbench anchor selection', () => {
  it.each(['imported PNG', 'builtin sample'])(
    '%s retains image and placement and rebinds at the new anchor',
    async () => {
      const h = harness(),
        image = h.env.binaries.front,
        placement = structuredClone(h.env.draft.placement);
      await h.change();
      expect(h.calls).toEqual(['clear', 'bind:mouth']);
      expect(h.env.binaries.front).toBe(image);
      expect(h.env.draft.placement).toEqual(placement);
      expect(h.env.draft.visualState).toEqual({ opacity: 0.8 });
      expect(h.statuses.at(-1)?.[0]).toContain('未校准起点');
    },
  );
  it('allows anchor selection before importing without trying to bind an empty image', async () => {
    const h = harness(false);
    await h.change();
    expect(h.calls).toEqual(['clear']);
    expect(h.env.draft.anchorName).toBe('mouth');
  });
  it('only the latest rapid selection binds when an older clear finishes late', async () => {
    const h = harness();
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const firstClearEntered = new Promise<void>((r) => (entered = r));
    let count = 0;
    h.env.clearPreview = (r: number) => h.flow.clear(() => {
      if (++count === 1) { entered(); return pending; }
      return Promise.resolve();
    }, r);
    const first = h.change();
    await firstClearEntered;
    h.env.anchorField.select.value = 'head';
    const second = h.change();
    release();
    await Promise.all([first, second]);
    expect(h.calls).toEqual(['bind:head']);
    expect(h.env.draft.anchorName).toBe('head');
  });
  it('does not replace a real bind failure with a success notification', async () => {
    const h = harness();
    h.env.bindPreview = async () => {
      h.env.setStatus('bind failed', false);
      return false;
    };
    await h.change();
    expect(h.statuses.at(-1)?.[0]).toContain('原附件内容和目标已恢复');
    expect(h.statuses.at(-1)?.[1]).toBe(false);
    expect(h.statuses.some(([message]) => String(message).includes('未校准起点'))).toBe(false);
    expect(h.env.draft.anchorName).toBe('head');
  });
  it('keeps material but does not bind an unavailable anchor', async () => {
    const h = harness();
    h.env.anchorField.select.value = 'missing';
    await h.change();
    expect(h.calls).toEqual([]);
    expect(h.env.binaries.front).toBeDefined();
    expect(h.statuses.at(-1)?.[1]).toBe('warning');
  });
});
