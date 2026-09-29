import type * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display-webgal';

/** Private calls are isolated to the capability-checked Cubism2 adapter. */
type SDK = any;
export interface HandRenderPresentation {
  id: string;
  insertion: 'before' | 'after';
  weight: number;
  quad: Float32Array;
  texture: PIXI.Texture;
  opacity: number;
}
export interface HandRenderOwner {
  renderer: PIXI.Renderer;
  presentations(): readonly HandRenderPresentation[];
  fail(error: Error): void;
}

const sessions = new WeakMap<object, Cubism2HandRenderer>();
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);

/** Figure registration can precede the Cubism2 draw context's first frame. */
export function hasCubism2HandRenderCapability(model: Live2DModel) {
  const internal = model.internalModel as SDK;
  const core = internal?.coreModel, mc = core?.getModelContext?.(), dp = core?.getDrawParam?.();
  return Boolean(core && typeof internal.draw === 'function' && typeof dp?._$Uo === 'function' &&
    typeof dp?.getClipBufPre_clipContextDraw === 'function' && mc?._$Ws && mc?._$Er);
}

export function registerCubism2HandRenderer(model: Live2DModel, owner: HandRenderOwner) {
  const internal = model.internalModel as SDK;
  let session = sessions.get(internal);
  if (!session) { session = new Cubism2HandRenderer(internal); sessions.set(internal, session); }
  return session.add(owner);
}

export function readCubism2HandDiagnostics(model: Live2DModel, checkGL = false) {
  return sessions.get(model.internalModel)?.diagnostics(checkGL) ?? { owners: 0, drawableHooks: 0, framebuffers: 0 };
}

class Cubism2HandRenderer {
  private owners = new Set<HandRenderOwner>();
  private originals: { drawable: SDK; draw: SDK; wrapper: SDK }[] = [];
  private originalDraw: SDK;
  private wrapper: SDK;
  private drawing = false;
  private selected: HandRenderPresentation[] = [];
  private inserted = new Set<HandRenderPresentation>();
  private gl?: WebGLRenderingContext;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private targets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];
  private size = '';
  private drawCalls = 0;
  private weightedFrames = 0;
  private insertedQuads = 0;

  constructor(private internal: SDK) {
    const core = internal.coreModel, mc = core?.getModelContext?.(), dp = core?.getDrawParam?.();
    if (!hasCubism2HandRenderCapability({ internalModel: internal } as Live2DModel))
      throw new Error('HAND_RUNTIME_UNSUPPORTED:当前模型或SDK不具备已验证的Cubism2内部绘制能力');
    this.originalDraw = internal.draw;
    const session = this;
    this.wrapper = function(gl: WebGLRenderingContext) { session.draw(gl); };
    internal.draw = this.wrapper;
    for (let i = 0; mc.getDrawData(i); i++) {
      const drawable = mc.getDrawData(i), draw = drawable.draw;
      const wrapper = function(this: SDK, ...args: SDK[]) {
        const id = drawable.getDrawDataID().id;
        if (session.drawing) session.insertAt(id, 'before');
        const result = draw.apply(this, args);
        if (session.drawing) session.insertAt(id, 'after');
        return result;
      };
      drawable.draw = wrapper; this.originals.push({ drawable, draw, wrapper });
    }
  }
  add(owner: HandRenderOwner) {
    this.owners.add(owner); let active = true;
    return () => { if (!active) return; active = false; this.owners.delete(owner); if (!this.owners.size) this.destroy(); };
  }
  private insertAt(id: string, insertion: string) {
    const core = this.internal.coreModel, dp = core.getDrawParam();
    for (const p of this.selected) {
      if (p.id !== id || p.insertion !== insertion || this.inserted.has(p)) continue;
      const renderer = [...this.owners][0]?.renderer;
      if (!renderer || renderer.gl !== this.gl) throw new Error('HAND_RENDERER_CONTEXT_MISMATCH');
      renderer.texture.bind(p.texture.baseTexture, 0);
      const texture = (p.texture.baseTexture as SDK)._glTextures[renderer.CONTEXT_UID]?.texture;
      if (!texture) throw new Error('HAND_TEXTURE_NOT_READY');
      const slot = this.internal.settings.textures.length;
      const textures = dp.textures, oldLength = Array.isArray(textures) ? textures.length : undefined;
      const hadSlot = Array.isArray(textures) && Object.prototype.hasOwnProperty.call(textures,slot), oldTexture = textures?.[slot];
      const clip = dp.getClipBufPre_clipContextDraw(), culling = dp.culling;
      dp.setClipBufPre_clipContextForDraw(null); dp._$WP(false);
      try { core.setTexture(slot, texture); dp._$Uo(slot, 6, indices, p.quad, uv, p.opacity, this.originals[0].drawable._$6s, {}); this.inserted.add(p); this.insertedQuads++; }
      finally { if (Array.isArray(textures)) {if(hadSlot)textures[slot]=oldTexture;else delete textures[slot];textures.length=oldLength!;} dp.setClipBufPre_clipContextForDraw(clip); dp._$WP(culling); }
    }
  }
  private branch(gl: WebGLRenderingContext, selected: HandRenderPresentation[]) {
    this.selected = selected; this.inserted.clear(); this.drawing = true;
    try { this.originalDraw.call(this.internal, gl); }
    finally { this.drawing = false; this.selected = []; }
    if (this.inserted.size !== selected.length) throw new Error('HAND_INSERTION_MISSING:手型插层目标未进入当前绘制序列');
  }
  private draw(gl: WebGLRenderingContext) {
    this.drawCalls++;
    const owners = [...this.owners];
    try {
      const lists = owners.map(o => o.presentations().filter(p => p.weight > 1e-6 && p.opacity > 1e-6)).filter(l => l.length);
      let branches: { weight: number; selected: HandRenderPresentation[] }[] = [{ weight: 1, selected: [] }];
      for (const list of lists) branches = branches.flatMap(b => list.map(p => ({ weight: b.weight * p.weight, selected: [...b.selected, p] })));
      if (branches.length > 16) throw new Error('HAND_TRANSITION_COMPLEXITY_LIMIT:同时交接组合超过16，减少同人物的手部附件');
      if (this.gl && this.gl !== gl) this.releaseGPU();
      this.gl = gl;
      if (branches.length === 1) { this.branch(gl, branches[0].selected); return; }
      this.weightedFrames++;
      const binding = gl.getParameter(gl.FRAMEBUFFER_BINDING), viewport = Array.from(gl.getParameter(gl.VIEWPORT)) as number[];
      const clearColor = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)) as number[];
      const stencil = gl.isEnabled(gl.STENCIL_TEST);
      const width = viewport[0] + viewport[2], height = viewport[1] + viewport[3];
      try {
        this.prepare(gl, width, height, branches.length);
        // Parent stencil applies once at final composition. These color-only
        // scene targets do not share the parent's stencil attachment.
        gl.disable(gl.STENCIL_TEST);
        for (let i = 0; i < branches.length; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[i].framebuffer); gl.viewport(...viewport as [number,number,number,number]);
          gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); this.branch(gl, branches[i].selected);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, binding); gl.viewport(...viewport as [number,number,number,number]);
        gl.useProgram(this.program!); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!);
        const location = gl.getAttribLocation(this.program!, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
        gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // Draw weighted premultiplied scenes additively into a transparent accumulator,
        // then source-over that single result onto the existing parent target.
        const accumulator = this.targets[branches.length];
        gl.bindFramebuffer(gl.FRAMEBUFFER, accumulator.framebuffer); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendFunc(gl.ONE,gl.ONE);
        for (let i = 0; i < branches.length; i++) this.blit(gl,this.targets[i].texture,branches[i].weight,viewport,width,height);
        gl.bindFramebuffer(gl.FRAMEBUFFER,binding); if(stencil)gl.enable(gl.STENCIL_TEST); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA); this.blit(gl,accumulator.texture,1,viewport,width,height);
      } finally { gl.bindFramebuffer(gl.FRAMEBUFFER,binding); gl.viewport(...viewport as [number,number,number,number]); gl.clearColor(...clearColor as [number,number,number,number]); if(stencil)gl.enable(gl.STENCIL_TEST);else gl.disable(gl.STENCIL_TEST); gl.activeTexture(gl.TEXTURE0); }
    } catch (error) {
      this.drawing = false; this.selected = [];
      for (const owner of owners) owner.fail(error instanceof Error ? error : new Error(String(error)));
      // Failure removes these owners before the untouched model draw; never leave an invisible figure.
      this.originalDraw.call(this.internal,gl);
    }
  }
  private blit(gl: WebGLRenderingContext, texture: WebGLTexture, weight: number, viewport: number[], width: number, height: number) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.uniform1i(gl.getUniformLocation(this.program!,'image'),0); gl.uniform1f(gl.getUniformLocation(this.program!,'weight'),weight);
    gl.uniform4f(gl.getUniformLocation(this.program!,'region'),viewport[0]/width,viewport[1]/height,viewport[2]/width,viewport[3]/height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  private prepare(gl: WebGLRenderingContext, width: number, height: number, count: number) {
    if (width <= 0 || height <= 0 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || height > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
        width * height * 4 * (count + 1) > 128 * 1024 * 1024)
      throw new Error('HAND_RENDER_TARGET_BUDGET_EXCEEDED:手部交接所需显存或画面尺寸超出首版边界，请减少同人物的手部附件或降低预览尺寸');
    if (!this.program) {
      const make = (type:number, source:string) => { const shader=gl.createShader(type)!; gl.shaderSource(shader,source); gl.compileShader(shader); if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error('HAND_SHADER_COMPILE_FAILED'); return shader; };
      this.program=gl.createProgram()!;
      const shaders=[make(gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}'),make(gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform sampler2D image;uniform float weight;uniform vec4 region;void main(){gl_FragColor=texture2D(image,region.xy+uv*region.zw)*weight;}')];
      for(const shader of shaders)gl.attachShader(this.program,shader); gl.linkProgram(this.program); for(const shader of shaders)gl.deleteShader(shader);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('HAND_SHADER_LINK_FAILED');
      this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    }
    const size=width+'x'+height;
    if(this.size!==size){for(const t of this.targets){gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.framebuffer);}this.targets=[];this.size=size;}
    while(this.targets.length<=count){const texture=gl.createTexture()!,framebuffer=gl.createFramebuffer()!;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('HAND_FRAMEBUFFER_INCOMPLETE');this.targets.push({texture,framebuffer});}
  }
  private destroy() {
    if(this.internal.draw===this.wrapper)this.internal.draw=this.originalDraw;
    for(const {drawable,draw,wrapper} of this.originals)if(drawable.draw===wrapper)drawable.draw=draw;
    this.releaseGPU();
    sessions.delete(this.internal);
  }
  private releaseGPU() {
    if(this.gl){for(const t of this.targets){this.gl.deleteTexture(t.texture);this.gl.deleteFramebuffer(t.framebuffer);}if(this.program)this.gl.deleteProgram(this.program);if(this.buffer)this.gl.deleteBuffer(this.buffer);}
    this.targets=[];this.program=undefined;this.buffer=undefined;this.size='';
  }
  diagnostics(checkGL: boolean) {
    return {owners:this.owners.size,drawableHooks:this.originals.length,framebuffers:this.targets.length,drawCalls:this.drawCalls,weightedFrames:this.weightedFrames,insertedQuads:this.insertedQuads,...(checkGL&&this.gl?{glError:this.gl.getError()}: {})};
  }
}
