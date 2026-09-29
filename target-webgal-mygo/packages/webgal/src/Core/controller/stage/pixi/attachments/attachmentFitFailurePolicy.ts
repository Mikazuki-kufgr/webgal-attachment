export const ATTACHMENT_TRANSIENT_FIT_FAILURE_LIMIT = 3;

/**
 * A single malformed Live2D frame must not permanently remove an otherwise
 * valid attachment. Structural errors still fail immediately; retryable fit
 * errors are tolerated for two frames and become terminal on the third
 * consecutive failure.
 */
export class AttachmentFitFailurePolicy {
  private consecutiveFailures = 0;

  public recordSuccess() {
    this.consecutiveFailures = 0;
  }

  public recordFailure(retryable: boolean) {
    this.consecutiveFailures += 1;
    return retryable && this.consecutiveFailures < ATTACHMENT_TRANSIENT_FIT_FAILURE_LIMIT;
  }

  public snapshot() {
    return {
      consecutiveFailures: this.consecutiveFailures,
      limit: ATTACHMENT_TRANSIENT_FIT_FAILURE_LIMIT,
    };
  }
}
