export interface ExternalStageObjectIdentity {
  key: string;
  uuid: string;
}

export type ExternalStageObjectBeforeUnregister<T extends ExternalStageObjectIdentity> = (
  stageObject: T,
) => void;

/**
 * Runtime-only registry for transform targets that are not figures,
 * backgrounds, or the main stage object. The unregister hook runs before
 * either index is changed so callers can settle/cancel target-owned work
 * while the object is still addressable through the combined stage lookup.
 */
export class ExternalStageObjectRegistry<T extends ExternalStageObjectIdentity> {
  private readonly byKey = new Map<string, T>();
  private readonly byUuid = new Map<string, T>();

  public constructor(
    private readonly beforeUnregister?: ExternalStageObjectBeforeUnregister<T>,
  ) {}

  public register(stageObject: T): T {
    if (!stageObject.key) throw new TypeError('External stage object key must not be empty');
    if (!stageObject.uuid) throw new TypeError('External stage object uuid must not be empty');

    const keyMatch = this.byKey.get(stageObject.key);
    const uuidMatch = this.byUuid.get(stageObject.uuid);
    if (keyMatch === stageObject && uuidMatch === stageObject) return stageObject;
    if (keyMatch) {
      throw new Error(`External stage object key is already registered: ${stageObject.key}`);
    }
    if (uuidMatch) {
      throw new Error(`External stage object uuid is already registered: ${stageObject.uuid}`);
    }

    this.byKey.set(stageObject.key, stageObject);
    this.byUuid.set(stageObject.uuid, stageObject);
    return stageObject;
  }

  public unregisterByKey(key: string): T | undefined {
    const stageObject = this.byKey.get(key);
    return stageObject ? this.unregister(stageObject) : undefined;
  }

  public unregisterByUuid(uuid: string): T | undefined {
    const stageObject = this.byUuid.get(uuid);
    return stageObject ? this.unregister(stageObject) : undefined;
  }

  public getByKey(key: string): T | undefined {
    return this.byKey.get(key);
  }

  public getByUuid(uuid: string): T | undefined {
    return this.byUuid.get(uuid);
  }

  public getAll(): T[] {
    return [...this.byKey.values()];
  }

  private unregister(stageObject: T): T {
    this.beforeUnregister?.(stageObject);
    this.byKey.delete(stageObject.key);
    this.byUuid.delete(stageObject.uuid);
    return stageObject;
  }
}
