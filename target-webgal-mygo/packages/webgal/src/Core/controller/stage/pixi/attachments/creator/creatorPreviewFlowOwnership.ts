export class CreatorPreviewFlowOwnership {
  private revision = 0;

  public constructor(
    private readonly invalidatePending: () => void,
    private readonly isActive: () => boolean = () => true,
  ) {}

  public begin() {
    this.revision += 1;
    this.invalidatePending();
    return this.revision;
  }

  public isCurrent(revision: number) {
    return this.isActive() && revision === this.revision;
  }

  public async clear(clearAction: () => Promise<void>, expectedRevision?: number) {
    if (expectedRevision !== undefined && !this.isCurrent(expectedRevision)) return false;
    const clearRevision = this.begin();
    await clearAction();
    return this.isCurrent(clearRevision);
  }

  public currentRevision() {
    return this.revision;
  }
}
