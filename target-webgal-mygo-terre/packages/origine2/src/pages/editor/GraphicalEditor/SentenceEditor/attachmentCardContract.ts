/** Script booleans are not JavaScript truthiness (notably the string "false"). */
export function attachmentCardBoolean(value: string | boolean | number) {
  return value === true || value === 'true';
}

/** Validate only fields this card owns; never rewrite unknown script arguments. */
export function attachmentCardError(
  action: string,
  actions: readonly string[],
  fields: string[],
  duration: string,
  ease: string,
) {
  if (!actions.includes(action)) return '未知操作：请在文本编辑器中检查，原语句未改变。';
  if (fields.some((value) => /[\s;\\]/.test(value))) return 'ID、配置和锚点不能含空白、分号或反斜杠；原语句未改变。';
  if (duration !== '' && (!duration.trim() || !Number.isFinite(Number(duration)) || Number(duration) < 0))
    return '过渡时间必须为非负有限数值；留空使用默认，0 表示瞬切。';
  if (ease && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(ease)) return '缓动类型无效；原语句未改变。';
  return '';
}
