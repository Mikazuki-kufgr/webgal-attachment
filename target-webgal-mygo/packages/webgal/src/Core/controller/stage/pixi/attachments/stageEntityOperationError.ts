export const STAGE_ENTITY_OPERATION_ERROR_CODES = [
  'ENTITY_NOT_FOUND',
  'ENTITY_ID_CONFLICT',
  'ENTITY_LEGACY_ALIAS_DUPLICATE',
  'ENTITY_STATE_INCOMPATIBLE',
  'ENTITY_PARENT_NOT_FOUND',
  'ENTITY_PARENT_LOADING_TIMEOUT',
  'ENTITY_PARENT_AMBIGUOUS',
  'ENTITY_PARENT_EXITING',
  'ENTITY_SLOT_CONFLICT',
  'ENTITY_ANCHOR_FRAME_UNAVAILABLE',
  'ENTITY_REPARENT_SINGULAR_MATRIX',
  'ENTITY_REPARENT_ATOMIC_ROLLBACK',
  'ENTITY_REATTACH_PARENT_NOT_READY',
  'ENTITY_SPACE_OVERRIDE_UNSUPPORTED',
  'ENTITY_TRANSITION_TARGET_LOST',
  'STAGE_ENTITY_OPERATION_FAILED',
] as const;

export type StageEntityOperationErrorCode = (typeof STAGE_ENTITY_OPERATION_ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(STAGE_ENTITY_OPERATION_ERROR_CODES);

export interface StageEntityOperationErrorDetails {
  entityId?: string;
  operation?: string;
  figureKey?: string;
  figureGeneration?: string;
  token?: string;
  reason?: string;
  [key: string]: unknown;
}

export class StageEntityOperationError extends Error {
  public readonly cause: unknown;

  public constructor(
    public readonly code: StageEntityOperationErrorCode,
    message: string,
    options: {
      cause?: unknown;
      details?: StageEntityOperationErrorDetails;
    } = {},
  ) {
    const stableMessage = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
    super(stableMessage, options.cause instanceof Error ? { cause: options.cause } : undefined);
    this.name = 'StageEntityOperationError';
    this.cause = options.cause;
    this.details = options.details ? { ...options.details } : undefined;
  }

  public readonly details?: StageEntityOperationErrorDetails;
}

export function isStageEntityOperationError(error: unknown): error is StageEntityOperationError {
  return (
    error instanceof StageEntityOperationError ||
    (error instanceof Error &&
      typeof (error as Error & { code?: unknown }).code === 'string' &&
      ERROR_CODE_SET.has((error as Error & { code: string }).code))
  );
}

function prefixedStableCode(message: string): StageEntityOperationErrorCode | undefined {
  const match = /^([A-Z][A-Z0-9_]+):/.exec(message);
  return match && ERROR_CODE_SET.has(match[1]) ? (match[1] as StageEntityOperationErrorCode) : undefined;
}

/**
 * Converts runtime/Pixi failures into the public Stage Entity diagnostic
 * contract. Known codes survive unchanged; unknown exceptions retain their
 * original cause under the explicit safe fallback.
 */
export function toStageEntityOperationError(
  error: unknown,
  fallbackCode: StageEntityOperationErrorCode = 'STAGE_ENTITY_OPERATION_FAILED',
  details?: StageEntityOperationErrorDetails,
): StageEntityOperationError {
  if (error instanceof StageEntityOperationError) {
    if (!details || Object.keys(details).length === 0) return error;
    return new StageEntityOperationError(error.code, error.message, {
      cause: error.cause,
      details: { ...error.details, ...details },
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  const structuralCode =
    error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
      ? (error as Error & { code: string }).code
      : undefined;
  const knownStructuralCode =
    structuralCode && ERROR_CODE_SET.has(structuralCode)
      ? (structuralCode as StageEntityOperationErrorCode)
      : undefined;
  const lowerMessage = message.toLowerCase();
  const reparentLike =
    lowerMessage.includes('reparent') ||
    lowerMessage.includes('preserve-world') ||
    lowerMessage.includes('target parent world transform');
  const reparentContext = reparentLike || fallbackCode.startsWith('ENTITY_REPARENT_');
  const inferredCode =
    knownStructuralCode ??
    prefixedStableCode(message) ??
    (reparentContext && (lowerMessage.includes('not invertible') || lowerMessage.includes('singular'))
      ? 'ENTITY_REPARENT_SINGULAR_MATRIX'
      : undefined) ??
    (reparentContext ||
    (error instanceof Error &&
      (error.name === 'ReparentPreserveWorldError' || 'rolledBack' in error || 'rollbackError' in error))
      ? 'ENTITY_REPARENT_ATOMIC_ROLLBACK'
      : fallbackCode);

  return new StageEntityOperationError(inferredCode, message, {
    cause: error,
    details,
  });
}

export function stageEntityOperationDiagnostic(error: StageEntityOperationError) {
  const cause = error.cause;
  return {
    code: error.code,
    message: error.message,
    ...(error.details ? { details: { ...error.details } } : {}),
    ...(cause !== undefined
      ? {
          cause: {
            name: cause instanceof Error ? cause.name : typeof cause,
            message: cause instanceof Error ? cause.message : String(cause),
          },
        }
      : {}),
  };
}
