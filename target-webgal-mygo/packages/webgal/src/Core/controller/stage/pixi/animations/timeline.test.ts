import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/Core/WebGAL', () => ({WebGAL:{gameplay:{pixiStage:{getStageObjByKey:vi.fn()}}}}));
vi.mock('@/Core/controller/stage/pixi/PixiController', () => ({default:{assignTransform:vi.fn((container, value)=>Object.assign(container,value))}}));
const {WebGAL}=await import('@/Core/WebGAL');
const {generateTimelineObj}=await import('./timeline');
let now=0,id=0,frames:Map<number,FrameRequestCallback>;
let container:{x:number;y:number;scale:{x:number;y:number}};
beforeEach(()=>{
  now=0;id=0;frames=new Map();container={x:0,y:0,scale:{x:1,y:1}};
  vi.spyOn(performance,'now').mockImplementation(()=>now);
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++id,cb);return id;});
  vi.stubGlobal('cancelAnimationFrame',(key:number)=>frames.delete(key));
  vi.mocked(WebGAL.gameplay.pixiStage!.getStageObjByKey).mockReturnValue({pixiContainer:container} as any);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function tick(time:number){now=time;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb(time));}
function timeline(done=vi.fn()){
  return generateTimelineObj([
    {position:{x:0,y:0},scale:{x:1,y:1},duration:0,ease:'easeInOut'},
    {position:{x:100,y:50},scale:{x:2,y:3},duration:5100,ease:'easeInOut'},
  ],'fig-center',5100,done);
}
describe('production timeline final-frame behavior',()=>{
  it('runs all numeric channels to the endpoint before natural cleanup at low FPS',()=>{
    let cleanup:ReturnType<typeof timeline>;
    const done=vi.fn(()=>{expect(container.x).toBe(100);expect(container.scale.y).toBe(3);cleanup.setEndState();});
    cleanup=timeline(done);cleanup.setStartState();
    for(let t=1000/15;t<5100;t+=1000/15)tick(t);
    expect(done).not.toHaveBeenCalled();tick(5100);
    expect(done).toHaveBeenCalledTimes(1);expect(container).toEqual(expect.objectContaining({x:100,y:50,scale:{x:2,y:3}}));
    expect(frames.size).toBe(0);
  });
  it('forced settlement immediately applies the endpoint and cancels stale updates',()=>{
    const done=vi.fn(),animation=timeline(done);animation.setStartState();tick(100);
    animation.setEndState();tick(6000);
    expect(container.x).toBe(100);expect(done).not.toHaveBeenCalled();expect(frames.size).toBe(0);
  });
  it('keep/replacement without endpoint freezes the current frame',()=>{
    const done=vi.fn(),animation=timeline(done);animation.setStartState();tick(1000);
    const value=container.x;animation.forceStopWithoutSetEndState?.();tick(6000);
    expect(container.x).toBe(value);expect(value).toBeGreaterThan(0);expect(value).toBeLessThan(100);
    expect(done).not.toHaveBeenCalled();expect(frames.size).toBe(0);
  });
});
