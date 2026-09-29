import type {AttachmentHandState} from './handBinding';
import type {Point2D} from '../live2dRigidFit';

/** Both wrist edges (0–13) and interior palm landmarks were inspected on the
 * real sample meshes. Thumb/finger tips must not bias the palm center. This is a candidate axis,
 * specific to Anon's winter meshes, never a general semantic classifier. */
export function resolveHandFlipAxis(state:AttachmentHandState,modelPath:string,transform:{a:number;b:number;c:number;d:number}) {
  if(state.flipAxis)return {angleRad:state.flipAxis.angleRad,offset:{...state.flipAxis.offset},source:'configured' as const};
  if(modelPath.replace(/\\/g,'/').endsWith('anon/school_winter-2023/model.json')&&['D_PSD1.97','D_PSD1.98'].includes(state.drawableId)){
    const palmIds=state.drawableId==='D_PSD1.97'?[19,22,27]:[20,23,26,35];
    const wrist=state.anchors.filter(a=>a.index<=13),palm=state.anchors.filter(a=>palmIds.includes(a.index));
    if(wrist.length===14&&palm.length===palmIds.length){
      const mean=(rows:typeof wrist)=>rows.reduce((p,a)=>({x:p.x+a.neutral.x/rows.length,y:p.y+a.neutral.y/rows.length}),{x:0,y:0});
      const a=mean(wrist),b=mean(palm),dx=b.x-a.x,dy=b.y-a.y;
      const x=transform.a*dx+transform.c*dy,y=transform.b*dx+transform.d*dy;
      if(Math.hypot(x,y)>1e-6)return {angleRad:Math.atan2(y,x),offset:{x:0,y:0},source:'anon-winter-candidate' as const};
    }
  }
  return {angleRad:Math.PI/2,offset:{x:0,y:0},source:'uncalibrated-local-vertical' as const};
}

/** Reflection of an already calibrated point, including its displacement. */
export function reflectHandPoint(p:Point2D,origin:Point2D,angle:number):Point2D {
  const x=p.x-origin.x,y=p.y-origin.y,c=Math.cos(2*angle),s=Math.sin(2*angle);
  return {x:origin.x+c*x+s*y,y:origin.y+s*x-c*y};
}
