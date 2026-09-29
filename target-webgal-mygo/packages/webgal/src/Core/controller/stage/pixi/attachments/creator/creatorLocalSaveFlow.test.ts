import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { createCreatorProjectClient, CreatorProjectRequestError } from './creatorProject';
import { calibratedSampleProfileId } from './creatorBuiltinSampleTarget';
import { ordinarySavedAdaptation } from './creatorAuthoringState';
import { selectCreatorSavedAdaptation } from './creatorSavedAdaptationSelection';
const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8'),
  ast = ts.createSourceFile('workbench.ts', source, ts.ScriptTarget.Latest, true);
function shipped(name: string, env: any) {
  for (const [key, value] of Object.entries({ pendingSave: undefined, editingProfile: undefined, packageCreatedAt: '', adaptationConfirmed: false, retainedAdaptations: [], attachmentDefaults: undefined, attachmentState: (): string => '',
    requestAttachmentReplace: (): boolean => true, acceptSavedPackage: (): void => { env.projectDirty = false; env.rememberDraftBaseline?.(); } })) {
    if (!(key in env)) env[key] = value;
  }
  let body = '';
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) body = n.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  expect(body).not.toBe('');
  return new Function(
    'env',
    'with(env){' +
      ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText +
      ';return ' +
      name +
      ';}',
  )(env);
}
describe('local save and ordinary builtin shortcut source flow', () => {
  it('local save calls only local persistence and accepts its independent revision', async () => {
    const calls: string[] = [],
      built = { preset: { presetId: 'v2/hat', attachmentAssetId: 'hat' }, draft: { displayName: '帽子' } };
    const env: any = {
      draft: { presetId: 'v2/hat' },
      destroyed: false,
      buildPackage: async () => built,
      ensureWriteRevision: async (p: string) => {
        calls.push('revision:' + p);
        return null;
      },
      completionNotice: undefined,
      setStatus() {},
      CreatorProjectRequestError,
      errorMessage: (e: Error) => e.message,
      saveCreatorPackageLocally: async () => {
        calls.push('save-local');
        return { revision: 'R', attachmentRoot: 'workspace/hat', presetId: 'v2/hat' };
      },
      saveCreatorPackageToGame() {
        throw Error('GAME_WRITE_FORBIDDEN');
      },
      selectedTargetProject() {
        throw Error('GAME_SELECTION_FORBIDDEN');
      },
      revisions: { accept: (p: string) => calls.push('accept:' + p), markUncertain() {} },
      lifetime: { signal: undefined },
      projectDirty: true,
      rememberDraftBaseline() {},
      localSaveSummary: { textContent: '' },
      audit() {},
      refreshLocalSavedAttachments: async () => true,
      serviceContext: { authoringWorkspace: { savedAttachments: [] } },
      updateTargetAvailability() {},
    };
    await shipped('saveLocalAttachment', env)();
    expect(calls).toEqual(['revision:authoring-workspace', 'save-local', 'accept:authoring-workspace']);
    expect(env.localSaveSummary.textContent).toContain('workspace/hat');
  });
  it('failed local reply stays uncertain and never declares a successful save', async () => {
    const statuses: any[] = [],
      marked: string[] = [],
      env: any = {
        draft: { presetId: 'v2/hat' },
        destroyed: false,
        buildPackage: async () => ({ preset: { presetId: 'v2/hat', attachmentAssetId: 'hat' } }),
        ensureWriteRevision: async () => null,
        setStatus: (...s: any[]) => statuses.push(s),
        CreatorProjectRequestError,
        errorMessage: (e: Error) => e.message,
        lifetime: { signal: undefined },
        saveCreatorPackageLocally: async () => {
          throw new CreatorProjectRequestError({
            code: 'CREATOR_REQUEST_TIMEOUT',
            message: 'timeout',
            commitState: 'UNKNOWN',
          });
        },
        revisions: { markUncertain: (p: string) => marked.push(p) },
      };
    await shipped('saveLocalAttachment', env)();
    expect(marked).toEqual(['authoring-workspace']);
    expect(statuses.at(-1)[1]).toBe(false);
    expect(statuses.at(-1)[0]).toContain('尚未确认');
  });
  it('saved builtin shortcut opens the same local attachment instead of importing another copy', async () => {
    const saved = { key: 'authoring-workspace|v2/hat', presetId: 'v2/hat' },
      calls: any[] = [],
      env: any = {
        profileField: { select: { value: 'profile' } },
        anchorField: { select: { value: 'head' } },
        creatorCatalogEntry: () => undefined,
        selectedFigure: () => ({}),
        refreshServiceContext: async () => { throw new Error('Full scan must not block sample load'); },
        loadCreatorAuthoringAttachments: async () => ({ savedAttachments: [saved] }),
        lifetime: { signal: undefined },
        setStatus() {},
        destroyed: false,
        serviceContext: { authoringWorkspace: { savedAttachments: [saved] } },
        savedAttachmentField: { select: { value: '' } },
        renderSavedAdaptations() {},
        loadSelectedSavedAttachment: async (...args: any[]) => calls.push(args),
        fetch() {
          throw Error('SOURCE_REIMPORT_FORBIDDEN');
        },
      };
    await shipped('loadCurrentPresetAsCopy', env)('v2/hat', '草帽');
    expect(calls).toEqual([[undefined, false, saved]]);
    expect(env.savedAttachmentField.select.value).toBe(saved.key);
  });
  it('factory sample shortcut reads the complete package through the ordinary load path', async () => {
    const row: any = { preset: { anchorName: 'head' }, modelProfile: { modelProfileId: 'profile-a', modelPath: 'game/figure/a/model.json' } };
    const factoryResult: any = { revision: 'r1', packageDocument: { adaptations: [row] } };
    const calls: any[] = [];
    const env: any = {
      profileField: { select: { value: 'profile-a' } }, anchorField: { select: { value: 'head' } },
      creatorCatalogEntry: () => undefined, selectedFigure: () => ({ figureKey: 'figure' }),
      loadCreatorAuthoringAttachments: async () => ({ savedAttachments: [] }),
      lifetime: { signal: undefined }, destroyed: false,
      serviceContext: { authoringWorkspace: { savedAttachments: [] }, builtinSamples: [{ id: 'flower', name: '花朵', presetId: 'v2/flower-front-v1', completeFolder: 'portable-samples/花朵/flower-front-v1' }] },
      loadCreatorFactorySample: async () => factoryResult,
      loadSelectedSavedAttachment: async (...args: any[]) => calls.push(args),
      setStatus() {}, fetch() { throw new Error('SCATTERED_SAMPLE_READ_FORBIDDEN'); },
    };
    await shipped('loadCurrentPresetAsCopy', env)('v2/flower-front-v1', '花朵');
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ projectName: 'factory-library', presetId: 'v2/flower-front-v1', anchorNames: ['head'] });
    expect(calls[0][3]).toBe(factoryResult);
  });
  it.each([false, true, 'custom-same-model' as const])('first sample targets an available anchor: scenario=%s', async (scenario) => {
    const sameModel = scenario !== false;
    const customGroup = scenario !== true;
    const preset = {
      presetId: 'v2/hat',
      attachmentAssetId: 'hat-images',
      modelProfileId: 'anon',
      anchorName: 'head',
      placement: { offset: { x: -8, y: 176 }, localScale: 1.2 },
    };
    const sourceProfile = { modelProfileId: 'anon', characterId: 'anon', modelId: 'winter', modelPath: './game/figure/anon/winter/model.json', fingerprint: { mocSha256: 'A'.repeat(64), drawableCount: 155 }, anchors: [{ name: 'head' }] };
    const currentId = sameModel ? 'semantic' : 'sakiko';
    const currentProfile = { ...sourceProfile, modelProfileId: currentId, characterId: sameModel ? 'anon' : 'sakiko', anchors: customGroup ? [{ name: 'user.hand' }] : [{ name: 'head' }] };
    const figure = { figureKey: 'figure', generation: 'gen', modelPath: currentProfile.modelPath, compatibleProfiles: [currentProfile] };
    const env: any = {
      profileField: { select: { value: currentId } },
      anchorField: { select: { value: customGroup ? 'user.hand' : 'head' } },
      creatorCatalogEntry: () => undefined,
      selectedFigure: () => figure,
      refreshServiceContext: async () => { throw new Error('Full scan must not block sample load'); },
      loadCreatorAuthoringAttachments: async () => ({ savedAttachments: [] }),
      lifetime: { signal: undefined },
      calibratedSampleProfileId,
      profiles: new Map([[currentId, currentProfile]]),
      parseLive2DModelProfile: (p: any) => p,
      profileMatchesModelPath: () => sameModel,
      destroyed: false,
      serviceContext: { authoringWorkspace: { savedAttachments: [] } },
      beginPreviewFlow: () => 1,
      isPreviewFlowCurrent: () => true,
      setStatus() {},
      errorMessage: (error: Error) => error.message,
      profileLoader: { urlForPreset: () => '/source', urlForModelProfile: () => '/profile' },
      fetch: async (url: string) => ({ ok: true, url, json: async () => url === '/source' ? preset : sourceProfile }),
      parseAttachmentPlacementPreset: (p: any) => p,
      draftFromPreset: (p: any) => ({
        presetId: 'copy',
        attachmentDefinitionId: 'copy-images',
        placement: p.placement,
        anchorName: p.anchorName,
      }),
      retargetBuiltinSampleDraft: (d: any, id: string) => ({ ...d, modelProfileId: id }),
      loadPresetBinaries: async () => ({ slot: 'headwear', inputs: { front: { metadata: { fileName: 'front.png' } } } }),
      draft: {},
      binaries: {},
      retainedAdaptations: [],
      pendingAdaptationDrafts: new Map(),
      attachmentDefaults: {},
      defaultParametersFromPreset: (p: any) => p.placement,
      rememberDraftBaseline() {},
      refreshAnchors() {},
      refreshProfiles() {},
      writeDraftInputs() {},
      bindPreview: async () => env.profiles.get(env.draft.modelProfileId)?.anchors.some((anchor: any) => anchor.name === env.draft.anchorName),
      audit() {},
    };
    await shipped('loadCurrentPresetAsCopy', env)('v2/hat', '草帽');
    expect(env.draft.presetId).toBe('v2/hat');
    expect(env.draft.attachmentDefinitionId).toBe('hat-images');
    expect(env.draft.modelProfileId).toBe(customGroup ? currentId : 'anon');
    expect(env.draft.anchorName).toBe(customGroup ? 'user.hand' : 'head');
    expect(env.profiles.has('anon')).toBe(true);
    if (sameModel) expect(figure.compatibleProfiles).toContain(sourceProfile);
    expect(env.draft.placement).toEqual(preset.placement);
    expect(env.binaries.front.metadata.fileName).toBe('front.png');
  });
  it('saved builtin shortcut adds an uncalibrated target instead of restoring a same-path old anchor', async () => {
    const original = { modelProfileId: 'original', modelPath: 'game/figure/a/model.json', anchors: [{ name: 'head' }] };
    const target = { modelProfileId: 'custom-group', modelPath: original.modelPath, anchors: [{ name: 'user.hand' }] };
    const preset = { presetId: 'v2/hat', attachmentAssetId: 'hat-images', modelProfileId: original.modelProfileId, anchorName: 'head', placement: { offset: { x: 5, y: 6 } }, approvalStatus: 'approved' };
    const packageDocument = { schemaVersion: 2, asset: { attachmentAssetId: 'hat-images', slot: 'headwear' }, adaptations: [{ preset, modelProfile: original }], defaultParameters: { anchorName: 'head', placement: preset.placement } };
    const statuses: string[] = [];
    let previewBindings = 0;
    const saved = { projectName: 'authoring-workspace', presetId: 'v2/hat', displayName: '草帽', modelProfileIds: ['original'] };
    const env: any = {
      draft: {}, binaries: {}, pendingAdaptationDrafts: new Map(), projectDirty: false, destroyed: false, lifetime: { signal: undefined },
      anchorField: { select: { value: 'user.hand' } },
      savedAdaptationField: { select: { value: '' } },
      selectedProfile: () => target, beginPreviewFlow: () => 1, isPreviewFlowCurrent: () => true,
      setStatus: (message: string) => statuses.push(message),
      loadCreatorSavedAttachment: async () => ({ presetId: 'v2/hat', packageDocument, layers: { front: {} }, revision: 'r1', integrity: 'HASH_VALIDATED' }),
      parseAttachmentAssetDefinition: (value: any) => value,
      parseAttachmentPlacementPreset: (value: any) => value,
      parseLive2DModelProfile: (value: any) => value,
      parseCreatorDefaultParameters: (value: any) => value,
      ordinarySavedAdaptation, selectCreatorSavedAdaptation,
      draftFromPreset: (value: any) => ({ anchorName: value.anchorName, placement: structuredClone(value.placement), layers: {} }),
      applyCreatorDefaultParameters: (draft: any, defaults: any) => ({ ...draft, anchorName: defaults.anchorName, placement: structuredClone(defaults.placement) }),
      compatibleAnchorNames: (name: string) => [name],
      projectLayerBytes: () => new Uint8Array([1]),
      importProjectPngBytes: async () => ({ bytes: new Uint8Array([1]), metadata: { fileName: 'front.png' } }),
      clearPreview: async () => true,
      commitProfileFigure: async (_profile: any, draft: any, _flow: any, commit: () => void) => { env.draft = draft; commit(); return true; },
      revisions: { accept() {} }, rememberDraftBaseline() {}, refreshProfiles() {}, refreshAnchors() {}, writeDraftInputs() {}, setDraggingEnabled() {}, renderProjectFacts() {}, audit() {},
      bindPreview: async () => {
        previewBindings++;
        const profile = env.draft.modelProfileId === target.modelProfileId ? target : original;
        return profile.anchors.some(anchor => anchor.name === env.draft.anchorName);
      },
    };
    await shipped('loadSelectedSavedAttachment', env)(undefined, false, saved);
    expect(env.draft.modelProfileId).toBe(target.modelProfileId);
    expect(env.draft.anchorName).toBe('user.hand');
    expect(env.draft.placement).toEqual(preset.placement);
    expect(env.binaries.front.metadata.fileName).toBe('front.png');
    expect(previewBindings).toBe(1);
    expect(statuses.at(-1)).toContain('尚未');
    env.selectedSavedAttachment = () => saved;
    env.savedAdaptationField = { select: { value: '' } };
    await shipped('loadSelectedSavedAttachment', env)(undefined, false);
    expect(env.draft.modelProfileId).toBe(original.modelProfileId);
    expect(env.draft.anchorName).toBe('head');
    expect(previewBindings).toBe(2);
  });
  it('transport routes local read/write/accept separately from target-game writes', async () => {
    const calls: Array<{ path: string; body: any }> = [],
      c = createCreatorProjectClient({
        token: 'a'.repeat(64),
        fetcher: (async (p: any, i: any) => {
          calls.push({ path: String(p), body: JSON.parse(i.body) });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch,
      });
    const pack: any = { preset: { presetId: 'v2/hat', attachmentAssetId: 'hat', modelProfileId: 'p' }, files: [] };
    try {
      await c.saveCreatorPackageLocally(pack, null);
      await c.loadCreatorSavedAttachment('authoring-workspace', 'v2/hat');
      await c.acceptCreatorSavedAttachmentChanges('authoring-workspace', 'v2/hat', 'B'.repeat(64));
      await c.saveCreatorPackageToGame('Game', pack, '', null);
      expect(calls.map((x) => x.path)).toEqual([
        '/__creator/save-local',
        '/__creator/load-local',
        '/__creator/accept-local-changes',
        '/__creator/save-to-game',
      ]);
      expect(calls[0].body.projectName).toBeUndefined();
      expect(calls[3].body.projectName).toBe('Game');
    } finally {
      c.cancel();
    }
  });
});

describe('save completion means the ordinary workbench is ready',()=>{
 for(const refreshOK of [true,false])it('unlocks before success; refreshOK='+refreshOK,async()=>{
  let finish!: (v:boolean)=>void; const pending=new Promise<boolean>(r=>finish=r),statuses:any[]=[];
  const env:any={draft:{presetId:'v2/hat'},destroyed:false,activeBusyControl:undefined,completionNotice:undefined,cancelDrag(){},root:{inert:false,setAttribute(){this.inert=true;},removeAttribute(){this.inert=false;}},updateTargetAvailability(){},
   buildPackage:async()=>({preset:{presetId:'v2/hat',attachmentAssetId:'hat'},draft:{displayName:'草帽'}}),ensureWriteRevision:async()=>null,
   saveCreatorPackageLocally:async()=>({presetId:'v2/hat',revision:'R',attachmentRoot:'local/hat'}),revisions:{accept(){},markUncertain(){}},lifetime:{},projectDirty:true,rememberDraftBaseline(){},localSaveSummary:{textContent:''},audit(){},refreshLocalSavedAttachments:async()=>{if(!(await pending))throw Error('list timeout');return true;},serviceContext:{authoringWorkspace:{savedAttachments:[]}},CreatorProjectRequestError,errorMessage:(e:Error)=>e.message,
   setStatus:(text:string,result:any)=>{statuses.push({text,result,inert:env.root.inert,busy:env.activeBusyControl});}};
  const button:any={textContent:'保存附件',dataset:{},disabled:false};
  const running=shipped('withBusyButton',env)(button,'保存中',shipped('saveLocalAttachment',env));
  await new Promise(r=>setTimeout(r,0));expect(env.root.inert).toBe(true);expect(statuses.some(s=>s.result===true)).toBe(false);
  finish(refreshOK);await running;expect(env.root.inert).toBe(false);expect(button.disabled).toBe(false);
  if(refreshOK){expect(statuses.at(-1).result).toBe(true);expect(statuses.at(-1).inert).toBe(false);expect(statuses.at(-1).busy).toBeUndefined();}
  else{expect(statuses.some(s=>s.result===true)).toBe(false);expect(statuses.at(-1).text).toContain('已保存，但列表刷新未完成');expect(statuses.at(-1).result).toBe('warning');expect(statuses.at(-1).inert).toBe(false);}
 });
});

describe('post-save local inventory refresh', () => {
  for (const mode of ['ok', 'timeout', 'missing']) it('preserves model/game context and confirmed revision: '+mode, async () => {
    const oldRows = [{ presetId: 'old' }], row = { presetId: 'v2/hat', projectName: 'authoring-workspace', key: 'local|hat', revision: 'R' };
    const context = { targetProjects: [{ name: 'keep-game' }], authoringWorkspace: { savedAttachments: oldRows, availableModelProfileIds: ['user-hand'] } };
    const observed: any[] = []; let rendered = false;
    const env: any = { destroyed: false, lifetime: {}, serviceContext: context,
      loadCreatorAuthoringAttachments: async () => { if (mode === 'timeout') throw Error('timeout'); return { savedAttachments: mode === 'missing' ? [] : [row] }; },
      loadCreatorServiceContext: () => { throw Error('Full model/game scan forbidden after local save'); },
      revisions: { observe: (...args: any[]) => observed.push(args) }, renderStoragePaths: () => { rendered = true; },
    };
    const refresh = shipped('refreshLocalSavedAttachments', env);
    if (mode === 'ok') { expect(await refresh('v2/hat')).toBe(true); expect(context.authoringWorkspace.savedAttachments).toEqual([row]); expect(observed).toEqual([['authoring-workspace','v2/hat','R']]); expect(rendered).toBe(true); }
    else { await expect(refresh('v2/hat')).rejects.toThrow(); expect(context.authoringWorkspace.savedAttachments).toBe(oldRows); expect(rendered).toBe(false); }
    expect(env.serviceContext).toBe(context); expect(context.authoringWorkspace.availableModelProfileIds).toEqual(['user-hand']); expect(context.targetProjects).toEqual([{name:'keep-game'}]);
  });
});
