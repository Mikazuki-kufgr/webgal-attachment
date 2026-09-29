import { describe, it, expect } from 'vitest';
import { CreatorNoticeOwnership } from './creatorNoticeOwnership';

describe('target model copy notice settlement', () => {
  it('retires the missing-model warning once its copy check succeeds', () => {
    const notices = new CreatorNoticeOwnership();
    notices.publish('game-A/model-A');
    expect(notices.resolve('game-A/model-A')).toBe(true);
    expect(notices.resolve('game-A/model-A')).toBe(false);
  });
  it('preserves a newer save error when an earlier model check succeeds', () => {
    const notices = new CreatorNoticeOwnership();
    notices.publish('game-A/model-A');
    notices.publish(); // foreground save failure is not owned by a model check
    expect(notices.resolve('game-A/model-A')).toBe(false);
  });
  it('does not clear the new target warning after switching model or game', () => {
    const notices = new CreatorNoticeOwnership();
    notices.publish('game-A/model-A');
    notices.publish('game-B/model-A');
    expect(notices.resolve('game-A/model-A')).toBe(false);
    expect(notices.resolve('game-B/model-A')).toBe(true);
  });
});
