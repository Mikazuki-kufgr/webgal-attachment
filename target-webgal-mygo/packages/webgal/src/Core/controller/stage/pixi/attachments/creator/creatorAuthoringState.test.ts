import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { adaptationState, attachmentState, ordinarySavedAdaptation } from './creatorAuthoringState';
import { createBlankCreatorDraft, cloneCreatorDraft, validateCreatorDraft, readableCreatorPresetId } from './creatorDraft';
import { buildCreatorPackage, type CreatorPackageAdaptation } from './creatorPackageBuilder';
import { sha256Bytes } from './pngImport';
import { rekeyCreatorAdaptations } from './creatorDraftIdentity';
import { CreatorProjectRequestError } from './creatorProject';
import type { Live2DModelProfile } from '../profileTypes';

const source = fs.readFileSync(path.join(__dirname, 'AttachmentCreatorWorkbench.ts'), 'utf8');
const ast = ts.createSourceFile('w.ts', source, ts.ScriptTarget.Latest, true);
function shipped(name: string, env: any) {
  let body = ''; const visit = (n: ts.Node) => { if(ts.isFunctionDeclaration(n) && n.name?.text===name) body=n.getText(ast);ts.forEachChild(n,visit); };visit(ast);
  return new Function('env', 'with(env){'+ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText+';return '+name+';}')(env);
}
const profile = (id: string, modelPath='game/figure/a/model.json'): Live2DModelProfile => ({
  schema:'webgal-live2d-model-profile',schemaVersion:1,profileVersion:1,modelProfileId:id,characterId:'a',modelId:'a',modelPath,
  fingerprint:{modelJsonSha256:'A'.repeat(64),drawableCount:1},
  anchors:[{name:'head',anchorProfileId:'head',drawableId:'mesh',vertexCount:3,points:[{index:0,weight:1,neutral:{x:0,y:0}},{index:1,weight:1,neutral:{x:1,y:0}},{index:2,weight:1,neutral:{x:0,y:1}}]}],
});
async function environment() {
  const draft=createBlankCreatorDraft(1234);Object.assign(draft,{figureKey:'figure',figureGeneration:'g',modelProfileId:'a',anchorName:'head'});
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MuoAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const metadata={sourceFileName:'gun.png',outputFileName:'front.png',width:1,height:1,bytes:bytes.length,sha256:await sha256Bytes(bytes),mime:'image/png'};
  draft.layers.front=metadata;
  const env:any={draft,profiles:new Map([['a',profile('a')],['b',profile('b')]]),binaries:{front:{bytes,metadata}},retainedAdaptations:[],pendingAdaptationDrafts:new Map(),readDraftInputs(){},adaptationConfirmed:false,adaptationBaseline:adaptationState(draft),adaptationState,attachmentState,cloneCreatorDraft,validateCreatorDraft,buildCreatorPackage};
  env.selectedProfile=()=>env.profiles.get(env.draft.modelProfileId);
  return env;
}
describe('review author intent across real capture and persistence boundaries',()=>{
  it('R03 actual capture omits untouched ambient A, retains edited A and B on A-B-A',async()=>{
    const e=await environment(), capture=shipped('captureCurrentAdaptation',e);
    await capture();expect(e.retainedAdaptations).toHaveLength(0);expect(e.pendingAdaptationDrafts.size).toBe(0);
    e.draft.placement.offset.x=12;await capture();expect(e.retainedAdaptations[0].preset.placement.offset.x).toBe(12);
    e.draft.modelProfileId='b';e.adaptationBaseline=adaptationState(e.draft);e.draft.placement.offset.x=24;await capture();
    e.draft.modelProfileId='a';e.draft.placement.offset.x=36;await capture();
    expect(e.retainedAdaptations.map((a:any)=>[a.preset.modelProfileId,a.preset.placement.offset.x])).toEqual([['b',24],['a',36]]);
  });
  it('R02/R05 preference precedes ambient Profile; ambiguous asks, explicit stays exact, other model not forced',async()=>{
    const e=await environment();e.adaptationConfirmed=true;await shipped('captureCurrentAdaptation',e)();e.draft.modelProfileId='b';await shipped('captureCurrentAdaptation',e)();
    const rows=e.retainedAdaptations as CreatorPackageAdaptation[];
    expect(ordinarySavedAdaptation(rows,profile('a').modelPath,{modelProfileId:'b',anchorName:'head'})?.modelProfile.modelProfileId).toBe('b');
    expect(()=>ordinarySavedAdaptation(rows,profile('a').modelPath)).toThrow('多套');
    expect(ordinarySavedAdaptation(rows,profile('a').modelPath,undefined,'a')?.modelProfile.modelProfileId).toBe('a');
    expect(ordinarySavedAdaptation(rows,'game/figure/other/model.json',{modelProfileId:'b',anchorName:'head'})).toBeUndefined();
  });
  it('R11 dirty state ignores figure generation, catches images/placement/default changes; generic slot is not headwear',async()=>{
    const e=await environment(), base=attachmentState(e.draft,[],undefined);
    e.draft.figureGeneration='other';expect(attachmentState(e.draft,[],undefined)).toBe(base);
    e.draft.placement.offset.x++;expect(attachmentState(e.draft,[],undefined)).not.toBe(base);
    expect(e.draft.slot).not.toBe('headwear');expect(createBlankCreatorDraft(2345).slot).not.toBe(e.draft.slot);
  });
  it('Save As New rekeys retained adaptations before validating an edited configuration ID',async()=>{
    const e=await environment();
    const original=await buildCreatorPackage({draft:cloneCreatorDraft(e.draft),profile:e.selectedProfile(),...e.binaries});
    const document=JSON.parse(new TextDecoder().decode(original.files.find(file=>file.path.endsWith('/attachment.json'))!.bytes));
    e.retainedAdaptations=document.adaptations;
    const oldPreset=e.draft.presetId;
    e.draft.sourcePresetId=oldPreset;
    e.draft.presetId='v2/straw-hat';
    Object.assign(e,{exportRevision:0,packageResult:undefined,packageRevision:-1,packageCreatedAt:undefined,
      attachmentDefaults:undefined,canonicalExportJson:'',exportPreview:{textContent:''},scriptPreview:{textContent:''},
      copyScriptButton:{disabled:true},exportSummary:{textContent:''},createBlankCreatorDraft,readableCreatorPresetId,
      rekeyCreatorAdaptations,creatorLifecycleScript:(d:any)=>d.presetId,setStatus(){},errorMessage:(x:Error)=>x.message});
    const build=shipped('buildPackage',e);
    expect(await build(false,false)).toBeUndefined();
    const fork=await build(false,true);
    expect(fork?.draft.presetId).not.toBe(oldPreset);
    expect(fork?.draft.presetId).not.toBe('v2/straw-hat');
    expect(fork?.draft.attachmentDefinitionId).not.toBe(e.draft.attachmentDefinitionId);
    expect(e.retainedAdaptations[0].preset.presetId).toBe(oldPreset);
    expect(e.scriptPreview.textContent).toBe(fork?.draft.presetId);
    const saved=JSON.parse(new TextDecoder().decode(fork.files.find((file:any)=>file.path.endsWith('/attachment.json')).bytes));
    expect(saved.adaptations.every((row:any)=>row.preset.presetId===fork.draft.presetId)).toBe(true);
  });
  for(const outcome of ['success','failed','unknown','refresh-failed']) it('R06/R07 Save As '+outcome+' adopts only confirmed identity',async()=>{
    const e=await environment(), original=cloneCreatorDraft(e.draft);let adopted:any;
    Object.assign(e,{pendingSave:undefined,destroyed:false,attachmentDefaults:undefined,lifetime:{signal:undefined},completionNotice:undefined,
      buildPackage:(_announce:boolean,fork:boolean)=>{
        const identity=createBlankCreatorDraft(1235);
        const next=fork?{...cloneCreatorDraft(e.draft),draftId:identity.draftId,attachmentDefinitionId:identity.attachmentDefinitionId,
          presetId:readableCreatorPresetId(e.draft.displayName,identity.attachmentInstanceId),attachmentInstanceId:identity.attachmentInstanceId,
          sourcePresetId:undefined,approvalStatus:'candidate' as const}:cloneCreatorDraft(e.draft);
        return buildCreatorPackage({...e,draft:next,profile:e.selectedProfile(),...e.binaries,
          existingAdaptations:fork?rekeyCreatorAdaptations(e.retainedAdaptations,next):e.retainedAdaptations});
      },createBlankCreatorDraft, rekeyCreatorAdaptations, readableCreatorPresetId,
      ensureWriteRevision:async()=>null,setStatus(){},audit(){},errorMessage:(x:Error)=>x.message,CreatorProjectRequestError,revisions:{accept(){},markUncertain(){}},
      saveCreatorPackageLocally:async()=>{if(outcome==='failed')throw Error('disk failure');if(outcome==='unknown')throw new CreatorProjectRequestError({code:'TIMEOUT',message:'unknown',commitState:'UNKNOWN'});return {revision:'R',attachmentRoot:'root',presetId:'v2/fork'};},
      acceptSavedPackage:(b:any)=>{adopted=b;e.draft=b.draft;},localSaveSummary:{textContent:''},refreshLocalSavedAttachments:async()=>{if(outcome==='refresh-failed')throw Error('refresh');return true;},
      serviceContext:undefined,updateTargetAvailability(){},
    });
    await shipped('saveLocalAttachment',e)(true);
    if(outcome==='success'||outcome==='refresh-failed'){expect(adopted.draft.presetId).not.toBe(original.presetId);expect(e.pendingSave).toBeUndefined();}
    else {expect(e.draft).toEqual(original);expect(adopted).toBeUndefined();if(outcome==='unknown')expect(e.pendingSave.built.draft.presetId).not.toBe(original.presetId);}
  });
});
