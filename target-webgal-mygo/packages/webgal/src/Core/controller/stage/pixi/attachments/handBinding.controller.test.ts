import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import * as PIXI from 'pixi.js';
import {HatAttachmentController} from './HatAttachmentController';
import {WebGALPixiContainer} from '../WebGALPixiContainer';
import {parseAttachmentEntityVisualState} from './stageEntityVisualState';
import {handAppearanceSupported,parseAttachmentHandBinding} from './handBinding';
const cleanups:(()=>void)[]=[];let restore:()=>void;
beforeAll(()=>{const spy=vi.spyOn(PIXI.settings.ADAPTER,'createCanvas').mockImplementation(()=>({getContext:()=>null} as never));restore=()=>spy.mockRestore();});afterAll(()=>restore());afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
function setup(cold=false){
  const stage=new PIXI.Container();stage.parent=new PIXI.Container();const back=new PIXI.Container(),front=new PIXI.Container(),model=new PIXI.Container(),host=new WebGALPixiContainer();stage.addChild(back,model,front,host);
  const weights=[1,0],vertices=new Float32Array([0,0,10,0,0,10]),anchors=[0,1,2].map(index=>({index,weight:1,neutral:{x:vertices[index*2],y:vertices[index*2+1]}}));
  const dp={_$Uo:vi.fn(),getClipBufPre_clipContextDraw:()=>null,setClipBufPre_clipContextForDraw:vi.fn(),_$WP:vi.fn()};
  const draws=weights.map((_,i)=>({draw:vi.fn(),getDrawDataID:()=>({id:'mesh-'+i}),getOpacity:()=>weights[i],_$6s:{}}));
  const mc={getDrawData:(i:number)=>draws[i],_$C2:()=>({_$IP:0,baseOpacity:1}),_$Hr:[{getPartsOpacity:()=>1}],_$Ws:[],_$Er:[]};
  const core={getModelContext:()=>mc,getDrawParam:()=>dp,setTexture:vi.fn(),update:vi.fn()};
  const internal={localTransform:new PIXI.Matrix(),getDrawableIndex:(id:string)=>id==='mesh-0'?0:id==='mesh-1'?1:-1,getDrawableVertices:()=>vertices,coreModel:core,settings:{textures:[]},draw:vi.fn()};Object.assign(model,{internalModel:internal});
  const original=internal.draw,config={schema:'webgal-live2d-attachment-v1',configId:'hand',target:{modelPath:'game/figure/test/model.json',anchorProfile:{drawableId:'mesh-0',anchors}},fit:{scaleMode:'fixed'},layers:{front:'front.png'},placement:{spriteAnchor:{x:.5,y:.5},offset:{x:0,y:0},rotationOffsetRad:0,localScale:1},handBinding:{version:1,runtime:'cubism2',textureLayer:'front',transition:'weighted-scenes',unsupportedState:'hide-with-diagnostic',states:weights.map((_,i)=>({id:'state-'+i,displayName:'State '+i,drawableId:'mesh-'+i,anchors,contact:[{index:0,weight:.5},{index:1,weight:.5}],insertion:'before',mirrorX:i===1,rotationOffsetRad:0}))}};
  const renderer={gl:{},texture:{bind:vi.fn()}};
  const controller=new HatAttachmentController({instanceId:'test',config:config as never,textures:{front:PIXI.Texture.EMPTY},transformHost:host,renderer:renderer as never,...(cold?{free:{parent:stage,visualState:{...parseAttachmentEntityVisualState({}),space:'world' as const}}}:{model:model as never,layers:{back,front}})});
  cleanups.push(()=>{controller.destroy();stage.destroy({children:true});});
  stage.updateTransform();const update=()=>{stage.updateTransform();controller.update({} as never,{} as never);};
  return {controller,config,weights,core,internal,original,stage,front,back,host,model,renderer,update};
}
describe('live hand calibration and state pose correction',()=>{
  it('corrects the reflected state without reflecting its offset or changing the other state',()=>{
    const s=setup();s.update();const a=s.controller.getHandStateDetails().activeStates[0].modelSourceQuad;
    s.weights.splice(0,2,0,1);s.update();const b=s.controller.getHandStateDetails().activeStates[0].modelSourceQuad;
    const candidate=parseAttachmentHandBinding(s.config.handBinding);candidate.states[1].poseOffset={x:21,y:-13};
    candidate.states[1].rotationOffsetRad=Math.PI/2;expect(s.controller.setHandCalibrationPreview(candidate)).toBe(true);s.update();
    const corrected=s.controller.getHandStateDetails().activeStates[0].modelSourceQuad;
    for(let i=0;i<8;i+=2){expect(corrected[i]).toBeCloseTo(5-b[i+1]+21);expect(corrected[i+1]).toBeCloseTo(b[i]-5-13);}
    s.weights.splice(0,2,1,0);s.update();expect(s.controller.getHandStateDetails().activeStates[0].modelSourceQuad).toEqual(a);
  });
  it('keeps only the latest cloned calibration without rebuilding ownership or mutating the base',()=>{
    const s=setup(),base=JSON.stringify(s.config),owner=s.internal.draw,candidate=parseAttachmentHandBinding(s.config.handBinding);
    for(const x of [5,9,37]){candidate.states[0].poseOffset={x,y:0};expect(s.controller.setHandCalibrationPreview(candidate)).toBe(true);}
    candidate.states[0].poseOffset!.x=800;s.update();const quad=s.controller.getHandStateDetails().activeStates[0].modelSourceQuad;
    expect(quad[0]).toBeCloseTo(42-.5);expect(s.internal.draw).toBe(owner);expect(s.core.update).not.toHaveBeenCalled();expect(JSON.stringify(s.config)).toBe(base);
    const invalid=parseAttachmentHandBinding(s.config.handBinding);invalid.states[0].anchors[0].neutral.x=999;
    expect(s.controller.setHandCalibrationPreview(invalid)).toBe(false);invalid.states[0].poseOffset={x:NaN,y:0};
    expect(()=>s.controller.setHandCalibrationPreview(invalid)).toThrow('poseOffset');s.update();expect(s.controller.getHandStateDetails().activeStates[0].modelSourceQuad).toEqual(quad);
  });
  it('preserves two independent corrected silhouettes in a crossfade',()=>{
    const s=setup();s.weights.splice(0,2,.5,.5);s.update();const before=s.controller.getHandStateDetails().activeStates;
    const candidate=parseAttachmentHandBinding(s.config.handBinding);candidate.states[0].poseOffset={x:10,y:20};candidate.states[1].poseOffset={x:-30,y:40};
    s.controller.setHandCalibrationPreview(candidate);s.update();const after=s.controller.getHandStateDetails().activeStates;
    expect(after.map(p=>p.weight)).toEqual([.5,.5]);for(let k=0;k<2;k++)for(let i=0;i<8;i+=2){expect(after[k].modelSourceQuad[i]-before[k].modelSourceQuad[i]).toBeCloseTo(candidate.states[k].poseOffset!.x);expect(after[k].modelSourceQuad[i+1]-before[k].modelSourceQuad[i+1]).toBeCloseTo(candidate.states[k].poseOffset!.y);}
  });
  it('retains corrected mirrored world transform through detach and reattach',()=>{
    const s=setup(),candidate=parseAttachmentHandBinding(s.config.handBinding);candidate.states[1].poseOffset={x:17,y:-9};candidate.states[1].rotationOffsetRad=.4;
    s.controller.setHandCalibrationPreview(candidate);s.weights.splice(0,2,0,1);s.update();const proxy=(s.controller as any).frontProxy,before=proxy.worldTransform.clone();
    s.controller.detachToFree(s.stage);s.stage.updateTransform();for(const k of ['a','b','c','d','tx','ty'] as const)expect(proxy.worldTransform[k]).toBeCloseTo(before[k],5);
    expect(s.controller.setHandCalibrationPreview(candidate)).toBe(false);
    s.controller.reattachFromFree(s.model as never,{back:s.back,front:s.front},parseAttachmentEntityVisualState({}),undefined,s.renderer as never);s.update();
    for(const k of ['a','b','c','d','tx','ty'] as const)expect(proxy.worldTransform[k]).toBeCloseTo(before[k],5);
  });
  it('roundtrips correction without adding fields to legacy configurations',()=>{
    const s=setup(),old=parseAttachmentHandBinding(s.config.handBinding);expect(old.states[0]).not.toHaveProperty('poseOffset');
    old.states[0].poseOffset={x:50,y:-120};const restored=parseAttachmentHandBinding(JSON.parse(JSON.stringify(old)));expect(restored).toEqual(old);
    restored.states[0].poseOffset!.y=Infinity;expect(()=>parseAttachmentHandBinding(restored)).toThrow('poseOffset.y');
  });
});

describe('hand controller lifecycle at the final geometry frame',()=>{
  it('calibrated hand flip reflects the complete rotated and displaced PNG across the hand axis',()=>{
    const s=setup();Object.assign(s.config.placement,{offset:{x:50,y:120},rotationOffsetRad:-120*Math.PI/180,localScale:.3});
    s.controller.setCalibrationPreview({...s.controller.getCalibrationPreview(),offset:{x:50,y:120},rotationOffsetRad:-120*Math.PI/180,localScale:.3});
    s.update();const first=(s.controller as any).handPresentations[0].quad;
    s.weights.splice(0,2,0,1);s.update();const second=(s.controller as any).handPresentations[0].quad;
    // The contact is (5,0), and the default hand axis is vertical: x→10-x, y unchanged.
    for(let i=0;i<8;i+=2){expect(second[i]).toBeCloseTo(10-first[i],4);expect(second[i+1]).toBeCloseTo(first[i+1],4);}
  });
  it('calibrated oblique axes preserve the parallel component and reverse the perpendicular component, including offsets',()=>{
    for(const axisAngle of [0,.35,Math.PI/2,2.2])for(const rotation of [-120,0,47]){
      const s=setup(),axis={angleRad:axisAngle,offset:{x:12,y:-8}};
      Object.assign(s.config.handBinding.states[1],{flipAxis:axis});
      s.controller.setCalibrationPreview({...s.controller.getCalibrationPreview(),offset:{x:50,y:120},rotationOffsetRad:rotation*Math.PI/180,localScaleX:.3,localScaleY:.7});
      s.update();const a=(s.controller as any).handPresentations[0].quad;s.weights.splice(0,2,0,1);s.update();const b=(s.controller as any).handPresentations[0].quad;
      const ox=17,oy=-8,c=Math.cos(axisAngle),sn=Math.sin(axisAngle);
      for(let i=0;i<8;i+=2){const ax=a[i]-ox,ay=a[i+1]-oy,bx=b[i]-ox,by=b[i+1]-oy;
        expect(bx*c+by*sn).toBeCloseTo(ax*c+ay*sn,3);expect(-bx*sn+by*c).toBeCloseTo(-(-ax*sn+ay*c),3);}
    }
  });
  it('calibrated reflected placement retains every matrix coefficient through detach and reattach',()=>{
    const s=setup();Object.assign(s.config.handBinding.states[1],{flipAxis:{angleRad:.7,offset:{x:8,y:15}}});
    s.controller.setCalibrationPreview({...s.controller.getCalibrationPreview(),offset:{x:50,y:120},rotationOffsetRad:-2*Math.PI/3,localScaleX:.3,localScaleY:.7});
    s.weights.splice(0,2,0,1);s.update();const proxy=(s.controller as any).frontProxy,before=proxy.worldTransform.clone();
    s.controller.detachToFree(s.stage);s.stage.updateTransform();for(const k of ['a','b','c','d','tx','ty'] as const)expect(proxy.worldTransform[k]).toBeCloseTo(before[k],5);
    s.controller.reattachFromFree(s.model as never,{back:s.back,front:s.front},parseAttachmentEntityVisualState({}),undefined,s.renderer as never);s.update();
    for(const k of ['a','b','c','d','tx','ty'] as const)expect(proxy.worldTransform[k]).toBeCloseTo(before[k],5);
  });
  it('fades coverage toward an unconfigured hand rather than normalizing a remnant into an opaque prop',()=>{const s=setup();s.weights.splice(0,2,.2,0);s.update();expect((s.controller as any).handPresentations[0].weight).toBe(1);expect((s.controller as any).handPresentations[0].opacity).toBeCloseTo(.2);});
  it('publishes normalized per-state weight, suppresses ordinary sprite draw, and never updates the model',()=>{const s=setup();s.weights.splice(0,2,.25,.75);s.update();const p=(s.controller as any).handPresentations;expect(p.map((x:any)=>x.weight)).toEqual([.25,.75]);expect(s.core.update).not.toHaveBeenCalled();expect(s.front.children[0].visible).toBe(true);expect((s.controller as any).frontSprite.renderable).toBe(false);});
  it('unknown hand hides without borrowing a stale pose, and the configured hand can recover',()=>{const s=setup();s.update();s.weights.splice(0,2,0,0);s.update();expect(s.controller.getHandStateDiagnostic()).toBe('unsupported-state');expect((s.controller as any).handPresentations).toEqual([]);expect(s.controller.getDetachFrameReadiness(s.stage).reason).toBe('anchor-pose-unavailable');s.weights[1]=1;s.update();expect(s.controller.getHandStateDiagnostic()).toBe('supported');expect((s.controller as any).handPresentations).toHaveLength(1);});
  it('does not collapse an active crossfade into one free silhouette',()=>{const s=setup();s.weights.splice(0,2,.5,.5);s.update();expect(s.controller.getDetachFrameReadiness(s.stage)).toMatchObject({ready:false,reason:'hand-transition-in-progress'});expect(()=>s.controller.detachToFree(s.stage)).toThrow('hand-transition-in-progress');});
  it('stable mirrored hand detaches with its world matrix and restores the ordinary sprite, then reattaches once',()=>{const s=setup();s.weights.splice(0,2,0,1);s.update();const proxy=(s.controller as any).frontProxy,before=proxy.worldTransform.clone();expect(s.controller.getDetachFrameReadiness(s.stage).ready).toBe(true);s.controller.detachToFree(s.stage);s.stage.updateTransform();expect(proxy.worldTransform.a).toBeCloseTo(before.a);expect(proxy.worldTransform.tx).toBeCloseTo(before.tx);expect((s.controller as any).frontSprite.renderable).toBe(true);s.controller.reattachFromFree(s.model as never,{back:s.back,front:s.front},parseAttachmentEntityVisualState({}),undefined,s.renderer as never);s.update();expect((s.controller as any).frontSprite.renderable).toBe(false);expect((s.controller as any).handPresentations).toHaveLength(1);s.controller.destroy();expect(s.internal.draw).toBe(s.original);});
  it('cold free restoration registers the hand draw only when a model is explicitly reattached',()=>{const s=setup(true);expect(s.internal.draw).toBe(s.original);s.controller.reattachFromFree(s.model as never,{back:s.back,front:s.front},parseAttachmentEntityVisualState({}),undefined,s.renderer as never);s.update();expect(s.internal.draw).not.toBe(s.original);s.controller.destroy();expect(s.internal.draw).toBe(s.original);});
  it('explicitly distinguishes PNG/opacity support from unsupported attachment-owned effects',()=>{expect(handAppearanceSupported(parseAttachmentEntityVisualState({}).appearance)).toBe(true);const state=parseAttachmentEntityVisualState({appearance:{brightness:.5}});expect(handAppearanceSupported(state.appearance)).toBe(false);});
});
