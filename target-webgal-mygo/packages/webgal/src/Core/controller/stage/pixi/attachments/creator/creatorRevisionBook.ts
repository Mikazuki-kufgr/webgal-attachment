/** Revision knowledge belongs to one workspace+stable preset, never just the current dropdown. */
export class CreatorRevisionBook {
  private readonly known = new Map<string, string>();
  private readonly existing = new Set<string>();
  private readonly uncertain = new Set<string>();
  private key(project: string, preset: string) {
    return JSON.stringify([project, preset]);
  }

  observe(project: string, preset: string, revision: string) {
    const key = this.key(project, preset);
    // A list is not permission to overwrite that target with an unrelated draft.
    if (revision) this.existing.add(key);
  }
  accept(project: string, preset: string, revision: string) {
    if (!revision) throw new Error('CREATOR_REVISION_MISSING');
    const key = this.key(project, preset);
    this.known.set(key, revision);
    this.existing.add(key);
    this.uncertain.delete(key);
  }
  expected(project: string, preset: string) {
    const key = this.key(project, preset);
    if (this.uncertain.has(key)) throw new Error('CREATOR_SAVE_OUTCOME_UNKNOWN：请先重新打开该附件核对结果，再保存。');
    if (this.existing.has(key) && !this.known.has(key)) {
      throw new Error(
        'CREATOR_TARGET_REOPEN_REQUIRED：目标已有同 ID 附件，请先打开该目标的附件核对后再保存；不会覆盖。',
      );
    }
    return this.known.get(key) ?? null;
  }
  markUncertain(project: string, preset: string) {
    this.uncertain.add(this.key(project, preset));
  }
  confirmAbsent(project: string, preset: string) {
    const key = this.key(project, preset);
    this.uncertain.delete(key); this.known.delete(key); this.existing.delete(key);
  }
}
