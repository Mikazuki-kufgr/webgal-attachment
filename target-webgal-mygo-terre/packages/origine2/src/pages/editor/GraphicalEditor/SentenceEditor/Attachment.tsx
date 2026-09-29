import { Input } from '@fluentui/react-components';
import { t } from '@lingui/macro';
import { useEaseTypeOptions } from '@/hooks/useEaseTypeOptions';
import { useValue } from '@/hooks/useValue';
import { combineSubmitString } from '@/utils/combineSubmitString';
import { attachmentCardError } from './attachmentCardContract';
import ChooseFile from '../../ChooseFile/ChooseFile';
import CommonOptions from '../components/CommonOption';
import CommonTips from '../components/CommonTips';
import WheelDropdown from '../components/WheelDropdown';
import { getArgByKey } from '../utils/getArgByKey';
import { ISentenceEditorProps } from './index';
import { attachmentActionPolicy, type AttachmentAction } from './attachmentActionPolicy';
import { attachmentConfigIdFromSelectedFile } from './attachmentConfigPath';
import styles from './sentenceEditor.module.scss';

export default function Attachment(props: ISentenceEditorProps) {
  const action = useValue<AttachmentAction>((props.sentence.content || 'add') as AttachmentAction);
  const figure = useValue(String(getArgByKey(props.sentence, 'figure') || 'fig-center'));
  const attachmentId = useValue(String(getArgByKey(props.sentence, 'id') || 'attachment-1'));
  const entity = useValue(String(getArgByKey(props.sentence, 'entity') || ''));
  const config = useValue(String(getArgByKey(props.sentence, 'config') || ''));
  const profile = useValue(String(getArgByKey(props.sentence, 'profile') || ''));
  const slot = useValue(String(getArgByKey(props.sentence, 'slot')));
  const anchor = useValue(String(getArgByKey(props.sentence, 'anchor') || 'head'));
  const duration = useValue(String(getArgByKey(props.sentence, 'duration')));
  const ease = useValue(String(getArgByKey(props.sentence, 'ease') || ''));
  const error = useValue('');
  const easeOptions = useEaseTypeOptions();
  const actionOptions = new Map<AttachmentAction, string>([
    ['add', t`添加附件`],
    ['hide', t`隐藏附件`],
    ['show', t`显示附件`],
    ['remove', t`移除附件`],
  ]);
  const { hasTransition } = attachmentActionPolicy(action.value);

  const submit = () => {
    // Read the mutable useValue object here instead of closing over render-time
    // booleans. WheelDropdown calls set() and submit() in the same event; a
    // cached flag would otherwise preserve arguments from the previous action.
    const currentAction = action.value;
    const currentPolicy = attachmentActionPolicy(currentAction);
    const validation = attachmentCardError(
      currentAction,
      ['add', 'hide', 'show', 'remove'],
      [
        figure.value,
        attachmentId.value,
        ...(currentPolicy.acceptsAttachmentDefinition
          ? [entity.value, config.value, profile.value, slot.value, anchor.value]
          : []),
      ],
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
          { key: 'figure', value: figure.value },
          { key: 'id', value: attachmentId.value },
          { key: 'entity', value: currentPolicy.acceptsAttachmentDefinition ? entity.value : '' },
          { key: 'config', value: currentPolicy.acceptsAttachmentDefinition ? config.value : '' },
          { key: 'profile', value: currentPolicy.acceptsAttachmentDefinition ? profile.value : '' },
          { key: 'slot', value: currentPolicy.acceptsAttachmentDefinition ? slot.value : '' },
          { key: 'anchor', value: currentPolicy.acceptsAttachmentDefinition ? anchor.value : '' },
          { key: 'duration', value: currentPolicy.hasTransition ? duration.value : '' },
          { key: 'ease', value: currentPolicy.hasTransition ? ease.value : '' },
        ],
        props.sentence.inlineComment,
      ),
    );
  };

  return (
    <div className={styles.sentenceEditorContent}>
      {error.value && <div role="alert">{error.value}</div>}
      <div className={styles.editItem}>
        <CommonOptions title={t`附件操作`}>
          <WheelDropdown
            options={actionOptions}
            value={action.value}
            onValueChange={(value) => {
              action.set((value || 'add') as AttachmentAction);
              submit();
            }}
          />
        </CommonOptions>
        <CommonOptions title={t`目标立绘 ID`}>
          <Input
            value={figure.value}
            placeholder="fig-center / fig-left / 自定义立绘 ID"
            onChange={(_, data) => figure.set(data.value)}
            onBlur={submit}
          />
        </CommonOptions>
        <CommonOptions title={t`附件实例 ID`}>
          <Input
            value={attachmentId.value}
            placeholder="hat / glasses / attachment-1"
            onChange={(_, data) => attachmentId.set(data.value)}
            onBlur={submit}
          />
        </CommonOptions>
        {action.value === 'add' && (
          <>
            <CommonOptions title={t`附件配置 preset`}>
              <div>
                <Input
                  aria-label="附件配置 ID"
                  value={config.value}
                  placeholder="v2/附件技术文件夹名"
                  onChange={(_, data) => config.set(data.value)}
                  onBlur={submit}
                />
                <ChooseFile
                  title={t`选择附件文件夹中的 attachment.json`}
                  basePath={['attachments-v2']}
                  selectedFilePath={null}
                  extNames={['.json']}
                  onChange={(file) => {
                    const selected = attachmentConfigIdFromSelectedFile(file?.name || '');
                    if (!selected) {
                      error.set('请选择完整附件的 attachment.json 或 presets 下的配置文件；当前配置未改变。');
                      return;
                    }
                    error.set('');
                    config.set(selected);
                    submit();
                  }}
                />
              </div>
            </CommonOptions>
            <CommonOptions title={t`模型适配 Profile（多套时必填）`}>
              <Input
                value={profile.value}
                placeholder="例如 anon-school-winter-2023；单套旧附件可留空"
                onChange={(_, data) => profile.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonOptions title={t`稳定实体 ID（推荐）`}>
              <Input
                value={entity.value}
                placeholder="sakiko-hat"
                onChange={(_, data) => entity.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonOptions title={t`附件槽位`}>
              <Input
                value={slot.value}
                placeholder="headwear"
                onChange={(_, data) => slot.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonOptions title={t`语义锚点`}>
              <Input
                value={anchor.value}
                placeholder="head / ear-left / eye-center-right"
                onChange={(_, data) => anchor.set(data.value)}
                onBlur={submit}
              />
            </CommonOptions>
            <CommonTips
              text={t`请选择完整附件文件夹里的 attachment.json；旧项目的 presets/*.json 仍可兼容。目标立绘 ID 必须与“切换立绘”语句中的立绘 ID 一致。`}
            />
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
        <CommonTips
          text={t`附件命令默认连续执行。为保持旧脚本兼容，本版本的 next=false 也不会改成等待；如需暂停请另加等待语句。已有 next 参数会原样保留。`}
        />
      </div>
      {props.extraOptions}
    </div>
  );
}
