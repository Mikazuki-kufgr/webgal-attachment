import { describe,it,expect } from 'vitest';
import {readableCreatorPresetId} from './creatorDraft';
import {layeredAttachmentPresetFileId} from '../profileLoader';
describe('human filenames keep runtime config identity safe',()=>{
 it('keeps Chinese names and short unique suffix in Runtime configs',()=>{const id=readableCreatorPresetId('草帽-祥子','custom-instance-a12345');expect(id).toBe('v2/草帽-祥子-a12345');expect(layeredAttachmentPresetFileId(id)).toBe('草帽-祥子-a12345');});
 it('sanitizes punctuation without exposing paths and rejects traversals in externally supplied IDs',()=>{const id=readableCreatorPresetId('../草帽/祥子:测试?','instance-123456');expect(layeredAttachmentPresetFileId(id)).not.toMatch(/[/:?]/);for(const bad of ['v2/../秘密','v2/草帽/秘密','v2/草帽%2f秘密','v2/草帽:stream'])expect(()=>layeredAttachmentPresetFileId(bad)).toThrow();});
 it('preserves supported old ASCII config IDs',()=>expect(layeredAttachmentPresetFileId('v2/custom-attachment-ual80zn-placement-v1')).toBe('custom-attachment-ual80zn-placement-v1'));
});
