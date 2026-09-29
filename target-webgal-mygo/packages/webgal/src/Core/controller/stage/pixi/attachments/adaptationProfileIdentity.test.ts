import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { AttachmentRuntime } from './AttachmentRuntime';
import { AttachmentConfigLoader } from './configLoader';
import { AttachmentProfileLoader } from './profileLoader';
import { Live2DFigureContainer } from '../Live2DFigureContainer';
import { ExternalStageObjectRegistry } from '../externalStageObjectRegistry';
import type { IStageObject } from '../PixiController';
import type { AttachmentInstanceSnapshot, FreeAttachmentDeclaration } from './types';
import { attachmentDeclarationsFromStage } from './attachmentStageBridge';
import { createCommittedStageSnapshot } from '@/Core/Modules/stage/stageEntityPersistence';
import { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  initialLegacyAttachmentLocalVisualState,
  legacyAttachmentLink,
} from '@/Core/Modules/stage/stageEntityStateTransaction';
import type { IAttachmentState, StageEntityStateV0 } from '@/Core/Modules/stage/stageInterface';
import {
  buildCreatorPackage,
  creatorLifecycleScript,
  type CreatorPackageAdaptation,
} from './creator/creatorPackageBuilder';
import { createBlankCreatorDraft } from './creator/creatorDraft';
import { sha256Bytes } from './creator/pngImport';
import type { Live2DModelProfile } from './profileTypes';
import type { CreatorPackage } from './creator/creatorTypes';

const runtimeCleanups: Array<() => void> = [];
let restoreCanvas: () => void;

beforeAll(() => {
  const canvas = vi
    .spyOn(PIXI.settings.ADAPTER, 'createCanvas')
    .mockImplementation(() => ({ getContext: () => null } as unknown as HTMLCanvasElement));
  restoreCanvas = () => canvas.mockRestore();
});

afterAll(() => restoreCanvas());

afterEach(() => {
  for (const cleanup of runtimeCleanups.splice(0).reverse()) cleanup();
});

const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MuoAAAAASUVORK5CYII='),
  (character) => character.charCodeAt(0),
);
const modelPath = 'game/figure/anon/model.json';

function profile(modelProfileId: string): Live2DModelProfile {
  return {
    schema: 'webgal-live2d-model-profile',
    schemaVersion: 1,
    profileVersion: 1,
    modelProfileId,
    characterId: 'anon',
    modelId: 'winter',
    modelPath,
    fingerprint: { modelJsonSha256: 'A'.repeat(64), drawableCount: 1 },
    anchors: [
      {
        name: 'head',
        anchorProfileId: `${modelProfileId}-head`,
        drawableId: 'head',
        vertexCount: 3,
        points: [
          { index: 0, weight: 1, neutral: { x: 0, y: 0 } },
          { index: 1, weight: 1, neutral: { x: 1, y: 0 } },
          { index: 2, weight: 1, neutral: { x: 0, y: 1 } },
        ],
      },
    ],
  };
}

async function build(modelProfileId: string, offsetX: number, existingAdaptations: CreatorPackageAdaptation[] = []) {
  const draft = createBlankCreatorDraft(1234);
  Object.assign(draft, {
    figureKey: 'fig-center',
    figureGeneration: 'generation-1',
    modelProfileId,
    anchorName: 'head',
    presetId: 'v2/f04-same-path',
    attachmentDefinitionId: 'f04-asset',
    attachmentInstanceId: 'f04-instance',
    displayName: 'F04 同路径双适配',
  });
  draft.placement.offset.x = offsetX;
  const metadata = {
    sourceFileName: '附件.png',
    outputFileName: 'front.png',
    width: 1,
    height: 1,
    bytes: png.length,
    sha256: await sha256Bytes(png),
    mime: 'image/png',
  };
  draft.layers.front = metadata;
  return buildCreatorPackage({
    draft,
    profile: profile(modelProfileId),
    front: { bytes: png, metadata },
    existingAdaptations,
    createdAt: '2026-09-10T00:00:00Z',
  });
}

function document(value: CreatorPackage) {
  return JSON.parse(
    new TextDecoder().decode(value.files.find((file) => file.path.endsWith('/attachment.json'))!.bytes),
  ) as { adaptations: CreatorPackageAdaptation[] };
}

function loaderFor(packageDocument: unknown, requestCount?: { value: number }) {
  return new AttachmentProfileLoader({
    fetcher: async () => {
      if (requestCount) requestCount.value += 1;
      return new Response(JSON.stringify(packageDocument), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
}

function runtimeFor(packageDocument: unknown) {
  const configLoader = new AttachmentConfigLoader({
    fetcher: async () =>
      new Response(JSON.stringify(packageDocument), {
        headers: { 'content-type': 'application/json' },
      }),
  });
  const app = { ticker: new PIXI.Ticker() } as PIXI.Application;
  const figureContainer = new PIXI.Container();
  const live2dContainer = new Live2DFigureContainer();
  const model = Object.assign(new PIXI.Container(), {
    autoUpdate: true,
    deltaTime: 0,
    elapsedTime: 0,
    internalModel: Object.assign(new PIXI.utils.EventEmitter(), {
      destroyed: false,
      viewport: new Float32Array([0, 0, 1920, 1080]),
      width: 1920,
      height: 1080,
      localTransform: new PIXI.Matrix(),
      getDrawableIDs: () => ['head'],
      getDrawableIndex: (id: string) => (id === 'head' ? 0 : -1),
      getDrawableVertices: () => new Float32Array([0, 0, 1, 0, 0, 1]),
      update: () => {},
    }),
  });
  live2dContainer.addChild(model);
  figureContainer.addChild(live2dContainer);
  const runtime = new AttachmentRuntime({
    configLoader,
    textureLoader: async () => PIXI.Texture.EMPTY,
  });
  runtime.registerFigure({
    key: 'fig-center',
    generation: 'generation-1',
    sourcePath: modelPath,
    app,
    container: live2dContainer,
    model: model as never,
  });
  runtimeCleanups.push(() => {
    runtime.destroy();
    app.ticker.destroy();
    figureContainer.destroy({ children: true });
  });
  return runtime;
}

type ProfileSelectingLoad = (
  configId: string,
  observedModelPath?: string,
  modelProfileId?: string,
) => ReturnType<AttachmentProfileLoader['load']>;

describe('5L IR02 F04 stable adaptation/Profile identity', () => {
  it('R10 authored custom slot coexists with a hat; explicit headwear collision still fails in Runtime', async () => {
    const pack = await build('profile-a', 11);
    const runtime = runtimeFor(document(pack));
    const base = { figureKey: 'fig-center', configId: 'v2/f04-same-path', modelProfileId: 'profile-a', semanticAnchor: 'head', visible: true };
    const hat = await runtime.upsert({ ...base, attachmentId: 'hat', entityId: 'hat-entity', slot: 'headwear' });
    expect(hat.phase).toBe('ready');
    const gun = await runtime.upsert({ ...base, attachmentId: 'gun', entityId: 'gun-entity', slot: createBlankCreatorDraft(1234).slot });
    expect(gun.phase).toBe('ready');
    expect(() => runtime.upsert({ ...base, attachmentId: 'other-hat', entityId: 'other-hat-entity', slot: 'headwear' })).toThrow('ENTITY_SLOT_CONFLICT');
  });
  it('cold-restores two saved Profiles without figures and rejects missing or ambiguous identities', async () => {
    const a = await build('profile-a', 11);
    const both = await build('profile-b', 22, document(a).adaptations);
    const external = new ExternalStageObjectRegistry<IStageObject>();
    const stage = {
      figureContainer: new PIXI.Container(),
      isTransformTargetLocked: () => false,
      registerExternalStageObject: (object: IStageObject) => external.register(object),
      unregisterExternalStageObjectByUuid: (id: string) => external.unregisterByUuid(id),
      getExternalStageObjByUuid: (id: string) => external.getByUuid(id),
      getExternalStageObjByKey: (key: string) => external.getByKey(key),
    };
    const runtime = new AttachmentRuntime({
      configLoader: new AttachmentConfigLoader({ fetcher: async () => new Response(JSON.stringify(document(both))) }),
      textureLoader: async () => PIXI.Texture.EMPTY,
    });
    runtime.setStageHost(stage as never);
    runtimeCleanups.push(() => {
      runtime.destroy();
      stage.figureContainer.destroy({ children: true });
    });
    const snapshots = new Map<string, AttachmentInstanceSnapshot>();
    runtime.subscribe((event) => {
      if (event.type === 'instance-changed') snapshots.set(event.instance.entityId!, event.instance);
    });
    const local = initialLegacyAttachmentLocalVisualState(true);
    const free = (entityId: string, modelProfileId?: string): FreeAttachmentDeclaration => ({
      entityId,
      attachmentId: entityId,
      figureKey: 'fig-center',
      configId: 'v2/f04-same-path',
      modelProfileId,
      semanticAnchor: 'head',
      visible: true,
      lastAttachedLocalVisualState: local,
      visualState: { ...local, space: 'world' },
    });
    const valid = [free('free-a', 'profile-a'), free('free-b', 'profile-b')];
    await runtime.reconcile([], valid);
    expect(runtime.getDiagnostics()).toMatchObject({ figureCount: 0, frameDriverCount: 0, freeEntityCount: 2 });
    expect(snapshots.get('free-a')?.modelProfileId).toBe('profile-a');
    expect(snapshots.get('free-b')?.modelProfileId).toBe('profile-b');
    expect(external.getByKey('free-a')?.pixiContainer).not.toBe(external.getByKey('free-b')?.pixiContainer);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runtime.reconcile([], [...valid, free('ambiguous'), free('missing', 'profile-missing')]);
      expect(runtime.getDiagnostics().freeEntityCount).toBe(2);
      expect(runtime.getFreeRestoreDiagnostics().map(({ entityId, state }) => ({ entityId, state }))).toEqual([
        { entityId: 'ambiguous', state: 'error' },
        { entityId: 'missing', state: 'error' },
      ]);
      expect(stage.figureContainer.children).toHaveLength(2);
    } finally {
      error.mockRestore();
    }
  });
  it('selects same-path A and B explicitly and keeps their placement/cache entries separate', async () => {
    const a = await build('profile-a', 11);
    const both = await build('profile-b', 22, document(a).adaptations);
    const requests = { value: 0 };
    const loader = loaderFor(document(both), requests);
    const load = loader.load.bind(loader) as ProfileSelectingLoad;

    const selectedA = await load('v2/f04-same-path', modelPath, 'profile-a');
    const selectedB = await load('v2/f04-same-path', modelPath, 'profile-b');
    const selectedAAgain = await load('v2/f04-same-path', modelPath, 'profile-a');

    expect(selectedA.modelBinding?.modelProfileId).toBe('profile-a');
    expect(selectedA.config.placement.offset.x).toBe(11);
    expect(selectedB.modelBinding?.modelProfileId).toBe('profile-b');
    expect(selectedB.config.placement.offset.x).toBe(22);
    expect(selectedAAgain.config.placement.offset.x).toBe(11);
    expect(requests.value).toBe(2);
  });

  it('loads one attachment asset for two different character models with explicit Profiles', async () => {
    const a = await build('profile-a', 11);
    const both = await build('profile-b', 22, document(a).adaptations);
    const packageDocument = structuredClone(document(both));
    const targetModelPath = 'game/figure/tomori/casual-2023/model.json';
    const target = packageDocument.adaptations.find((row) => row.modelProfile.modelProfileId === 'profile-b')!;
    target.modelProfile.characterId = 'tomori';
    target.modelProfile.modelId = 'casual-2023';
    target.modelProfile.modelPath = targetModelPath;
    const loader = loaderFor(packageDocument);

    const sakiko = await loader.load('v2/f04-same-path', modelPath, 'profile-a');
    const tomori = await loader.load('v2/f04-same-path', targetModelPath, 'profile-b');

    expect(sakiko.modelBinding?.modelProfileId).toBe('profile-a');
    expect(tomori.modelBinding?.modelProfileId).toBe('profile-b');
    expect(sakiko.config.placement.offset.x).toBe(11);
    expect(tomori.config.placement.offset.x).toBe(22);
    expect(sakiko.config.layers).toEqual(tomori.config.layers);
  });

  it('selects an explicit Profile without relying on array order or an observed path', async () => {
    const a = await build('profile-a', 11);
    const both = await build('profile-b', 22, document(a).adaptations);
    const reversed = structuredClone(document(both));
    reversed.adaptations.reverse();
    const loader = loaderFor(reversed);
    const load = loader.load.bind(loader) as ProfileSelectingLoad;

    const selected = await load('v2/f04-same-path', undefined, 'profile-a');
    expect(selected.modelBinding?.modelProfileId).toBe('profile-a');
    expect(selected.config.placement.offset.x).toBe(11);
  });

  it('keeps an unselected legacy command compatible when the matching adaptation is unique', async () => {
    const only = await build('profile-a', 11);
    const selected = await loaderFor(document(only)).load('v2/f04-same-path', modelPath);
    expect(selected.modelBinding?.modelProfileId).toBe('profile-a');
    expect(selected.config.placement.offset.x).toBe(11);
  });

  it('rejects an omitted identity on the same-path A/B package with an actionable Profile hint', async () => {
    const a = await build('profile-a', 11);
    const both = await build('profile-b', 22, document(a).adaptations);
    const pending = loaderFor(document(both)).load('v2/f04-same-path', modelPath);
    await expect(pending).rejects.toMatchObject({ code: 'PRESET_MODEL_INCOMPATIBLE' });
    await expect(pending).rejects.toThrow(/profile/iu);
  });

  it('serializes the selected Profile into every Creator formal command surface', async () => {
    const result = await build('profile-b', 22);
    expect(result.commandSnippet).toContain(' -profile=profile-b ');
    expect(result.manifest.commandSnippet).toBe(result.commandSnippet);
    expect(creatorLifecycleScript(result.draft).split('\n')[0]).toBe(result.commandSnippet);
  });

  it('preserves the selected Profile through committed save sanitation and Runtime declarations', () => {
    const manager = new StageStateManager();
    manager.setStage('figName', modelPath);
    const visual = initialLegacyAttachmentLocalVisualState(true);
    const attachment: IAttachmentState & { entityId: string } = {
      figureKey: 'fig-center',
      attachmentId: 'hat',
      entityId: 'entity-hat',
      configId: 'v2/f04-same-path',
      modelProfileId: 'profile-b',
      semanticAnchor: 'head',
      visible: true,
    };
    const entity = {
      schemaVersion: 0,
      entityId: 'entity-hat',
      renderableKind: 'attachment-sprite-group',
      source: {
        configId: attachment.configId,
        modelProfileId: 'profile-b',
        legacyAlias: { originFigureKey: attachment.figureKey, attachmentId: attachment.attachmentId },
      },
      visualState: visual,
      attachmentLink: legacyAttachmentLink(attachment, visual),
    } as StageEntityStateV0;
    expect(
      manager.applyStageEntityTransaction({
        kind: 'upsert-explicit-attachment',
        attachment,
        entity,
      }).applied,
    ).toBe(true);
    manager.commit();

    const snapshot = createCommittedStageSnapshot(manager.getViewStageState());
    expect(snapshot.attachments[0].modelProfileId).toBe('profile-b');
    expect(snapshot.stageEntities[0].source.modelProfileId).toBe('profile-b');
    expect(attachmentDeclarationsFromStage(snapshot)[0].modelProfileId).toBe('profile-b');
  });

  it('drives the selected same-path Profile through the actual AttachmentRuntime and replaces A with B', async () => {
    const a = await build('profile-a', 11);
    const both = await build('profile-b', 22, document(a).adaptations);
    const runtime = runtimeFor(document(both));
    const declaration = {
      figureKey: 'fig-center',
      attachmentId: 'f04-runtime',
      entityId: 'f04-runtime-entity',
      configId: 'v2/f04-same-path',
      semanticAnchor: 'head',
      visible: true,
    };

    const selectedA = await runtime.upsert({ ...declaration, modelProfileId: 'profile-a' });
    if (selectedA.phase === 'error') throw new Error(selectedA.error);
    expect(selectedA).toMatchObject({
      phase: 'ready',
      modelProfileId: 'profile-a',
      modelBinding: { modelProfileId: 'profile-a' },
    });

    const selectedB = await runtime.upsert({ ...declaration, modelProfileId: 'profile-b' });
    if (selectedB.phase === 'error') throw new Error(selectedB.error);
    expect(selectedB).toMatchObject({
      phase: 'ready',
      modelProfileId: 'profile-b',
      modelBinding: { modelProfileId: 'profile-b' },
    });
    expect(runtime.get('fig-center', 'f04-runtime')).toMatchObject({
      modelProfileId: 'profile-b',
      modelBinding: { modelProfileId: 'profile-b' },
    });
  });
});
