import {test} from 'node:test';import assert from 'node:assert/strict';
import {lifecycleHumanLines,lifecycleUserSuccessMessage} from '../../20_installable-candidate/source/lifecycle-user-messages.mjs';
for(const mode of ['Install','Repair','Validate'])test(`${mode} success reports actual Manager entry and cleanup boundaries`,()=>{
 const entry='D:\\中文 宿主\\WebGAL-Attachment-Manager\\02_打开附件制作器.cmd';
 const result={ok:true,mode,code:'PASS',creatorEntryPath:entry,productVersion:'test',releaseRevision:'test'};
 assert(lifecycleUserSuccessMessage(result).includes(entry));
 const all=lifecycleHumanLines(result).join('\n');assert(all.includes('可以删除'));assert(all.includes('Authoring'));assert(all.includes('先另存'));assert(all.includes('重新下载对应版本'));
});
test('failure and preflight never present a successful launch or cleanup instruction',()=>{
 for(const result of [{ok:false,mode:'Install',code:'HOST_PROCESS_ACTIVE',writesApplied:0},{ok:true,mode:'Install',code:'PREFLIGHT_ONLY'}]) {
  const text=lifecycleHumanLines(result).join('\n');assert(!text.includes('可以删除'));assert(!text.includes('制作器入口：'));
 }
});
