import { Input } from '@fluentui/react-components';
import { t } from '@lingui/macro';
import TerreToggle from '@/components/terreToggle/TerreToggle';
import { useEaseTypeOptions } from '@/hooks/useEaseTypeOptions';
import { useValue } from '@/hooks/useValue';
import { combineSubmitString } from '@/utils/combineSubmitString';
import { attachmentCardBoolean, attachmentCardError } from './attachmentCardContract';
import CommonOptions from '../components/CommonOption';
import CommonTips from '../components/CommonTips';
import WheelDropdown from '../components/WheelDropdown';
import { getArgByKey } from '../utils/getArgByKey';
import { ISentenceEditorProps } from './index';
import { stageEntityActionPolicy, type StageEntityAction } from './attachmentActionPolicy';
import styles from './sentenceEditor.module.scss';

export default function StageEntity(props: ISentenceEditorProps) {
  const action = useValue<StageEntityAction>((props.sentence.content || 'detach') as StageEntityAction);
  const entity = useValue(String(getArgByKey(props.sentence, 'entity') || 'attachment-entity-1'));
  const figure = useValue(String(getArgByKey(props.sentence, 'figure') || 'fig-center'));
  const anchor = useValue(String(getArgByKey(props.sentence, 'anchor') || 'head'));
  const coordinates = useValue(String(getArgByKey(props.sentence, 'coordinates') || 'figure'));
  const profile = useValue(String(getArgByKey(props.sentence, 'profile') || ''));
  const duration = useValue(String(getArgByKey(props.sentence, 'duration')));
  const ease = useValue(String(getArgByKey(props.sentence, 'ease') || ''));
  const runContinue = useValue(attachmentCardBoolean(getArgByKey(props.sentence, 'continue')));
  const error = useValue('');
  const easeOptions = useEaseTypeOptions();
  const actionOptions = new Map<StageEntityAction, string>([
    ['detach', t`从立绘分离`],
    ['reattach', t`重新附着到立绘`],
    ['hide', t`隐藏舞台实体`],
    ['show', t`显示舞台实体`],
    ['remove', t`移除舞台实体`],
  ]);
  const { hasTransition, isAsync } = stageEntityActionPolicy(action.value);

  const submit = () => {
    // WheelDropdown mutates action and submits in one event. Derive dependent
    // arguments from the post-set value so obsolete duration/ease/continue
    // fields cannot leak from the previous action into the saved sentence.
    const currentAction = action.value;
    const currentPolicy = stageEntityActionPolicy(currentAction);
    const validation = attachmentCardError(
      currentAction,
      ['detach', 'reattach', 'hide', 'show', 'remove'],
      [entity.value, ...(currentPolicy.acceptsAttachmentTarget ? [figure.value, profile.value, anchor.value] : [])],
      currentPolicy.hasTransition ? duration.value : '',
      currentPolicy.hasTransition ? ease.value : '',
    );
    error.set(validation);
    if (validation) return;
    props.onSubmit(
      combineSubmitString(
        props.sentence.commandRaw,
        currentAction,
        props.sentence.args,
        [
          { key: 'entity', value: entity.value },
          { key: 'coordinates', value: currentAction === 'detach' ? coordinates.value : '' },
          { key: 'figure', value: currentPolicy.acceptsAttachmentTarget ? figure.value : '' },
          { key: 'profile', value: currentPolicy.acceptsAttachmentTarget ? profile.value : '' },
          { key: 'anchor', value: currentPolicy.acceptsAttachmentTarget ? anchor.value : '' },
          { key: 'duration', value: currentPolicy.hasTransition ? duration.value : '' },
          { key: 'ease', value: currentPolicy.hasTransition ? ease.value : '' },
          { key: 'continue', value: currentPolicy.isAsync ? runContinue.value : false },
          // Only the two async reparent commands forbid next; visibility/remove keep explicit next.
          ...(currentAction === 'detach' || currentAction === 'reattach' ? [{ key: 'next', value: false }] : []),
        ],
        props.sentence.inlineComment,
      ),
    );
  };

  return (
    <div className={styles.sentenceEditorContent}>
      {error.value && <div role="alert">{error.value}</div>}
      <div className={styles.editItem}>
        <CommonOptions title={t`舞台实体操作`}>
          <WheelDropdown
            options={actionOptions}
            value={action.value}
            onValueChange={(value) => {
              action.set((value || 'detach') as StageEntityAction);
              submit();
            }}
          />
        </CommonOptions>
        <CommonOptions title={t`实体 ID`}>
          <Input
            value={entity.value}
            placeholder="sakiko-hat"
            onChange={(_, data) => entity.set(data.value)}
            onBlur={submit}
          />
        </CommonOptions>
        {action.value === 'detach' && (
          <CommonOptions title={t`自由坐标`}>
            <WheelDropdown
              options={
                new Map([
                  ['figure', t`与立绘一致`],
                  ['world', t`旧版舞台绝对坐标`],
                ])
              }
              value={coordinates.value}
              onValueChange={(value) => {
                coordinates.set(value || 'figure');
                submit();
              }}
            />
          </CommonOptions>
        )}
        {action.value === 'reattach' && (
          <>
            <CommonOptions title={t`目标立绘 ID`}>
              <Input
                value={figure.value}
                placeholder="fig-center / 自定义立绘 ID"
                onChange={(_, data) => figure.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonOptions title={t`目标模型适配 Profile（可选）`}>
              <Input
                value={profile.value}
                placeholder="同模型切换适配时填写；否则沿用或按目标模型唯一匹配"
                onChange={(_, data) => profile.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonOptions title={t`目标语义锚点`}>
              <Input
                value={anchor.value}
                placeholder="head / ear-left / eye-center-right"
                onChange={(_, data) => anchor.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
          </>
        )}
        {hasTransition && (
          <>
            <CommonOptions title={t`过渡时间（毫秒；留空使用默认，0 为瞬切）`}>
              <Input
                type="number"
                min={0}
                step={1}
                value={duration.value}
                placeholder="留空使用运行时默认值"
                onChange={(_, data) => duration.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonOptions title={t`缓动类型`}>
              <WheelDropdown
                options={easeOptions}
                value={ease.value}
                onValueChange={(value) => {
                  ease.set(value || '');
                  submit();
                }}
              />
            </CommonOptions>
          </>
        )}
        {isAsync && (
          <CommonOptions title={t`继续执行后续语句`}>
            <TerreToggle
              title=""
              isChecked={runContinue.value}
              onText={t`操作成功后继续剧情`}
              offText={t`操作完成后等待点击`}
              onChange={(value) => {
                runContinue.set(value);
                submit();
              }}
            />
          </CommonOptions>
        )}
        <CommonTips
          text={t`实体 ID 来自“添加附件”语句。分离后可用“效果与变换”控制该 ID：默认沿用分离时立绘的左/中/右布局基准，向右、向下为正，填写目标偏移。分离保持原位；此后基准固定，不随人物移动。旧脚本可选旧版舞台绝对坐标。重新绑定后回到原锚点摆放。`}
        />
      </div>
      {props.extraOptions}
    </div>
  );
}
