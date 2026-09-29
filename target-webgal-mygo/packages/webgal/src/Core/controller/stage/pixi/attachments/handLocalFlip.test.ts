import {describe,it,expect} from 'vitest';
import {cloneAttachmentHandBinding,parseAttachmentHandBinding} from './handBinding';
import {reflectHandPoint,resolveHandFlipAxis} from './handLocalFlip';
const state={id:'s',displayName:'hand',drawableId:'mesh',anchors:[0,1,2].map(index=>({index,weight:1,neutral:{x:index,y:index===2?1:0}})),contact:[{index:0,weight:1}],insertion:'before' as const,mirrorX:true,rotationOffsetRad:0};
const base={version:1,runtime:'cubism2',textureLayer:'front',transition:'weighted-scenes',unsupportedState:'hide-with-diagnostic',states:[state]};
describe('hand axis calibration contract',()=>{
  it('keeps points on an offset semantic axis fixed and a second flip restores every point',()=>{
    const o={x:33,y:-21},a=.7,u={x:Math.cos(a),y:Math.sin(a)},p={x:o.x+80*u.x,y:o.y+80*u.y};expect(reflectHandPoint(p,o,a)).toEqual(p);
    const q={x:50,y:120},r=reflectHandPoint(reflectHandPoint(q,o,a),o,a);expect(r.x).toBeCloseTo(q.x,10);expect(r.y).toBeCloseTo(q.y,10);
  });
  it('preserves explicit axes through JSON roundtrip and deep clone, without mutating legacy input',()=>{
    const legacy=JSON.stringify(base),parsed=parseAttachmentHandBinding(base);expect(parsed.states[0].flipAxis).toBeUndefined();expect(JSON.stringify(base)).toBe(legacy);
    parsed.states[0].flipAxis={angleRad:.7,offset:{x:50,y:120}};const copy=cloneAttachmentHandBinding(JSON.parse(JSON.stringify(parsed)));expect(copy).toEqual(parsed);copy.states[0].flipAxis!.offset.x=99;expect(parsed.states[0].flipAxis!.offset.x).toBe(50);
  });
  it.each([{angleRad:NaN,offset:{x:0,y:0}},{angleRad:0,offset:{x:Infinity,y:0}},{angleRad:0,offset:{x:0}}])('rejects malformed axis %#',flipAxis=>{expect(()=>parseAttachmentHandBinding({...base,states:[{...state,flipAxis}]})).toThrow('HAND_BINDING_INVALID');});
  it('does not infer Anon anatomy for other models, and explicit axis wins over the sample candidate',()=>{
    const anchors=Array.from({length:37},(_,index)=>({index,weight:1,neutral:{x:index>13?20:0,y:index>13?5:0}}));
    const s={...state,drawableId:'D_PSD1.97',anchors},t={a:2,b:0,c:0,d:2};expect(resolveHandFlipAxis(s,'game/figure/anon/school_winter-2023/model.json',t).source).toBe('anon-winter-candidate');
    expect(resolveHandFlipAxis(s,'game/figure/other/model.json',t).source).toBe('uncalibrated-local-vertical');expect(resolveHandFlipAxis({...s,flipAxis:{angleRad:1,offset:{x:3,y:4}}},'game/figure/anon/school_winter-2023/model.json',t)).toMatchObject({angleRad:1,offset:{x:3,y:4},source:'configured'});
  });
  it('ignores thumb and finger tips when deriving the inspected winter palm axis',()=>{
    const anchors=Array.from({length:30},(_,index)=>({index,weight:1,neutral:{x:index<=13?0:[19,22,27].includes(index)?10:900,y:index<=13?0:[19,22,27].includes(index)?30:-900}}));
    const axis=resolveHandFlipAxis({...state,drawableId:'D_PSD1.97',anchors},'game/figure/anon/school_winter-2023/model.json',{a:1,b:0,c:0,d:1});
    expect(axis.angleRad).toBeCloseTo(Math.atan2(30,10),12);
  });
});
