import { describe, expect, it, vi } from 'vitest';

import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import { attachmentSemanticAnchorMatchesPreset, isAmbiguousUnversionedEyeAnchor } from '../semanticAnchorContract';
import type { Live2DModelProfile } from '../profileTypes';
import { buildCreatorPackage, creatorLifecycleScript } from './creatorPackageBuilder';
import { createBlankCreatorDraft } from './creatorDraft';
import { sha256Bytes } from './pngImport';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    sceneManager: { settledAssets: new Set<string>() },
    animationManager: { addAnimation: vi.fn() },
    readHistoryManager: { checkIsRead: vi.fn() },
    backlogManager: { saveCurrentStateToBacklog: vi.fn() },
    gameplay: { performController: undefined, isFastPreview: false },
    flowchartManager: { requestUnlockCurrentScene: vi.fn(), unlockPendingCurrentScene: vi.fn() },
    events: { textSettle: { emit: vi.fn() }, userInteractNext: { emit: vi.fn() } },
  },
}));
vi.mock('@/Core/util/prefetcher/assetsPrefetcher', () => ({ assetsPrefetcher: vi.fn() }));
vi.mock('@/Core/util/prefetcher/progressPrefetcher', () => ({ prefetchCurrentSceneByProgress: vi.fn() }));
vi.mock('@/Core/util/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/Core/initializeScript', () => ({ isIOS: false, initializeScript: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/PixiController', () => ({ default: class PixiStageCpuSeam {} }));
vi.mock('@/store/store', () => ({
  webgalStore: {
    getState: () => ({
      GUI: { showTitle: false },
      userData: { globalGameVar: {}, optionData: { textSpeed: 1, voiceInterruption: 1 } },
    }),
  },
}));
vi.mock('@/hooks/useTextOptions', () => ({ useTextDelay: () => 0, useTextAnimationDuration: () => 0 }));
vi.mock('@/Stage/TextBox/TextBox', () => ({ compileSentence: (text: string) => [text] }));
vi.mock('@/Core/gameScripts/vocal', () => ({ playVocal: vi.fn() }));

const { sceneParser } = await import('@/Core/parser/sceneParser');

const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MuoAAAAASUVORK5CYII='),
  (character) => character.charCodeAt(0),
);

function modelProfile(anchorName: string): Live2DModelProfile {
  return {
    schema: 'webgal-live2d-model-profile',
    schemaVersion: 1,
    profileVersion: 1,
    modelProfileId: 'creator-anchor-profile',
    characterId: 'anon',
    modelId: 'winter',
    modelPath: 'game/figure/anon/model.json',
    fingerprint: { modelJsonSha256: 'A'.repeat(64), drawableCount: 1 },
    anchors: [
      {
        name: anchorName,
        anchorProfileId: `creator-${anchorName}`,
        drawableId: 'anchor-drawable',
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

async function build(anchorName: string, profileAnchorName = anchorName) {
  const draft = createBlankCreatorDraft(1234);
  Object.assign(draft, {
    figureKey: 'creator-current-preview',
    figureGeneration: 'generation-1',
    modelProfileId: 'creator-anchor-profile',
    anchorName,
    presetId: 'v2/creator-anchor-fixture',
    attachmentDefinitionId: 'creator-anchor-asset',
    attachmentInstanceId: 'creator-anchor-instance',
    displayName: '锚点序列化夹具',
  });
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
  const result = await buildCreatorPackage({
    draft,
    profile: modelProfile(profileAnchorName),
    front: { bytes: png, metadata },
    createdAt: '2026-09-10T00:00:00Z',
  });
  return { draft, result };
}

function argument(sentence: ISentence, key: string) {
  return sentence.args.find((candidate) => candidate.key === key)?.value;
}

describe('5L IR02 F03 Creator formal command anchor serialization', () => {
  it.each([
    ['mouth', 'mouth'],
    ['head', 'head'],
    ['eye-center-left', 'eye-center-left'],
    ['user.a-pony-tail', 'user.a-pony-tail'],
  ])(
    'keeps %s explicit and equal across package, lifecycle, manifest, parser and Runtime contract',
    async (draftAnchor) => {
      const { draft, result } = await build(draftAnchor);
      const addSentence = sceneParser(
        result.commandSnippet,
        'creator-formal-command',
        './game/scene/creator-formal-command.txt',
      ).sentenceList[0];

      expect(result.preset.anchorName).toBe(draftAnchor);
      expect(result.resolvedConfig.modelBinding.anchorName).toBe(draftAnchor);
      expect(result.commandSnippet).toContain(`-anchor=${draftAnchor}`);
      expect(result.manifest.commandSnippet).toBe(result.commandSnippet);
      expect(creatorLifecycleScript(draft).split('\n')[0]).toBe(result.commandSnippet);
      expect(addSentence.command).toBe(commandType.attachment);
      expect(argument(addSentence, 'anchor')).toBe(draftAnchor);
      expect(
        attachmentSemanticAnchorMatchesPreset(
          String(argument(addSentence, 'anchor')),
          result.resolvedConfig.modelBinding.anchorName,
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['left-eye', 'eyelid-upper-left'],
    ['right-eye', 'eyelid-upper-right'],
  ])('migrates legacy %s to unambiguous schema-v2 %s in every formal output', async (legacyAnchor, canonicalAnchor) => {
    const { draft, result } = await build(legacyAnchor, canonicalAnchor);
    const addSentence = sceneParser(
      result.commandSnippet,
      'creator-legacy-anchor',
      './game/scene/creator-legacy-anchor.txt',
    ).sentenceList[0];

    expect(result.preset.anchorName).toBe(canonicalAnchor);
    expect(result.resolvedConfig.modelBinding.anchorName).toBe(canonicalAnchor);
    expect(result.commandSnippet).toContain(`-anchor=${canonicalAnchor}`);
    expect(result.commandSnippet).not.toContain(`-anchor=${legacyAnchor}`);
    expect(result.manifest.anchorName).toBe(canonicalAnchor);
    expect(result.manifest.commandSnippet).toBe(result.commandSnippet);
    expect(creatorLifecycleScript(draft).split('\n')[0]).toBe(result.commandSnippet);
    expect(argument(addSentence, 'anchor')).toBe(canonicalAnchor);
  });

  it('keeps the Runtime mismatch gate strict for missing/default head and ambiguous legacy eye requests', async () => {
    const { result } = await build('mouth');
    expect(attachmentSemanticAnchorMatchesPreset('head', result.resolvedConfig.modelBinding.anchorName)).toBe(false);
    expect(isAmbiguousUnversionedEyeAnchor('left-eye')).toBe(true);
    expect(attachmentSemanticAnchorMatchesPreset('left-eye', 'eye-center-left')).toBe(false);
  });
});
