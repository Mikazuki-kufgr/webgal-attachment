import { CreatorProjectRequestError } from './creatorProject';

export function creatorErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const lines = [`${error.name}: ${error.message}`];
  if (error instanceof CreatorProjectRequestError) {
    const { targetPath, cause, suggestion } = error.detail;
    if (targetPath && !error.message.includes(targetPath)) lines.push(`目标路径：${targetPath}`);
    if (cause && !error.message.includes(cause)) lines.push(`底层原因：${cause}`);
    if (suggestion && !error.message.includes(suggestion)) lines.push(`建议操作：${suggestion}`);
  }
  return lines.join('\n');
}
