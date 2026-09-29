// Serializable Hotfix37 attachment contract. No renderer or persistence side effects.
export interface IAttachmentState {
  figureKey: string;
  attachmentId: string;
  entityId?: string;
  configId: string;
  /** Stable schema-v2 adaptation identity; absent on legacy saves/commands. */
  modelProfileId?: string;
  slot?: string;
  /** Absent only on saves created before legacy attachment anchors were persisted. */
  semanticAnchor?: string;
  visible: boolean;
}

export interface StageEntityVector2V0 {
  x: number;
  y: number;
}

export interface VisualStateV0 {
  space: 'local' | 'world';
  position: StageEntityVector2V0;
  scale: StageEntityVector2V0;
  rotation: number;
  skew?: StageEntityVector2V0;
  opacity: number;
  visible: boolean;
  appearance?: {
    blur: number;
    brightness: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
    color: { red: number; green: number; blue: number };
    bevel?: {
      strength: number;
      thickness: number;
      rotation: number;
      softness: number;
      color: { red: number; green: number; blue: number };
    };
    bloom?: { strength: number; brightness: number; blur: number; threshold: number };
    shockwave?: number;
    radiusAlpha?: number;
  };
}

export type AttachedLocalVisualStateV0 = VisualStateV0 & {
  space: 'local';
};

export interface AttachmentSpriteGroupSourceV0 {
  configId: string;
  /** Stable schema-v2 adaptation identity retained while attached or free. */
  modelProfileId?: string;
  slot?: string;
  /** Frozen native figure layout origin. Absent on legacy world-coordinate saves. */
  freePositionOrigin?: StageEntityVector2V0;
  /** Last committed local placement, retained while the entity is free. */
  lastAttachedLocalVisualState?: AttachedLocalVisualStateV0;
  legacyAlias?: {
    originFigureKey: string;
    attachmentId: string;
  };
}

export interface AttachmentLinkV0 {
  schemaVersion: 0;
  parentKind: 'figure';
  parentFigureKey: string;
  semanticAnchor: string;
  placementPresetId: string;
  inheritancePolicy: {
    transform: true;
    opacity: true;
    visibility: true;
  };
  attachedLocalVisualState: AttachedLocalVisualStateV0;
}

export interface StageEntityStateV0 {
  schemaVersion: 0;
  entityId: string;
  renderableKind: 'attachment-sprite-group';
  source: AttachmentSpriteGroupSourceV0;
  visualState: VisualStateV0;
  attachmentLink: AttachmentLinkV0 | null;
}
