import { it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
const source=fs.readFileSync(new URL('./AttachmentCreatorWorkbench.ts',import.meta.url),'utf8');
function slice(start:string,end:string){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function harness(){
 const events=new EventEmitter(),model=new EventEmitter() as EventEmitter & {internalModel:unknown};
 const parameters:Record<string,number>={PARAM_ARM_L_01_002:19,PARAM_ARM_L_CHANGE:1};
 model.internalModel=Object.assign(events,{coreModel:{setParamFloat:(key:string,value:number)=>parameters[key]=value}});
 const draft={figureKey:'a',figureGeneration:'g1',handBinding:{states:[{id:'four',drawableId:'D_PSD1.98'}]}};
 const replayCalls:string[]=[];
 const figure={uuid:'g1',model};
 const stage={getActiveLive2DFigure:()=>({status:'ready',figure}),replayModelMotionByKey:async(_key:string,name:string)=>{events.emit('beforeModelUpdate');replayCalls.push(name);return {started:true,modelCount:1,acceptedCount:1};}};
 const ctx:any={draft,parameters,replayCalls,activeReadyFigure:()=>figure,selectedProfile:()=>({modelPath:'anon/school_winter-2023/model.json',characterId:'anon'}),handTransition:{input:{value:'0'}},handStatus:{textContent:''},handInputStatus:{textContent:''},handState:{select:{value:'four'}},renderHandState:()=>{},WebGAL:{gameplay:{pixiStage:stage}},motion:{select:{value:'bow',options:[{value:'anon/idle01'}]}},playMotion:{},idleMotion:{},motionStatus:{},setStatus:()=>{},audit:()=>{},errorMessage:String,destroyed:false,creatorCatalogEntry:()=>({representativeMotions:['idle']}),events};
 vm.createContext(ctx);
 const run=(text:string)=>vm.runInContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
 run(slice('  let handPoseCleanup:', '  function renderHandInputs()'));
 run(slice('  handState.select.onchange=', '  function applyHandStateInputs()'));
 run(slice('  playMotion.onclick =','  copyScriptButton.onclick ='));
 return {ctx,run,events,parameters,model};
}
it('editor selection leaves native arm parameters and hooks untouched',()=>{const h=harness();h.ctx.handState.select.onchange();h.events.emit('beforeModelUpdate');expect(h.parameters.PARAM_ARM_L_01_002).toBe(19);expect(h.events.listenerCount('beforeModelUpdate')).toBe(0);});
it('explicit pose inspection owns one hook and cleanup removes it idempotently',()=>{const h=harness();h.ctx.previewHandPose(0);h.ctx.previewHandPose(1);expect(h.events.listenerCount('beforeModelUpdate')).toBe(1);h.events.emit('beforeModelUpdate');expect(h.parameters.PARAM_HAND_L_04_001).toBe(1);h.ctx.stopHandPose();h.ctx.stopHandPose();expect(h.events.listenerCount('beforeModelUpdate')).toBe(0);expect(h.model.listenerCount('destroy')).toBe(0);expect(h.ctx.handTransition.input.value).toBe('');});
it.each(['playMotion','idleMotion'])('%s releases inspection before native replay',async(key)=>{const h=harness();h.ctx.previewHandPose(.5);const saved=JSON.stringify(h.ctx.draft);await h.ctx[key].onclick();expect(h.events.listenerCount('beforeModelUpdate')).toBe(0);expect(h.parameters.PARAM_ARM_L_01_002).toBe(19);expect(JSON.stringify(h.ctx.draft)).toBe(saved);expect(h.ctx.replayCalls).toHaveLength(1);});
it('saved reload clears inspection without selecting a sample pose',async()=>{const h=harness();h.ctx.previewHandPose(1);const text=slice('    stopHandPose();\n    const previewReady = await bindPreview(flowRevision);','    projectDirty = false;');expect(source).not.toContain('const previewSamplePose');expect(text).not.toContain('selectHandPose');h.ctx.bindPreview=async()=>{h.events.emit('beforeModelUpdate');return true;};h.ctx.flowRevision=1;h.ctx.isPreviewFlowCurrent=()=>true;await h.run('(async()=>{'+text+'})()');expect(h.events.listenerCount('beforeModelUpdate')).toBe(0);expect(h.parameters.PARAM_ARM_L_01_002).toBe(19);});
it('destroy removes the temporary hook and subsequent frames cannot overwrite pose',()=>{const h=harness();h.ctx.previewHandPose(0);h.model.emit('destroy');h.events.emit('beforeModelUpdate');expect(h.parameters.PARAM_ARM_L_01_002).toBe(19);expect(h.events.listenerCount('beforeModelUpdate')).toBe(0);});
const runtimeSource=fs.readFileSync(new URL('../AttachmentRuntime.ts',import.meta.url),'utf8');
function frameHarness(){
 const begin=runtimeSource.indexOf('  public waitForPreviewFrame('),end=runtimeSource.indexOf('  private retirePreviewClaims',begin);
 const method=runtimeSource.slice(begin,end).replace('  public waitForPreviewFrame','  function waitForPreviewFrame');
 const claim={figureKey:'a',attachmentId:'gun',figureGeneration:'g1'},owner={},callbacks=new Set<(e:unknown)=>void>();
 const snapshot={phase:'ready',visible:true,figureGeneration:'g1',firstValidPose:{status:'pending'}};
 const host={previewClaims:new Map([[owner,claim]]),figureGeneration:()=> 'g1',subscribe:(fn:(e:unknown)=>void)=>{callbacks.add(fn);return ()=>callbacks.delete(fn);},get:()=>snapshot,getHandStateDiagnostic:()=> 'unsupported-state'};
 const ctx:any={setTimeout,clearTimeout,Error,host,owner};vm.createContext(ctx);vm.runInContext(ts.transpileModule(method,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
 return {snapshot,callbacks,wait:(allow:boolean)=>ctx.waitForPreviewFrame.call(host,owner,30,undefined,allow),emit:(generation='g1')=>callbacks.forEach(fn=>fn({type:'frame',figureKey:'a',figureGeneration:generation}))};
}
it('loaded-but-unconfigured hand acknowledges a real current frame without inventing a valid pose',async()=>{const h=frameHarness();const p=h.wait(true);h.emit();await p;expect(h.snapshot.firstValidPose.status).toBe('pending');expect(h.callbacks.size).toBe(0);});
it('unconfigured hand cannot bypass frame acknowledgement or generation matching',async()=>{const h=frameHarness();const p=expect(h.wait(true)).rejects.toThrow('CREATOR_PREVIEW_FRAME_TIMEOUT');h.emit('old-generation');await p;expect(h.callbacks.size).toBe(0);});
it('ordinary previews keep the valid-pose requirement',async()=>{const h=frameHarness();const p=expect(h.wait(false)).rejects.toThrow('CREATOR_PREVIEW_FRAME_TIMEOUT');h.emit();await p;});

it('derived profiles use their declared character idle and no-idle still releases inspection',async()=>{const h=harness();h.ctx.creatorCatalogEntry=()=>undefined;h.ctx.previewHandPose(0);await h.ctx.idleMotion.onclick();expect(h.ctx.replayCalls).toEqual(['anon/idle01']);h.ctx.motion.select.options=[];h.ctx.previewHandPose(1);await h.ctx.idleMotion.onclick();expect(h.events.listenerCount('beforeModelUpdate')).toBe(0);expect(h.ctx.motionStatus.textContent).toContain('未提供明确');});
