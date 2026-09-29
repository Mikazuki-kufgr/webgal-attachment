/** The same document identity must be used by the editor and its save status. */
export function editorDocumentPath(gameDir: string, tagPath: string): string {
  const base = `games/${gameDir}/game/`;
  return tagPath.startsWith(base) ? tagPath : base + tagPath;
}
