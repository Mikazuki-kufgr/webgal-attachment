import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Run the actual workbench transaction guard with only the DOM and model load
// substituted. Rendering and Live2D visual behavior remain a GUI check.
const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8');
const ast = ts.createSourceFile('AttachmentCreatorWorkbench.ts', source, ts.ScriptTarget.Latest, true);
const bodies: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['switchSelectedLibraryFigure', 'restoreCommittedLibrarySelection'].includes(node.name?.text ?? ''))
    bodies.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const js = ts.transpileModule(bodies.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function harness(options: { dirty?: boolean; confirm?: boolean; pending?: boolean; load?: boolean; cleared?: boolean;
  busy?: boolean; liveMissing?: boolean } = {}) {
  const previous = { modelProfileId: 'old', characterId: 'old-character', modelPath: 'old/model.json' };
  const target = { modelProfileId: 'next', characterId: 'next-character', modelPath: 'next/model.json' };
  const calls: Array<[string, unknown]> = [];
  const switchButton = { disabled: false };
  const env: any = {
    profiles: new Map([['old', previous], ['next', target]]),
    draft: { modelProfileId: 'old', figureKey: 'authoring-model', figureGeneration: 'g1' },
    WebGAL: { gameplay: { pixiStage: { getActiveLive2DFigure: () => options.liveMissing
      ? { status: 'absent' } : { status: 'ready', figure: { normalizedSourceUrl: 'old/model.json', uuid: 'g1' } } } } },
    runtime: { figureGeneration: () => 'g1' },
    libraryProfileField: { select: { value: 'next' } },
    characterField: { select: { value: 'next-character' } },
    binaries: { front: {} },
    activeBusyControl: options.busy ? switchButton : undefined,
    showLibraryProfileButton: switchButton,
    queuedLibraryProfileId: '',
    queuedLibraryDiscardApproved: false,
    libraryFigureSwitchRevision: 0,
    cancelCreatorFigureReplacement: () => calls.push(['cancel', true]),
    pendingSave: options.pending ? {} : undefined,
    destroyed: false,
    selectedFigure: () => ({ state: 'ready', modelPath: 'old/model.json', generation: 'g1' }),
    profileMatchesModelPath: (p: typeof previous, modelPath: string) => p.modelPath === modelPath,
    readDraftInputs: () => calls.push(['read', true]),
    attachmentDirty: () => options.dirty ?? false,
    window: { confirm: () => { calls.push(['confirm', true]); return options.confirm ?? false; } },
    showSelectedLibraryFigure: async (_allow: boolean, profile: typeof target, _anchor: unknown, discard: boolean,
      onCleared?: () => void) => {
      calls.push(['load', [profile.modelProfileId, discard]]);
      if (options.cleared) onCleared?.();
      return options.load ?? true;
    },
    beginPreviewFlow: () => { calls.push(['invalidate', true]); return 2; },
    cloneCreatorDraft: structuredClone,
    bindPreview: async () => { calls.push(['preview', 'restored']); return true; },
    syncCharacterSelection: (profile: typeof previous) => {
      env.characterField.select.value = profile.characterId;
      env.libraryProfileField.select.value = profile.modelProfileId;
      calls.push(['restore', profile.modelProfileId]);
    },
    renderLibraryProfiles: () => {},
    updateTargetAvailability: () => {
      switchButton.disabled = Boolean(env.activeBusyControl || env.libraryFigureSwitchInProgress);
      calls.push(['availability', switchButton.disabled]);
    },
    errorMessage: (error: Error) => error.message,
    setStatus: () => {},
  };
  const functions = new Function('env', 'with(env){' + js + ';return {switchSelectedLibraryFigure};}')(env);
  return { env, calls, switchFigure: functions.switchSelectedLibraryFigure as () => Promise<void> };
}

describe('ordinary role and outfit switch guard', () => {
  it('cancel restores the committed selectors and never starts the model load', async () => {
    const h = harness({ dirty: true, confirm: false });
    await h.switchFigure();
    expect(h.calls).toContainEqual(['restore', 'old']);
    expect(h.calls.some(([name]) => name === 'load')).toBe(false);
    expect(h.env.libraryProfileField.select.value).toBe('old');
  });
  it('confirmed discard is passed into the model switch; a failed switch restores selectors', async () => {
    const h = harness({ dirty: true, confirm: true, load: false });
    await h.switchFigure();
    expect(h.calls).toContainEqual(['load', ['next', true]]);
    expect(h.calls).toContainEqual(['restore', 'old']);
  });
  it('an unmodified draft loads without a prompt; uncertain save blocks the switch', async () => {
    const clean = harness();
    await clean.switchFigure();
    expect(clean.calls).toContainEqual(['load', ['next', false]]);
    expect(clean.calls.some(([name]) => name === 'confirm')).toBe(false);
    const pending = harness({ pending: true });
    await pending.switchFigure();
    expect(pending.calls).toContainEqual(['restore', 'old']);
    expect(pending.calls.some(([name]) => name === 'load')).toBe(false);
  });
  it('restores an old attachment preview when replacement cleared it but did not commit', async () => {
    const h = harness({ load: false, cleared: true });
    await h.switchFigure();
    expect(h.calls).toContainEqual(['preview', 'restored']);
  });
  it('queues the latest outfit and invalidates the in-flight replacement', async () => {
    const h = harness({ busy: true });
    await h.switchFigure();
    expect(h.env.queuedLibraryProfileId).toBe('next');
    expect(h.calls).toContainEqual(['cancel', true]);
    expect(h.calls.some(([name]) => name === 'load')).toBe(false);
  });
  it('keeps the current load alive when a later dirty switch is canceled', async () => {
    const h = harness({ busy: true, dirty: true, confirm: false });
    await h.switchFigure();
    expect(h.calls).toContainEqual(['confirm', true]);
    expect(h.calls).toContainEqual(['restore', 'old']);
    expect(h.env.queuedLibraryProfileId).toBe('');
    expect(h.calls.some(([name]) => name === 'cancel' || name === 'invalidate')).toBe(false);
  });
  it('blocks an uncertain save before aborting an in-flight load', async () => {
    const h = harness({ busy: true, pending: true });
    await h.switchFigure();
    expect(h.env.queuedLibraryProfileId).toBe('');
    expect(h.calls.some(([name]) => name === 'cancel' || name === 'invalidate')).toBe(false);
  });
  it('records dirty-switch approval before aborting an in-flight load', async () => {
    const h = harness({ busy: true, dirty: true, confirm: true });
    await h.switchFigure();
    expect(h.env.queuedLibraryProfileId).toBe('next');
    expect(h.env.queuedLibraryDiscardApproved).toBe(true);
    expect(h.calls).toContainEqual(['cancel', true]);
  });
  it('does not trust a cached ready figure after replacement removed the live owner', async () => {
    const h = harness({ liveMissing: true });
    h.env.libraryProfileField.select.value = 'old';
    await h.switchFigure();
    expect(h.calls).toContainEqual(['load', ['old', false]]);
  });
  it('reenables retry after both target load and automatic rollback fail', async () => {
    const h = harness({ load: false, liveMissing: true });
    h.env.commitProfileFigure = async () => {
      h.env.libraryFigureSwitchInProgress = true;
      h.env.updateTargetAvailability();
      h.env.libraryFigureSwitchInProgress = false;
      throw new Error('CREATOR_LIBRARY_FIGURE_READY_TIMEOUT:authoring-model');
    };
    await h.switchFigure();
    expect(h.env.libraryProfileField.select.value).toBe('old');
    expect(h.calls).toContainEqual(['availability', true]);
    expect(h.calls.at(-1)).toEqual(['availability', false]);
    expect(h.env.showLibraryProfileButton.disabled).toBe(false);
  });
});
