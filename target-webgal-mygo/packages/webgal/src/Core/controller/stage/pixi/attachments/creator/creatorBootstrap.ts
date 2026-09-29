export interface CreatorVisualConfiguration {
  stageWidth?: number;
  stageHeight?: number;
  positioningType?: 'M_2_3' | 'M_2_4' | 'M_3_0_0' | 'M_3_1_0';
  legacyExpressionBlendMode?: boolean;
  autoRotate?: boolean;
}

/** Use the native parser, but not infoFetcher: it loads/writes game saves and initializes Steam/flowchart. */
export function creatorVisualConfiguration(
  entries: readonly { command: string; args: readonly string[] }[],
): CreatorVisualConfiguration {
  const result: CreatorVisualConfiguration = {};
  for (const entry of entries) {
    if (entry.args.length !== 1) continue;
    const raw = entry.args[0].trim();
    if (entry.command === 'Stage_Width' || entry.command === 'Stage_Height') {
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value <= 0) throw new Error('CREATOR_STAGE_SIZE_INVALID');
      result[entry.command === 'Stage_Width' ? 'stageWidth' : 'stageHeight'] = value;
    } else if (entry.command === 'Legacy_Expression_Blend_Mode') {
      result.legacyExpressionBlendMode = raw === 'true';
    } else if (entry.command === 'Auto_Rotate') {
      result.autoRotate = raw !== 'false';
    } else if (entry.command === 'Positioning_Type') {
      result.positioningType = ['W_4_5_12', 'M_2_3'].includes(raw)
        ? 'M_2_3'
        : ['W_4_5_13', 'M_2_4', 'M_2_5'].includes(raw)
        ? 'M_2_4'
        : ['BC_1_0_0', 'M_3_0_0'].includes(raw)
        ? 'M_3_0_0'
        : 'M_3_1_0';
    }
  }
  return result;
}

export interface CreatorBootstrapPorts {
  readConfig(): Promise<unknown>;
  parseConfig(text: string): readonly { command: string; args: readonly string[] }[];
  configure(config: CreatorVisualConfiguration): void;
  initializeStage(): void;
  releaseRenderGate(): void;
  mountWorkbench(): Promise<void>;
  reportFailure(error: unknown): void;
}

/** Production and tests share this ordering; no narrative/storage/editor-sync ports exist here. */
export async function bootstrapCreatorRuntime(ports: CreatorBootstrapPorts) {
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      ports.releaseRenderGate();
    }
  };
  try {
    const text = await ports.readConfig();
    if (typeof text !== 'string') throw new Error('CREATOR_CONFIG_INVALID');
    ports.configure(creatorVisualConfiguration(ports.parseConfig(text)));
    ports.initializeStage();
    release();
    await ports.mountWorkbench();
  } catch (error) {
    try {
      release();
    } finally {
      ports.reportFailure(error);
    }
    throw error;
  }
}
