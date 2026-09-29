export interface PerformContinuationSchedulerOptions {
  isBlocked: () => boolean;
  advance: () => void;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

/** One revocable internal continuation, even when several performs finish together. */
export class PerformContinuationScheduler {
  private revision = 0;
  private pending = false;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: PerformContinuationSchedulerOptions) {}

  public request() {
    if (this.pending) return false;
    this.pending = true;
    this.poll(++this.revision);
    return true;
  }

  public cancel() {
    this.revision += 1;
    this.pending = false;
    if (this.timeout !== undefined) {
      (this.options.cancel ?? clearTimeout)(this.timeout);
      this.timeout = undefined;
    }
  }

  public snapshot() {
    return { revision: this.revision, pending: this.pending, retryScheduled: this.timeout !== undefined };
  }

  private poll(revision: number) {
    if (!this.pending || revision !== this.revision) return;
    if (this.options.isBlocked()) {
      const schedule = this.options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
      this.timeout = schedule(() => {
        if (!this.pending || revision !== this.revision) return;
        this.timeout = undefined;
        this.poll(revision);
      }, 100);
      return;
    }
    this.pending = false;
    this.timeout = undefined;
    this.revision += 1;
    this.options.advance();
  }
}
