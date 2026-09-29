import { AttachmentRuntime } from './AttachmentRuntime';

/** One Runtime for the committed-view bridge; command performers join in the next migration batch. */
export const attachmentRuntime = new AttachmentRuntime();
