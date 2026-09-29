import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { commitCreatorFigureSelection } from './creatorFigureCommit';

// Execute the shipped Workbench function bodies, with stage/services substituted.
// This is a CPU ordering regression, not GUI or Live2D visual acceptance.
const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8');
const ast = ts.createSourceFile('workbench.ts', source, ts.ScriptTarget.Latest, true);
const names = ['ensureProfileFigure', 'refreshFigures', 'commitProfileFigure'];
const functions: string[] = [];
function visit(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) functions.push(n.getText(ast));
  ts.forEachChild(n, visit);
}
visit(ast);
const js = ts.transpileModule(functions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function harness() {
  const oldProfile = { modelProfileId: 'anon', characterId: 'anon', modelPath: 'anon/model.json', anchors: [] };
  const newProfile = { modelProfileId: 'sakiko', characterId: 'sakiko', modelPath: 'sakiko/model.json', anchors: [] };
  let active = { key: 'authoring-model', uuid: 'old-generation', normalizedSourceUrl: oldProfile.modelPath };
  const stage = {
    figureObjects: [
      {
        key: 'authoring-model',
        uuid: 'old-generation',
        sourceType: 'live2d',
        sourceUrl: oldProfile.modelPath,
        isExiting: false,
      },
    ],
    getActiveLive2DFigure: () => ({ status: 'ready', figure: active }),
  };
  const select = { value: 'authoring-model', append() {}, replaceChildren() {} };
  const bindings: string[] = [];
  let revision = 1;
  const env: any = {
    editingProfile: undefined,
    destroyed: false,
    anchorStudio: { refresh() {}, requestModelChange: () => true },
    libraryFigureSwitchInProgress: false,
    WebGAL: { gameplay: { pixiStage: stage } },
    stageStateManager: {},
    lifetime: { signal: new AbortController().signal },
    draft: {
      figureKey: 'authoring-model',
      figureGeneration: 'old-generation',
      modelProfileId: 'anon',
      anchorName: 'head',
    },
    binaries: { front: {} },
    attachmentDefaults: { anchorName: 'head' },
    profiles: new Map([
      ['anon', oldProfile],
      ['sakiko', newProfile],
    ]),
    figures: [],
    figureField: { select },
    profileField: { select: { ...select } },
    anchorField: { select: { ...select } },
    runtime: { figureGeneration: () => active.uuid },
    profileMatchesModelPath: (p: any, m: string) => p.modelPath === m,
    selectedFigure: () => env.figures.find((f: any) => f.figureKey === select.value),
    refreshProfiles: (id: string) => {
      env.draft.modelProfileId = id;
    },
    updateTargetFacts() {},
    stopHandPose() {},
    updateTargetAvailability() {},
    renderPreviewFacts() {},
    preflightSelectedTargetModel() {},
    invalidateExportPlan() {},
    emptyOption() {},
    audit() {},
    syncCharacterSelection() {},
    writeDraftInputs() {},
    el: () => ({ value: '' }),
    isPreviewFlowCurrent: (v: number) => v === revision,
    beginPreviewFlow: () => ++revision,
    clearPreview: async () => {
      revision++;
      return true;
    },
    bindPreview: async () => {
      bindings.push(env.draft.modelProfileId + '@' + active.normalizedSourceUrl);
      return env.profiles.get(env.draft.modelProfileId).modelPath === active.normalizedSourceUrl;
    },
    commitCreatorFigureSelection,
  };
  const f = new Function(
    'env',
    'with(env){' + js + ';return {ensureProfileFigure,refreshFigures,commitProfileFigure};}',
  )(env);
  env.replaceCreatorFigure = async () => {
    active = { ...active, uuid: 'new-generation', normalizedSourceUrl: newProfile.modelPath };
    stage.figureObjects = [{ ...stage.figureObjects[0], uuid: active.uuid, sourceUrl: active.normalizedSourceUrl }];
    await f.refreshFigures();
    return { figureKey: 'authoring-model', generation: active.uuid };
  };
  return { env, f, bindings, newProfile, revision: () => revision };
}
describe('Workbench replacement refresh commit order', () => {
  it('exposes the Hotfix28 old sequence: refresh rebinds old Profile and invalidates outer revision', async () => {
    const h = harness();
    await h.f.ensureProfileFigure(h.newProfile, 1);
    await h.f.refreshFigures();
    expect(h.bindings).toEqual(['anon@sakiko/model.json']);
    expect(h.revision()).not.toBe(1);
  });
  it('commits model, Profile and generation before any automatic rebind can run', async () => {
    const h = harness();
    const next = { ...h.env.draft, modelProfileId: 'sakiko' };
    expect(await h.f.commitProfileFigure(h.newProfile, next, 1)).toBe(true);
    expect(h.bindings).toEqual([]);
    expect(h.revision()).toBe(1);
    expect(h.env.draft).toMatchObject({ modelProfileId: 'sakiko', figureGeneration: 'new-generation' });
    expect(h.env.libraryFigureSwitchInProgress).toBe(false);
    await h.f.refreshFigures();
    expect(h.bindings).toEqual([]);
  });
  it('releases the guard on replacement failure without committing a new draft', async () => {
    const h = harness();
    h.env.replaceCreatorFigure = async () => {
      throw new Error('load failed');
    };
    await expect(
      h.f.commitProfileFigure(h.newProfile, { ...h.env.draft, modelProfileId: 'sakiko' }, 1),
    ).rejects.toThrow('load failed');
    expect(h.env.draft.modelProfileId).toBe('anon');
    expect(h.env.libraryFigureSwitchInProgress).toBe(false);
  });
  it('does not commit a superseded or closed operation', async () => {
    const h = harness();
    h.env.isPreviewFlowCurrent = () => false;
    await expect(
      h.f.commitProfileFigure(h.newProfile, { ...h.env.draft, modelProfileId: 'sakiko' }, 1),
    ).rejects.toThrow('SUPERSEDED');
    expect(h.env.draft.modelProfileId).toBe('anon');
    expect(h.env.libraryFigureSwitchInProgress).toBe(false);
  });
});
