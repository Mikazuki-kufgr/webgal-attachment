import { describe, expect, it } from 'vitest';
import SceneParser, { SCRIPT_CONFIG, ADD_NEXT_ARG_LIST } from '../src/index';
import { commandType } from '../src/interface/sceneInterface';
const parser = new SceneParser(() => {}, file => file, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG);
describe('321 extension multiline ABI', () => {
  it.each(['attachment', 'stageEntity'] as const)('%s consumes continuation args while retaining file lines', (command) => {
    const scene = parser.parse(`${command}:add -id=hat\n  -target=fig-left13\n  -duration=0;\nreturn:42;`, 'test', 'test.txt');
    expect(scene.sentenceList).toHaveLength(4);
    expect(scene.sentenceList[0]).toMatchObject({ command: commandType[command], startLine: 0, endLine: 2, isLineBreakHolder: false });
    expect(scene.sentenceList[0].args).toContainEqual({ key: 'target', value: 'fig-left13' });
    expect(scene.sentenceList[0].args).toContainEqual({ key: 'duration', value: 0 });
    expect(scene.sentenceList[1].isLineBreakHolder).toBe(true);
    expect(scene.sentenceList[2].isLineBreakHolder).toBe(true);
    expect(scene.sentenceList[3].command).toBe(commandType.return);
  });
});
