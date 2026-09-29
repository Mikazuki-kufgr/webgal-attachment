/** Only a service-managed independent verification scene may be selected by this entry. */
export function creatorPreviewSceneName(search: string) {
  const names = new URLSearchParams(search).getAll('scene');
  const name = names[0];
  if (
    names.length !== 1 ||
    !/^ATTACHMENT-CREATOR-PREVIEW-[a-z0-9][a-z0-9._-]{0,159}\.txt$/.test(name) ||
    name.includes('..')
  )
    throw new Error('CREATOR_PREVIEW_SCENE_INVALID');
  return name;
}

export async function startCreatorGeneratedScene(
  scene: string,
  ports: {
    waitUntilLive2DReady(): Promise<boolean>;
    enterGame(): void;
    changeScene(url: string, name: string): Promise<boolean>;
  },
) {
  // Validate again at the execution boundary; no unchecked URL reaches sceneFetcher.
  const name = creatorPreviewSceneName('?scene=' + encodeURIComponent(scene));
  if (!(await ports.waitUntilLive2DReady())) throw new Error('CREATOR_LIVE2D_NOT_READY');
  ports.enterGame();
  if (!(await ports.changeScene(`./game/scene/${name}`, name))) throw new Error('CREATOR_PREVIEW_SCENE_LOAD_FAILED');
  return name;
}
