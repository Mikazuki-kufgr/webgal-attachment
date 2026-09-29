const ATTACHMENT_LEAF = /^[\p{L}\p{N}][\p{L}\p{N}._（）()-]*$/u;

function validLeaf(value: string) {
  return ATTACHMENT_LEAF.test(value) && !value.includes('..');
}

/** Convert a file selected below game/attachments-v2 into a runtime config id. */
export function attachmentConfigIdFromSelectedFile(fileName: string) {
  const path = String(fileName || '').replace(/^\.\//, '');
  const portable = path.match(/^(?:portable\/)?([^/]+)\/attachment\.json$/i);
  if (portable && validLeaf(portable[1])) return `v2/${portable[1]}`;

  const legacy = path.match(/^presets\/([^/]+)\.json$/i);
  if (legacy && validLeaf(legacy[1])) return `v2/${legacy[1]}`;
  return null;
}
