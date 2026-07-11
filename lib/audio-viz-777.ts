/**
 * audio-viz-777 — reactive visualizers for «Режим 777». Two modes:
 *
 *   'flow' — TouchDesigner-style WebGL2 feedback shader (kaleidoscopic domain-warp
 *            FBM + advected trails + bloom).
 *   'eye'  — FRACTAL PROJECTION: the strange attractor
 *              x' = sin(x² − y² + a),  y' = cos(2xy + b)
 *            (x²−y² and 2xy are Re/Im of z²) plotted as a glowing point cloud in a
 *            circular iris, with two drifting "gaze" hemispheres. Canvas-2D.
 *
 * Both are audio-reactive (bass / mid / high / level from an AnalyserNode).
 * startViz777() returns null only if the requested backend is unavailable, so the
 * caller can fall back to its own 2D visualizer.
 */

export type VizMode777 = 'flow' | 'eye';

export interface Viz777 {
  stop: () => void;
  setHue: (hue: number) => void;
}

// ————————————————————————— shared audio helper —————————————————————————

function makeBands(analyser: AnalyserNode) {
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const s = { bass: 0, mid: 0, high: 0, level: 0 };
  const band = (lo: number, hi: number) => {
    let sum = 0;
    const a = Math.max(0, lo);
    const b = Math.min(freq.length, hi);
    for (let i = a; i < b; i++) sum += freq[i];
    return b > a ? sum / (b - a) / 255 : 0;
  };
  return {
    sample() {
      analyser.getByteFrequencyData(freq);
      const bass = band(1, 8);
      const mid = band(8, 64);
      const high = band(64, 220);
      const level = band(1, 256);
      s.bass += (bass - s.bass) * (bass > s.bass ? 0.5 : 0.12);
      s.mid += (mid - s.mid) * 0.2;
      s.high += (high - s.high) * 0.35;
      s.level += (level - s.level) * 0.15;
      return s;
    },
  };
}

// ————————————————————————— 'flow' — WebGL2 feedback —————————————————————————

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SIM = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uTime, uBass, uMid, uHigh, uLevel, uHue;

vec3 pal(float t){
  return 0.5 + 0.5*cos(6.28318*(vec3(1.0)*t + vec3(0.0,0.33,0.67) + uHue));
}
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v += a*noise(p); p*=2.0; a*=0.5; } return v; }
mat2 rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }

void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec2 asp = vec2(uRes.x/uRes.y, 1.0);
  vec2 p = (uv-0.5)*asp;

  float zoom = 1.0 - 0.010 - uBass*0.030;
  float ang  = 0.004 + uMid*0.020;
  vec2 q = rot(ang)*(p*zoom);
  vec2 prevUv = q/asp + 0.5;
  vec3 prev = texture(uPrev, prevUv).rgb * (0.940 - uLevel*0.020);

  float r = length(p);
  float a2 = atan(p.y, p.x);
  float seg = 6.0;
  a2 = abs(mod(a2, 6.28318/seg) - 3.14159/seg);
  vec2 kp = vec2(cos(a2), sin(a2))*r;
  float warp = fbm(kp*2.0 - uTime*0.05);
  float n = fbm(kp*3.0 + vec2(uTime*0.15, -uTime*0.10) + warp*1.5);
  float tendril = smoothstep(0.55, 0.72, n + uMid*0.15);

  float ring = smoothstep(0.030, 0.0, abs(r - (0.12 + uBass*0.28)));
  float core = smoothstep(0.14 + uBass*0.12, 0.0, r);
  float spark = step(0.995 - uHigh*0.02, hash(floor(p*90.0)+floor(uTime*18.0))) * uHigh;

  vec3 col = vec3(0.0);
  col += pal(n*0.6 + r*0.5 + uTime*0.03) * tendril * (0.6 + uLevel);
  col += pal(0.15) * ring * (0.8 + uBass);
  col += vec3(1.0,0.9,1.0) * core * (0.5 + uBass*1.2);
  col += vec3(1.0) * spark * 1.5;

  vec3 outc = max(prev, col*0.9) + col*0.25;
  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

const PRESENT = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uRes;
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec3 c = texture(uTex, uv).rgb;
  vec3 b = vec3(0.0); float t = 0.0;
  for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++){
    vec2 off = vec2(float(i),float(j))/uRes*2.5;
    float w = 1.0/(1.0+float(i*i+j*j));
    b += texture(uTex, uv+off).rgb * w; t += w;
  }
  b /= t;
  vec3 col = c + max(b-0.35, 0.0)*0.9;
  col = col/(col+0.6);
  col = pow(col, vec3(0.85));
  float vig = smoothstep(1.25, 0.35, length(uv-0.5));
  o = vec4(col*vig, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[viz777] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn('[viz777] program link failed:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb };
}

function startFlowViz(canvas: HTMLCanvasElement, analyser: AnalyserNode, hue: number): Viz777 | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, depth: false });
  if (!gl) return null;

  const simProg = link(gl, SIM);
  const presentProg = link(gl, PRESENT);
  if (!simProg || !presentProg) return null;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const SIM_MAX = 720;
  let simW = 2;
  let simH = 2;
  let a = makeTarget(gl, simW, simH);
  let b = makeTarget(gl, simW, simH);

  function sizeTo() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = canvas.getBoundingClientRect();
    const cw = Math.max(2, Math.round(rect.width * dpr));
    const ch = Math.max(2, Math.round(rect.height * dpr));
    canvas.width = cw;
    canvas.height = ch;
    const scale = Math.min(1, SIM_MAX / Math.max(cw, ch));
    const nw = Math.max(2, Math.round(cw * scale));
    const nh = Math.max(2, Math.round(ch * scale));
    if (nw !== simW || nh !== simH) {
      simW = nw;
      simH = nh;
      gl!.deleteTexture(a.tex);
      gl!.deleteFramebuffer(a.fb);
      gl!.deleteTexture(b.tex);
      gl!.deleteFramebuffer(b.fb);
      a = makeTarget(gl!, simW, simH);
      b = makeTarget(gl!, simW, simH);
    }
  }
  sizeTo();
  window.addEventListener('resize', sizeTo);

  const uSim = {
    prev: gl.getUniformLocation(simProg, 'uPrev'),
    res: gl.getUniformLocation(simProg, 'uRes'),
    time: gl.getUniformLocation(simProg, 'uTime'),
    bass: gl.getUniformLocation(simProg, 'uBass'),
    mid: gl.getUniformLocation(simProg, 'uMid'),
    high: gl.getUniformLocation(simProg, 'uHigh'),
    level: gl.getUniformLocation(simProg, 'uLevel'),
    hue: gl.getUniformLocation(simProg, 'uHue'),
  };
  const uPres = {
    tex: gl.getUniformLocation(presentProg, 'uTex'),
    res: gl.getUniformLocation(presentProg, 'uRes'),
  };

  const bands = makeBands(analyser);
  let hueNorm = ((hue % 360) + 360) % 360 / 360;
  const t0 = performance.now();
  let raf = 0;
  let alive = true;

  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const s = bands.sample();
    const time = (performance.now() - t0) / 1000;

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, b.fb);
    gl!.viewport(0, 0, simW, simH);
    gl!.useProgram(simProg);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, a.tex);
    gl!.uniform1i(uSim.prev, 0);
    gl!.uniform2f(uSim.res, simW, simH);
    gl!.uniform1f(uSim.time, time);
    gl!.uniform1f(uSim.bass, s.bass);
    gl!.uniform1f(uSim.mid, s.mid);
    gl!.uniform1f(uSim.high, s.high);
    gl!.uniform1f(uSim.level, s.level);
    gl!.uniform1f(uSim.hue, hueNorm);
    gl!.bindVertexArray(vao);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.useProgram(presentProg);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, b.tex);
    gl!.uniform1i(uPres.tex, 0);
    gl!.uniform2f(uPres.res, canvas.width, canvas.height);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    const tmp = a;
    a = b;
    b = tmp;
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeTo);
      try {
        gl!.deleteTexture(a.tex);
        gl!.deleteFramebuffer(a.fb);
        gl!.deleteTexture(b.tex);
        gl!.deleteFramebuffer(b.fb);
        gl!.deleteProgram(simProg);
        gl!.deleteProgram(presentProg);
        gl!.deleteBuffer(buf);
        gl!.deleteVertexArray(vao);
      } catch {
        /* context may be lost */
      }
    },
    setHue(h: number) {
      hueNorm = ((h % 360) + 360) % 360 / 360;
    },
  };
}

// ————————————————————————— 'eye' — FRACTAL PROJECTION attractor —————————————————————————

function startEyeViz(canvas: HTMLCanvasElement, analyser: AnalyserNode, hue: number): Viz777 | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let W = 2;
  let H = 2;
  function sizeTo() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const r = canvas.getBoundingClientRect();
    W = canvas.width = Math.max(2, Math.round(r.width * dpr));
    H = canvas.height = Math.max(2, Math.round(r.height * dpr));
    ctx!.fillStyle = '#05040a';
    ctx!.fillRect(0, 0, W, H);
  }
  sizeTo();
  window.addEventListener('resize', sizeTo);

  const bands = makeBands(analyser);
  let a = 2.88;
  let b = 2.38;
  let hueDeg = ((hue % 360) + 360) % 360;
  const t0 = performance.now();
  let raf = 0;
  let alive = true;

  function glow(x: number, y: number, rad: number, r: number, g: number, bl: number, alpha: number) {
    const gr = ctx!.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${r},${g},${bl},${alpha})`);
    gr.addColorStop(0.5, `rgba(${r},${g},${bl},${alpha * 0.4})`);
    gr.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx!.fillStyle = gr;
    ctx!.beginPath();
    ctx!.arc(x, y, rad, 0, 6.2832);
    ctx!.fill();
  }

  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const s = bands.sample();
    const t = (performance.now() - t0) / 1000;

    // params drift (GAZE DRIFT) and morph with the music
    const aa = 2.6 + 0.55 * Math.sin(t * 0.13) + s.mid * 0.7;
    const bb = 2.2 + 0.55 * Math.cos(t * 0.11) + s.bass * 0.6;
    a += (aa - a) * 0.04;
    b += (bb - b) * 0.04;

    // trail fade
    ctx!.globalCompositeOperation = 'source-over';
    ctx!.fillStyle = 'rgba(5,4,10,0.16)';
    ctx!.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.46;

    // attractor point cloud: iterate x'=sin(x²−y²+a), y'=cos(2xy+b) from many seeds
    ctx!.globalCompositeOperation = 'lighter';
    const seeds = 12;
    const total = 1800 + Math.floor(s.level * 3200);
    const per = Math.max(1, Math.floor(total / seeds));
    const sz = Math.max(1, W * 0.0016);
    for (let sd = 0; sd < seeds; sd++) {
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      for (let k = 0; k < 10; k++) {
        const nx = Math.sin(x * x - y * y + a);
        y = Math.cos(2 * x * y + b);
        x = nx;
      }
      for (let i = 0; i < per; i++) {
        const nx = Math.sin(x * x - y * y + a);
        const ny = Math.cos(2 * x * y + b);
        x = nx;
        y = ny;
        const px = cx + x * R;
        const py = cy + y * R;
        const hz = (hueDeg + x * 70 + y * 70 + 720) % 360;
        ctx!.fillStyle = `hsla(${hz},92%,${52 + s.high * 30}%,${0.05 + s.high * 0.12})`;
        ctx!.fillRect(px, py, sz, sz);
      }
    }

    // two drifting "gaze" hemispheres, dilating with bass
    const gx1 = cx - R * 0.05 + Math.sin(t * 0.31) * R * 0.12;
    const gy1 = cy - R * 0.02 + Math.cos(t * 0.24) * R * 0.1;
    glow(gx1, gy1, R * (0.14 + s.bass * 0.08), 210, 225, 255, 0.9); // HEMI·L (cool)
    const gx2 = cx + R * 0.03 + Math.sin(t * 0.31 + 2.2) * R * 0.1;
    const gy2 = cy + R * 0.1 + Math.cos(t * 0.24 + 1.1) * R * 0.1;
    glow(gx2, gy2, R * (0.1 + s.bass * 0.07), 255, 150, 60, 0.9); // HEMI·R (warm)

    // iris boundary
    ctx!.globalCompositeOperation = 'source-over';
    ctx!.strokeStyle = 'rgba(178,170,220,0.55)';
    ctx!.lineWidth = Math.max(1, W * 0.0011);
    ctx!.beginPath();
    ctx!.arc(cx, cy, R, 0, 6.2832);
    ctx!.stroke();

    // HUD readout (matches the artifact)
    const fs = Math.max(9, W * 0.011);
    ctx!.font = `${fs}px ui-monospace, SFMono-Regular, monospace`;
    ctx!.textAlign = 'right';
    ctx!.fillStyle = 'rgba(205,210,235,0.7)';
    ctx!.fillText('EYE', W - fs * 0.8, fs * 1.7);
    ctx!.fillStyle = 'rgba(150,155,185,0.5)';
    ctx!.fillText('FRACTAL PROJECTION', W - fs * 0.8, fs * 3.0);
    ctx!.fillText('HEMI·L   HEMI·R', W - fs * 0.8, H - fs * 0.9);
    ctx!.textAlign = 'left';
    ctx!.fillStyle = 'rgba(150,155,190,0.55)';
    ctx!.fillText('x+ = sin(x² − y² + a)', fs * 0.8, fs * 1.9);
    ctx!.fillText('y+ = cos(2xy + b)', fs * 0.8, fs * 3.2);
    ctx!.fillStyle = 'rgba(160,165,195,0.6)';
    ctx!.fillText(`A ${a.toFixed(2)}   B ${b.toFixed(2)}`, fs * 0.8, H - fs * 2.2);
    ctx!.fillText('GAZE DRIFT', fs * 0.8, H - fs * 0.9);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeTo);
    },
    setHue(h: number) {
      hueDeg = ((h % 360) + 360) % 360;
    },
  };
}

// ————————————————————————— dispatcher —————————————————————————

export function startViz777(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
  hue = 265,
  mode: VizMode777 = 'flow',
): Viz777 | null {
  return mode === 'eye' ? startEyeViz(canvas, analyser, hue) : startFlowViz(canvas, analyser, hue);
}
