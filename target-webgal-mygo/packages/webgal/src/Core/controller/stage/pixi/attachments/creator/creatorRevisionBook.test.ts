import { describe, expect, it } from 'vitest';
import { CreatorRevisionBook } from './creatorRevisionBook';
describe('per-target revision knowledge', () => {
  it('new technical identity expects no existing file', () =>
    expect(new CreatorRevisionBook().expected('A', 'new')).toBeNull());
  it('listing an existing row does not authorize overwrite', () => {
    const b = new CreatorRevisionBook();
    b.observe('A', 'p', 'r1');
    expect(() => b.expected('A', 'p')).toThrow('CREATOR_TARGET_REOPEN_REQUIRED');
  });
  it('explicit loaded revision permits only that target+preset', () => {
    const b = new CreatorRevisionBook();
    b.accept('A', 'p', 'r1');
    b.observe('B', 'p', 'r2');
    expect(b.expected('A', 'p')).toBe('r1');
    expect(() => b.expected('B', 'p')).toThrow('REOPEN_REQUIRED');
    expect(b.expected('A', 'q')).toBeNull();
  });
  it('background refresh cannot adopt a concurrent writer', () => {
    const b = new CreatorRevisionBook();
    b.accept('A', 'p', 'old');
    b.observe('A', 'p', 'new');
    expect(b.expected('A', 'p')).toBe('old');
  });
  it('unknown save response blocks retry even after list refresh', () => {
    const b = new CreatorRevisionBook();
    b.accept('A', 'p', 'old');
    b.markUncertain('A', 'p');
    b.observe('A', 'p', 'new');
    expect(() => b.expected('A', 'p')).toThrow('OUTCOME_UNKNOWN');
    b.accept('A', 'p', 'reopened');
    expect(b.expected('A', 'p')).toBe('reopened');
  });
  it('new target uncertain response cannot be treated as absent', () => {
    const b = new CreatorRevisionBook();
    b.markUncertain('A', 'p');
    expect(() => b.expected('A', 'p')).toThrow('OUTCOME_UNKNOWN');
  });
  it('rejects a missing accepted revision', () =>
    expect(() => new CreatorRevisionBook().accept('A', 'p', '')).toThrow('REVISION_MISSING'));
});
