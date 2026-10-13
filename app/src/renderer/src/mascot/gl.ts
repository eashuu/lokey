import type { Params } from './rig'

// WebGL2 renderer for the 3D mascot: one full-screen triangle, a raymarched signed-distance-field character
// (water-drop body, two arms, face painted in the body's own 3D space so it turns with the head).

const VERT = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform vec4 u0, u1, u2, u3, u4, u5, u6, u7, u8;
uniform vec3 cTop, cBot, cGlow, cInk, cFoot;

mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }

float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
float ell(vec2 p, vec2 r){ return (length(p / r) - 1.) * min(r.x, r.y); }

mat3 BR; vec3 BC; float SQ; float SC;
float FORM; float PUFF; vec2 JEL;
float G_dBody, G_dFoot;

// body: u8.x = form (0 water drop .. 1 round puffball), u1.w = tuft sway
float body(vec3 q){
  float tip = u1.w;
  float dd = length(q - vec3(0., -.16, 0.)) - .5;
  dd = smin(dd, length(q - vec3(tip * .04, .2, 0.)) - .34, .3);
  dd = smin(dd, length(q - vec3(tip * .14, .56, 0.)) - .085, .3);
  if (FORM < .5) return dd;
  // round and soft, a touch wider than tall, swelling with puff
  vec3 pq = q - vec3(0., -.04, 0.);
  pq.y *= 1.05;
  float dp = length(pq) - .55 * (1. + PUFF * .11);
  // a small curled tuft on top (swings with tip)
  float sw = tip * .03;
  float tu = length(q - vec3(.01 + sw, .54 + PUFF * .05, .03)) - .08;
  tu = smin(tu, length(q - vec3(.08 + sw * 1.6, .64 + PUFF * .05, .03)) - .066, .08);
  tu = smin(tu, length(q - vec3(.16 + sw * 2.2, .68 + PUFF * .05, .03)) - .054, .08);
  tu = smin(tu, length(q - vec3(.215 + sw * 2.6, .635 + PUFF * .05, .03)) - .042, .06);
  return smin(dp, tu, .13);
}
// stubby mitten arms on the puffball, longer thin arms on the drop
float arm(vec3 q, float side, vec4 a){
  float L1 = mix(.24, .15, FORM), L2 = mix(.2, .13, FORM);
  vec3 sh = vec3(side * mix(.4, .47, FORM), mix(-.04, -.02, FORM), .07);
  float ang = .2 + a.x * 2.9;
  vec3 e = sh + L1 * vec3(side * sin(ang), -cos(ang), a.y * .55);
  float ang2 = ang + a.z * 1.7;
  vec3 h = e + L2 * vec3(side * sin(ang2), -cos(ang2), a.y * .55 + a.z * .35);
  float d = sdCap(q, sh, e, mix(.085, .105, FORM));
  d = smin(d, sdCap(q, e, h, mix(.075, .095, FORM)), .06);
  return smin(d, length(q - h) - (mix(.115, .135, FORM) + a.w * .03), .05);
}
// two oval feet under the puffball (they lift a little when it hops)
float feet(vec3 q){
  float lift = clamp(u1.y, 0., 1.) * .07;
  vec3 r = vec3(.17, .1, .21);
  vec3 a = (q - vec3(-.2, -.53 + lift, .1)) / r, b = (q - vec3(.2, -.53 + lift, .1)) / r;
  return (min(length(a), length(b)) - 1.) * .1;
}
vec3 toLocal(vec3 p){
  vec3 q = transpose(BR) * (p - BC);
  float sq = clamp(SQ + JEL.y, -.45, .5);
  q.x += q.y * JEL.x * .6;             // jelly shear
  q.y /= (1. - sq); q.xz /= (1. + sq * .5); q /= SC;
  return q;
}
float map(vec3 p){
  vec3 q = toLocal(p);
  float d = body(q);
  d = smin(d, arm(q, -1., u2), .1);
  d = smin(d, arm(q, 1., u3), .1);
  G_dBody = d;
  G_dFoot = FORM > .5 ? feet(q) : 1e3;
  d = smin(d, G_dFoot, .06);
  return d * SC * .75;
}
vec3 nrm(vec3 p){
  vec2 e = vec2(1., -1.) * .0015;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main(){
  float hh = u7.w;
  float asp = uRes.x / uRes.y;
  vec2 uv = (gl_FragCoord.xy / uRes.y - vec2(asp * .5, .5)) * 2.;
  BR = rotZ(u0.z) * rotX(u0.y) * rotY(u0.x);
  BC = vec3(u1.x * .12, u1.y * .24, 0.);
  SQ = u0.w; SC = max(.2, u1.z);
  FORM = u8.x; PUFF = u8.y; JEL = u8.zw;

  vec3 ro = vec3(0., 0., 5.);
  vec3 tp = vec3(uv.x * hh, uv.y * hh, 0.);
  vec3 rd = normalize(tp - ro);
  float t = 3.1, dmin = 1e3; bool hit = false;
  for (int i = 0; i < 60; i++){
    float d = map(ro + rd * t);
    dmin = min(dmin, d);
    if (d < .0008){ hit = true; break; }
    t += d * .9;
    if (t > 7.) break;
  }
  float px = 2. * hh / uRes.y;
  float cov = hit ? 1. : 1. - smoothstep(0., px * 1.2, dmin);
  // the halo must be exactly 0 at the canvas border, or the canvas shows up as a box
  vec2 nb = abs(gl_FragCoord.xy / uRes * 2. - 1.);
  float vig = (1. - smoothstep(.45, 1., nb.x)) * (1. - smoothstep(.45, 1., nb.y));
  float halo = hit ? 0. : exp(-max(dmin, 0.) * 5.) * .3 * u7.y * vig * vig;

  vec3 col = vec3(0.);
  if (cov > 0.){
    vec3 p = ro + rd * t;
    vec3 n = nrm(p);
    float footM = FORM > .5 ? smoothstep(.02, -.02, G_dFoot - G_dBody) : 0.;
    vec3 V = -rd;
    vec3 q = toLocal(p);
    vec3 L = normalize(vec3(-.45, .75, .55));
    float dif = clamp(dot(n, L) * .5 + .5, 0., 1.); dif *= dif;
    float fre = pow(1. - clamp(dot(n, V), 0., 1.), 2.6);
    float h = clamp((q.y + .5) / 1.1, 0., 1.);
    vec3 base = mix(cBot, cTop, h * h * (3. - 2. * h));
    base = mix(base, cFoot, footM);
    col = base * (.5 + .5 * dif);
    col += cGlow * fre * mix(.6, .42, FORM);
    vec3 H = normalize(L + V);
    col += vec3(1.) * pow(clamp(dot(n, H), 0., 1.), mix(56., 38., FORM)) * mix(.85, .55, FORM);
    vec3 L2 = normalize(vec3(.7, -.4, .35));
    col += cGlow * pow(clamp(dot(n, L2), 0., 1.), 2.) * .22;
    float inner = max(-map(p - n * .2), 0.);
    col = mix(col, cTop + cGlow * .15, exp(-inner * 7.) * .2 * (1. - FORM * .5));

    // face, in the body's own space: only on the body surface, facing forward
    float front = smoothstep(.12, .3, q.z);
    float armD = min(arm(q, -1., u2), arm(q, 1., u3));
    float notArm = smoothstep(.0, .08, armD - body(q) + .06);
    float face = front * notArm * (1. - footM);
    float aa = px * 1.3 / SC;
    vec2 f = q.xy;
    float inkA = 0.;
    float hi = 0.;
    float eyeLow = 0.;
    vec3 add = vec3(0.);
    vec2 er = mix(vec2(.062, .095), vec2(.072, .128), FORM);
    for (int k = 0; k < 2; k++){
      float s = k == 0 ? -1. : 1.;
      float open = k == 0 ? u4.x : u4.y;
      vec2 e = vec2(s * mix(.175, .185, FORM) + u4.z * .04, mix(.0, .03, FORM) + u4.w * .035);
      float dE = ell(f - e, vec2(er.x, er.y * max(open, .07)));
      float dH = max(ell(f - e, vec2(.075, .075)), -ell(f - e - vec2(0., -.045), vec2(.08, .08)));
      float d = mix(dE, dH, u5.w);
      float ea = 1. - smoothstep(-aa, aa, d);
      inkA = max(inkA, ea);
      eyeLow = max(eyeLow, ea * smoothstep(.2, -.85, (f.y - e.y) / (er.y * max(open, .3))) * (1. - u5.w));
      float open1 = smoothstep(.35, .8, open) * (1. - u5.w);
      float h1 = (1. - smoothstep(-aa, aa, length(f - e - mix(vec2(.02, .03), vec2(.024, .052), FORM)) - mix(.02, .032, FORM))) * open1;
      float h2 = FORM * (1. - smoothstep(-aa, aa, length(f - e - vec2(-.022, -.05)) - .014)) * open1 * .85;
      hi = max(hi, max(h1, h2));
      // brows
      float bw = k == 0 ? u5.x : u5.y;
      vec2 bp = f - vec2(s * .175, .14 + FORM * .05 + bw * .045);
      float phi = -s * u5.z * .5;
      float cs = cos(phi), sn = sin(phi);
      bp = vec2(bp.x * cs + bp.y * sn, -bp.x * sn + bp.y * cs);
      float dB = sdCap(vec3(bp, 0.), vec3(-.05, 0., 0.), vec3(.05, 0., 0.), .011);
      float vis = smoothstep(.04, .25, abs(bw) + abs(u5.z));
      inkA = max(inkA, (1. - smoothstep(-aa, aa, dB)) * vis * .85);
      // cheeks
      float ch = smoothstep(1., .15, length((f - vec2(s * mix(.3, .35, FORM), mix(-.1, -.11, FORM))) / mix(vec2(.085, .05), vec2(.108, .066), FORM)));
      add += vec3(1., .5, .62) * ch * (.12 + .5 * u7.x) * (1. + FORM * .5) * face;
    }
    // mouth
    float my = mix(-.2, -.17, FORM);
    float w = mix(.095, .075, FORM);
    float x = f.x;
    float yc = my - u6.x * .04 * (1. - pow(clamp(abs(x) / w, 0., 1.), 2.)) + sin(x * 70. + u7.z * 24.) * .005 * u6.w;
    float dL = max(abs(f.y - yc) - .0105, abs(x) - w);
    float lineA = 1. - smoothstep(-aa, aa, dL);
    float op = u6.y;
    vec2 mr = vec2(mix(.05 + .028 * op, .03 + .03 * op, u6.z), .011 + .085 * op);
    float dO = ell(f - vec2(0., my - .018 * op), mr);
    float openA = (1. - smoothstep(-aa, aa, dO)) * smoothstep(.04, .12, op);
    float tongue = (1. - smoothstep(-aa, aa, ell(f - vec2(0., my - .018 * op - mr.y * .55), vec2(mr.x * .72, mr.y * .5)))) * openA;
    inkA = max(inkA, max(lineA * (1. - smoothstep(.04, .12, op)), openA));
    col += add;
    vec3 eyeC = mix(cInk, mix(cInk, cGlow, .5) + vec3(.02), eyeLow * FORM);
    col = mix(col, eyeC, inkA * face);
    col = mix(col, vec3(1., .52, .6), tongue * face * .85);
    col = mix(col, vec3(1.), hi * face);
  }
  vec3 outc = col * cov + cGlow * halo * (1. - cov);
  float a = cov + halo * (1. - cov);
  // triangular dither: smooth low-alpha gradients on 8-bit surfaces otherwise band into visible steps
  float h1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float h2 = fract(sin(dot(gl_FragCoord.xy + vec2(3.1, 7.7), vec2(12.9898, 78.233))) * 43758.5453);
  float dn = (h1 + h2 - 1.) / 255.;
  if (a > .0004) { a = clamp(a + dn, 0., 1.); outc = clamp(outc + dn, 0., a); }
  o = vec4(outc, a);
}`

const hex = (h: string): [number, number, number] => { const n = parseInt(h.replace('#', '').slice(0, 6), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] }

export interface MascotColors { top: string; bottom: string; glow: string; ink: string; foot: string; /** 0 = water drop, 1 = puffball */ form: number }

export class MascotGL {
  private gl: WebGL2RenderingContext
  private p!: WebGLProgram
  private vs!: WebGLShader
  private fs!: WebGLShader
  private par: { COMPLETION_STATUS_KHR: number } | null = null
  private linked = false
  private u: Record<string, WebGLUniformLocation | null> = {}
  private vao: WebGLVertexArrayObject | null

  /** Throws when WebGL2 or the shader is unavailable; callers fall back to the 2D mascot. */
  constructor(private cv: HTMLCanvasElement) {
    const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl
    this.par = gl.getExtension('KHR_parallel_shader_compile')
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const p = gl.createProgram()!
    this.vs = sh(gl.VERTEX_SHADER, VERT)
    this.fs = sh(gl.FRAGMENT_SHADER, FRAG)
    gl.attachShader(p, this.vs)
    gl.attachShader(p, this.fs)
    gl.linkProgram(p)
    this.p = p
    // without the extension, status queries block until the compile finishes (same as before, just later)
    this.vao = gl.createVertexArray()
    if (!this.par) this.check()
  }

  private check() {
    const { gl, p } = this
    if (!gl.getShaderParameter(this.vs, gl.COMPILE_STATUS)) throw new Error('vertex shader: ' + gl.getShaderInfoLog(this.vs))
    if (!gl.getShaderParameter(this.fs, gl.COMPILE_STATUS)) throw new Error('fragment shader: ' + gl.getShaderInfoLog(this.fs))
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p))
    gl.useProgram(p)
    for (const n of ['uRes', 'u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'cTop', 'cBot', 'cGlow', 'cInk', 'cFoot']) this.u[n] = gl.getUniformLocation(p, n)
    gl.bindVertexArray(this.vao)
    gl.clearColor(0, 0, 0, 0)
    this.linked = true
  }

  /** true once the program is linked; with KHR_parallel_shader_compile the compile runs off-thread and never stalls a frame. Throws if it failed. */
  ready(): boolean {
    if (this.linked) return true
    if (this.par && !this.gl.getProgramParameter(this.p, this.par.COMPLETION_STATUS_KHR)) return false
    this.check()
    return true
  }

  resize(w: number, h: number) {
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h }
    this.gl.viewport(0, 0, w, h)
  }

  draw(P: Params, c: MascotColors, time: number, halo: number, frame = 1.08) {
    const { gl, u } = this
    gl.uniform2f(u.uRes, this.cv.width, this.cv.height)
    gl.uniform4f(u.u0, P.yaw, P.pitch, P.roll, P.squash)
    gl.uniform4f(u.u1, P.leanX, P.hop, P.scale, P.tip)
    gl.uniform4f(u.u2, P.aLr, P.aLf, P.aLb, P.aLo)
    gl.uniform4f(u.u3, P.aRr, P.aRf, P.aRb, P.aRo)
    gl.uniform4f(u.u4, P.eyeL, P.eyeR, P.gazeX, P.gazeY)
    gl.uniform4f(u.u5, P.browL, P.browR, P.browAng, P.happy)
    gl.uniform4f(u.u6, P.smile, P.mouthOpen, P.mouthRound, P.wobble)
    gl.uniform4f(u.u7, P.blush, halo, time, frame)
    gl.uniform4f(u.u8, c.form, P.puff, P.jx, P.jy)
    gl.uniform3fv(u.cFoot, hex(c.foot))
    gl.uniform3fv(u.cTop, hex(c.top))
    gl.uniform3fv(u.cBot, hex(c.bottom))
    gl.uniform3fv(u.cGlow, hex(c.glow))
    gl.uniform3fv(u.cInk, hex(c.ink))
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* already gone */ }
  }
}
