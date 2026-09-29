import type { Live2DModel } from 'pixi-live2d-display-webgal';
import { parseAttachmentHandBinding, type AttachmentHandBinding, type AttachmentHandState } from '../handBinding';
import type { Live2DModelProfile } from '../profileTypes';
import {resolveHandFlipAxis} from '../handLocalFlip';

function contactWeights(vertices: number[], point: number[], indices: ArrayLike<number>) {
  for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]],p=ids.map(i=>[vertices[i*2],vertices[i*2+1]]),den=(p[1][1]-p[2][1])*(p[0][0]-p[2][0])+(p[2][0]-p[1][0])*(p[0][1]-p[2][1]);if(Math.abs(den)<1e-8)continue;
    const a=((p[1][1]-p[2][1])*(point[0]-p[2][0])+(p[2][0]-p[1][0])*(point[1]-p[2][1]))/den,b=((p[2][1]-p[0][1])*(point[0]-p[2][0])+(p[0][0]-p[2][0])*(point[1]-p[2][1]))/den,c=1-a-b;
    if([a,b,c].every(w=>w>=-1e-7&&w<=1.0000001)){const weights=[a,b,c].map(w=>Math.max(0,w)),sum=weights.reduce((a,b)=>a+b,0);return ids.map((index,j)=>({index,weight:weights[j]/sum}));}}
  const near=Array.from({length:vertices.length/2},(_,index)=>({index,distance:Math.hypot(vertices[index*2]-point[0],vertices[index*2+1]-point[1])})).sort((a,b)=>a.distance-b.distance).slice(0,3);
  const raw=near.map(p=>1/Math.max(p.distance,1e-6)),sum=raw.reduce((a,b)=>a+b,0);return near.map((p,i)=>({index:p.index,weight:raw[i]/sum}));
}

export function captureHandState(model: Live2DModel, drawableId: string, label: string): AttachmentHandState {
  const internal=model.internalModel,index=internal.getDrawableIndex(drawableId);
  if(index<0)throw new Error('HAND_STATE_DRAWABLE_MISSING:'+drawableId);
  const vertices=Array.from(internal.getDrawableVertices(index));
  if(vertices.length<6||vertices.some(v=>!Number.isFinite(v)))throw new Error('HAND_REFERENCE_NOT_READY');
  const center=[0,0];for(let i=0;i<vertices.length;i+=2){center[0]+=vertices[i]/(vertices.length/2);center[1]+=vertices[i+1]/(vertices.length/2);}
  const core=(internal as any).coreModel;if(typeof core?.getIndexArray!=='function')throw new Error('HAND_RUNTIME_UNSUPPORTED');
  return {id:crypto.randomUUID(),displayName:label,drawableId,anchors:Array.from({length:vertices.length/2},(_,index)=>({index,weight:1,neutral:{x:vertices[index*2],y:vertices[index*2+1]}})),contact:contactWeights(vertices,center,core.getIndexArray(index)),insertion:'before',mirrorX:false,rotationOffsetRad:0};
}

export function captureAnonWinterHandBinding(model: Live2DModel, profile: Live2DModelProfile, textureLayer:'front'|'back'): AttachmentHandBinding {
  if(!profile.modelPath.replace(/\\/g,'/').endsWith('anon/school_winter-2023/model.json'))throw new Error('HAND_SAMPLE_MODEL_MISMATCH:这份手部样本只适用爱音2023冬季校服；其他外观请记录自己的状态');
  const states=[captureHandState(model,'D_PSD1.97','画面右手 · 手型3'),captureHandState(model,'D_PSD1.98','画面右手 · 手型4')];
  states[0].id='hand-right-3';states[1].id='hand-right-4';states[1].insertion='after';states[1].mirrorX=true;
  const point=[0,0];for(const s of states)for(const a of s.anchors){point[0]+=a.neutral.x/s.anchors.length/2;point[1]+=a.neutral.y/s.anchors.length/2;}
  const core=(model.internalModel as any).coreModel;
  for(const state of states)state.contact=contactWeights(state.anchors.flatMap(a=>[a.neutral.x,a.neutral.y]),point,core.getIndexArray(model.internalModel.getDrawableIndex(state.drawableId)));
  for(const state of states){const axis=resolveHandFlipAxis(state,profile.modelPath,model.internalModel.localTransform);state.flipAxis={angleRad:axis.angleRad,offset:{...axis.offset}};}
  return parseAttachmentHandBinding({version:1,runtime:'cubism2',textureLayer,transition:'weighted-scenes',unsupportedState:'hide-with-diagnostic',states});
}

/** Creates a new Profile identity in the attachment's adaptation; never overwrites the source Profile. */
export function profileForHandBinding(base: Live2DModelProfile, binding: AttachmentHandBinding) {
  const profile=JSON.parse(JSON.stringify(base)) as Live2DModelProfile,state=binding.states[0],name='user.hand-state-contact';
  profile.modelProfileId='user-profile-'+crypto.randomUUID();
  profile.profileVersion=1;
  const anchors=state.anchors;
  let best=[anchors[0],anchors[1],anchors[2]],area=0;
  for(let i=1;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++){const a=anchors[0].neutral,b=anchors[i].neutral,c=anchors[j].neutral,n=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));if(n>area){area=n;best=[anchors[0],anchors[i],anchors[j]];}}
  if(area<1e-6)throw new Error('HAND_REFERENCE_DEGENERATE');
  profile.anchors=profile.anchors.filter(a=>a.name!==name);
  profile.anchors.push({name,displayName:'手部状态接点（画面参照）',anchorProfileId:profile.modelProfileId+'-contact',drawableId:state.drawableId,vertexCount:state.anchors.length,points:best.map(a=>({...a,neutral:{...a.neutral}}))});
  return {profile,anchorName:name};
}
