import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createBlankCreatorDraft } from './creatorDraft';
import { defaultParametersFromDraft } from './creatorDefaultParameters';
import { switchCreatorAdaptation } from './creatorAdaptationSwitch';

const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8');
const ast = ts.createSourceFile('workbench.ts', source, ts.ScriptTarget.Latest, true);
let declaration = '';
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'changeSelectedAnchor') declaration = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

describe('Creator anchor pair switch', () => {
  it('keeps one attachment identity and restores unsaved head -> hand -> head -> hand placements', async () => {
    const profile: any = { modelProfileId: 'profile-a', anchors: [{ name: 'head' }, { name: 'user.hand' }] };
    const draft = createBlankCreatorDraft(1234);
    draft.modelProfileId = profile.modelProfileId;
    draft.anchorName = 'head';
    draft.presetId = 'v2/pair-test';
    draft.attachmentDefinitionId = 'pair-test-asset';
    draft.placement.offset.x = 11;
    let revision = 0;
    const env: any = {
      draft, binaries: { front: { bytes: new Uint8Array([1]) } }, retainedAdaptations: [],
      attachmentDefaults: defaultParametersFromDraft(draft), pendingAdaptationDrafts: new Map(),
      anchorField: { select: { value: 'head' } }, destroyed: false, activeBusyControl: undefined,
      libraryFigureSwitchInProgress: false, cloneCreatorDraft: structuredClone,
      selectedProfile: () => profile, compatibleAnchorNames: (name: string) => [name],
      switchCreatorAdaptation, defaultParametersFromPreset: () => env.attachmentDefaults,
      invalidateExportPlan() {}, beginPreviewFlow: () => ++revision,
      previewFlow: { currentRevision: () => revision }, clearPreview: async () => true,
      isPreviewFlowCurrent: () => true, updateTargetFacts() {}, updateTargetAvailability() {},
      bindPreview: async () => true, writeDraftInputs() {}, readDraftInputs() {},
      refreshAnchors: (name: string) => { env.anchorField.select.value = name; },
      setStatus() {}, errorMessage: (error: Error) => error.message,
      captureCurrentAdaptation: async () => {
        const current = structuredClone(env.draft);
        const pair = JSON.stringify([current.modelProfileId, current.anchorName]);
        env.pendingAdaptationDrafts.set(pair, current);
        const preset = { schema: 'webgal-live2d-attachment-preset', schemaVersion: 2,
          presetId: current.presetId, attachmentAssetId: current.attachmentDefinitionId,
          modelProfileId: current.modelProfileId, anchorName: current.anchorName,
          approvalStatus: 'candidate', fit: { scaleMode: current.placement.scaleMode },
          placement: structuredClone(current.placement) };
        env.retainedAdaptations = [...env.retainedAdaptations.filter((row: any) =>
          row.preset.anchorName !== current.anchorName), { preset, modelProfile: profile }];
      },
    };
    const change = new Function('env', `with(env){${js};return changeSelectedAnchor;}`)(env);
    env.anchorField.select.value = 'user.hand';
    await change();
    expect(env.draft).toMatchObject({ anchorName: 'user.hand', presetId: 'v2/pair-test', attachmentDefinitionId: 'pair-test-asset' });
    env.draft.placement.offset.x = 77;
    env.anchorField.select.value = 'head';
    await change();
    expect(env.draft).toMatchObject({ anchorName: 'head', placement: { offset: { x: 11 } } });
    env.anchorField.select.value = 'user.hand';
    await change();
    expect(env.draft).toMatchObject({ anchorName: 'user.hand', placement: { offset: { x: 77 } } });
    expect(env.binaries.front.bytes).toEqual(new Uint8Array([1]));
    env.bindPreview = async () => false;
    env.anchorField.select.value = 'head';
    await change();
    expect(env.draft).toMatchObject({ anchorName: 'user.hand', placement: { offset: { x: 77 } } });
    expect(env.anchorField.select.value).toBe('user.hand');
  });
});
