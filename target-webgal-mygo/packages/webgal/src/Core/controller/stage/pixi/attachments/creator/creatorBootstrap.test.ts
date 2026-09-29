import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCreatorRuntime, creatorVisualConfiguration, type CreatorBootstrapPorts } from './creatorBootstrap';

function fixture() {
  const events: string[] = [];
  const ports: CreatorBootstrapPorts = {
    readConfig: vi.fn(async () => {
      events.push('read');
      return 'Stage_Width:1920;';
    }),
    parseConfig: vi.fn(() => {
      events.push('parse');
      return [{ command: 'Stage_Width', args: ['1920'] }];
    }),
    configure: vi.fn(() => {
      events.push('configure');
    }),
    initializeStage: vi.fn(() => {
      events.push('stage');
    }),
    releaseRenderGate: vi.fn(() => {
      events.push('render');
    }),
    mountWorkbench: vi.fn(async () => {
      events.push('workbench');
    }),
    reportFailure: vi.fn(() => {
      events.push('failure');
    }),
  };
  return { ports, events };
}
describe('5H isolated production Creator bootstrap', () => {
  it('configures the real host ports before opening the workbench and resolves the render gate once', async () => {
    const f = fixture();
    await bootstrapCreatorRuntime(f.ports);
    expect(f.events).toEqual(['read', 'parse', 'configure', 'stage', 'render', 'workbench']);
    expect(f.ports.configure).toHaveBeenCalledWith({ stageWidth: 1920 });
    expect(f.ports.reportFailure).not.toHaveBeenCalled();
  });
  it('bad config cannot initialize stage but still releases rendering to show the failure', async () => {
    const f = fixture();
    f.ports.readConfig = async () => ({ unexpected: 'json' });
    await expect(bootstrapCreatorRuntime(f.ports)).rejects.toThrow('CREATOR_CONFIG_INVALID');
    expect(f.ports.initializeStage).not.toHaveBeenCalled();
    expect(f.events).toEqual(['render', 'failure']);
  });
  it('network/config read failure is explicit and does not mount an empty success UI', async () => {
    const f = fixture();
    f.ports.readConfig = async () => {
      throw new Error('config unavailable');
    };
    await expect(bootstrapCreatorRuntime(f.ports)).rejects.toThrow('config unavailable');
    expect(f.ports.mountWorkbench).not.toHaveBeenCalled();
    expect(f.events).toEqual(['render', 'failure']);
  });
  it('Pixi creation failure prevents mounting and reports the original cause', async () => {
    const f = fixture();
    f.ports.initializeStage = () => {
      throw new Error('no WebGL');
    };
    await expect(bootstrapCreatorRuntime(f.ports)).rejects.toThrow('no WebGL');
    expect(f.ports.mountWorkbench).not.toHaveBeenCalled();
    expect(f.ports.releaseRenderGate).toHaveBeenCalledTimes(1);
  });
  it('dynamic workbench import failure is not swallowed or reported as initialized', async () => {
    const f = fixture();
    f.ports.mountWorkbench = async () => {
      throw new Error('chunk unavailable');
    };
    await expect(bootstrapCreatorRuntime(f.ports)).rejects.toThrow('chunk unavailable');
    expect(f.ports.releaseRenderGate).toHaveBeenCalledTimes(1);
    expect(f.ports.reportFailure).toHaveBeenCalledTimes(1);
  });
  it('ignores Game_key, Steam, history and arbitrary variables in Creator config', () => {
    expect(
      creatorVisualConfiguration([
        { command: 'Game_key', args: ['user-game'] },
        { command: 'Steam_AppID', args: ['1234'] },
        { command: 'Enable_flowchart', args: ['true'] },
        { command: 'Custom', args: ['value'] },
        { command: 'Stage_Height', args: ['1080'] },
        { command: 'Legacy_Expression_Blend_Mode', args: ['true'] },
        { command: 'Auto_Rotate', args: ['false'] },
      ]),
    ).toEqual({ stageHeight: 1080, legacyExpressionBlendMode: true, autoRotate: false });
  });
  it.each([
    ['W_4_5_12', 'M_2_3'],
    ['M_2_3', 'M_2_3'],
    ['W_4_5_13', 'M_2_4'],
    ['M_2_4', 'M_2_4'],
    ['M_2_5', 'M_2_4'],
    ['BC_1_0_0', 'M_3_0_0'],
    ['M_3_0_0', 'M_3_0_0'],
    ['M_3_1_0', 'M_3_1_0'],
    ['unknown', 'M_3_1_0'],
  ])('preserves native positioning mapping %s to %s', (input, expected) => {
    expect(creatorVisualConfiguration([{ command: 'Positioning_Type', args: [input] }]).positioningType).toBe(expected);
  });
  it.each(['0', '-1', '', 'NaN', 'Infinity'])('rejects unsafe stage dimension %j', (value) => {
    expect(() => creatorVisualConfiguration([{ command: 'Stage_Width', args: [value] }])).toThrow(
      'CREATOR_STAGE_SIZE_INVALID',
    );
  });
  it('keeps multi-argument config native semantics instead of interpreting it as one scalar', () => {
    expect(creatorVisualConfiguration([{ command: 'Stage_Width', args: ['1920', '1080'] }])).toEqual({});
  });
  it('source boundary: explicit build flag returns before original story/storage/editor initialization', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/Core/initializeScript.ts'), 'utf8');
    const start = source.indexOf('if (creatorBundle || previewBundle)');
    const end = source.indexOf("const initialMutation = beginSceneMutation('initialize')");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const creator = source.slice(start, end);
    expect(creator).toContain('return;');
    expect(creator).toContain('installAttachmentCreatorWorkbench(attachmentRuntime)');
    expect(creator).toContain('new PixiStage()');
    expect(creator).toContain('syncPixiStageState(stageState, options)');
    for (const forbidden of [
      'sceneFetcher(',
      'startPreviewSyncRuntime(',
      'infoFetcher(',
      'autoFastSaveGame(',
      'setStorage(',
      'startGame(',
      'sceneParser(',
    ])
      expect(creator, forbidden).not.toContain(forbidden);
    expect(source.slice(end)).toContain("await infoFetcher('./game/config.txt')");
    expect(source.slice(end)).toContain('if (options.notifyReact) autoFastSaveGame()');
    expect(source.slice(end)).toContain('startPreviewSyncRuntime()');
  });
});
