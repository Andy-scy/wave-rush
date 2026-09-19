// 海洋 —— 自定义 Shader：几何波浪位移 + 菲涅尔天空反射 + 太阳高光/碎金闪烁 + 浪尖泡沫 + 雾
// 顶点着色器内的波形公式与 src/game/WaveMath.js 逐常量一致（摩托艇物理依赖 JS 版本）
import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;

// ═══════ 波形常量表（必须与 WaveMath.js 顶部注释表逐常量一致，两处同步修改）═══════
//  域扭曲:   w.x = x + sin(x*0.036 + z*0.027 + t*0.15) * 7.0
//            w.y = z + sin(x*0.029 - z*0.032 - t*0.11) * 7.0
//  基础波 7 分量 (kx, kz, omega, amp)，含 2 个近反向传播浪系：
//            ( 0.052,  0.031,  0.90, 0.58)
//            ( 0.116, -0.087,  1.30, 0.21)
//            ( 0.148,  0.132,  1.72, 0.11)
//            ( 0.320, -0.270,  2.30, 0.055)
//            (-0.045, -0.031,  0.70, 0.34)   ← 近反向于第 1 分量
//            (-0.077,  0.070, -1.05, 0.17)   ← 近反向于第 2 分量
//            ( 0.036,  0.059,  0.51, 0.26)
//  涌浪团块:  1 + 0.35 * sin(x*0.011 + z*0.017 + t*0.045) * sin(x*0.019 - z*0.023 - t*0.031)
//  群波包络:  0.55 + 0.45 * sin(-(x*0.859 + z*0.512) * 0.055 - t*0.42)   （波长 ~114m，与主波系同向推进）
//  陡峭短波:  sin(w.x*0.14 + w.y*0.11 + t*1.6) * 1.7 * f
//             sin(w.x*0.23 - w.y*0.19 + t*2.4) * 0.55 * f    （f = zoneGauss，起飞核心）
//  全局涟漪:  sin(w.x*0.71 + w.y*0.64 + t*2.90) * 0.035
// ═════════════════════════════════════════════════════════════════════════════════

float baseWave(vec2 p, float t) {
  float h = 0.0;
  h += sin( p.x*0.052 + p.y*0.031 + t*0.90) * 0.58;
  h += sin( p.x*0.116 - p.y*0.087 + t*1.30) * 0.21;
  h += sin( p.x*0.148 + p.y*0.132 + t*1.72) * 0.11;
  h += sin( p.x*0.32  - p.y*0.27  + t*2.30) * 0.055;
  h += sin(-p.x*0.045 - p.y*0.031 + t*0.70) * 0.34;
  h += sin(-p.x*0.077 + p.y*0.070 - t*1.05) * 0.17;
  h += sin( p.x*0.036 + p.y*0.059 + t*0.51) * 0.26;
  return h;
}
// 涌浪团块：双 sin 积调制局部振幅（±35%），与 JS swellMod 一致
float swellMod(vec2 p, float t) {
  return 1.0 + 0.35 * sin(p.x*0.011 + p.y*0.017 + t*0.045) * sin(p.x*0.019 - p.y*0.023 - t*0.031);
}
// 群波包络（wave sets）：与主波系 (0.052,0.031) 同向传播的慢波（波长 ~114m）
// 取值 0.10~1.00 → 涌浪一阵高一阵平、成组推进；与 JS waveSetEnv 同一实现
float waveSetEnv(vec2 p, float t) {
  return 0.55 + 0.45 * sin(-(p.x*0.859 + p.y*0.512) * 0.055 - t*0.42);
}
float ampAt(vec2 p) {
  float a = 1.0;
  a += 2.5 * exp(-dot(p - vec2(90.0, 400.0), p - vec2(90.0, 400.0)) / (150.0*150.0));
  a += 1.55 * exp(-dot(p - vec2(20.0, -150.0), p - vec2(20.0, -150.0)) / (100.0*100.0));
  return a;
}
float zoneGauss(vec2 p) {
  float f = exp(-dot(p - vec2(90.0, 400.0), p - vec2(90.0, 400.0)) / (150.0*150.0));
  f += exp(-dot(p - vec2(20.0, -150.0), p - vec2(20.0, -150.0)) / (100.0*100.0)) * 0.55;
  return min(f, 1.0);
}
float fullWave(vec2 p, float t) {
  // 域扭曲（打破波系规律对齐）；浪区定位仍用原始坐标 p
  vec2 w = vec2(
    p.x + sin(p.x*0.036 + p.y*0.027 + t*0.15) * 7.0,
    p.y + sin(p.x*0.029 - p.y*0.032 - t*0.11) * 7.0
  );
  float f = zoneGauss(p);
  float h = baseWave(w, t) * ampAt(p) * swellMod(p, t) * waveSetEnv(p, t);
  h += sin(w.x*0.14 + w.y*0.11 + t*1.6) * 1.7 * f;
  h += sin(w.x*0.23 - w.y*0.19 + t*2.4) * 0.55 * f;
  h += sin(w.x*0.71 + w.y*0.64 + t*2.90) * 0.035;
  return h;
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float t = uTime;
  float h = fullWave(wp.xz, t);
  wp.y += h;
  vHeight = h;

  // 有限差分法线
  float e = 1.6;
  float hx1 = fullWave(wp.xz + vec2(e,0.0), t);
  float hx2 = fullWave(wp.xz - vec2(e,0.0), t);
  float hz1 = fullWave(wp.xz + vec2(0.0,e), t);
  float hz2 = fullWave(wp.xz - vec2(0.0,e), t);
  vNormal = normalize(vec3(hx2 - hx1, 2.0*e, hz2 - hz1));

  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uDetail;      // 细节法线强度（画质分级）
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

// ── 反网格纹根：所有 noise() 采样坐标必经的两道预处理 ──
// 1) 局部域扭曲：波长 ~26/33/41/52m 的 sin/cos 弯曲场，位移最大 ±5.2m（2~6m 档），
//    让 value-noise 点阵的格子位置随空间连续漂移，轴对齐的"成行成列"白点被打散
vec2 warpSp(vec2 p, float t) {
  return p + vec2(
    sin(p.y*0.243 + t*0.35) + sin(p.x*0.117 - t*0.21),
    cos(p.x*0.201 - t*0.28) + cos(p.y*0.153 + t*0.17)
  ) * 2.6;
}
// 2) 各八度独立旋转角（非轴对齐采样，cos/sin 对）：
//    八度1 -17.5° (0.9537,-0.3007) | 八度2 37.0° (0.7986,0.6018) | 八度3 61.3° (0.4800,0.8773)
//    碎金 -47.2° (0.6795,-0.7337) | 泡沫粗层 26.8° (0.8924,0.4513) | 大尺度 8.9° (0.9880,0.1547)
//    三个主八度方向互不相同、频率互不相同 → 点阵方向互不一致，无公共行列
vec2 rot2(vec2 p, float c, float s) { return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

void main() {
  vec3 N = normalize(vNormal);
  float t = uTime;
  vec2 sp = vWorld.xz;

  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // 全部 noise 采样共用的扭曲坐标（各八度再各自旋转/变频/漂移）
  vec2 q = warpSp(sp, t);

  // ── 细节法线：三尺度三八度（细 2.3 / 更细 5.2 / 中 0.55），各八度不同方向不同频率 ──
  // noise 总调用 6 次/像素：n1 n2 n3 nBig glit f1（n2 兼作泡沫细尺度）
  float n1 = noise(rot2(q, 0.9537, -0.3007) * 2.3 + vec2(t*1.4, t*0.9));
  float n2 = noise(rot2(q, 0.7986, 0.6018) * 5.2 + vec2(-t*0.8, t*1.3));
  float n3 = noise(rot2(q, 0.4800, 0.8773) * 0.55 + vec2(t*0.28, -t*0.17));
  // 大尺度低频场（~300m）：远处高光/碎金成片不均匀，不成 tiled 图案
  float nBig = noise(rot2(q, 0.9880, 0.1547) * 0.021 + vec2(t*0.016, -t*0.011));
  // 距离衰减：远处收敛细碎噪声，避免均匀闪点；大尺度扰动保留
  float dFade = 1.0 / (1.0 + dist*0.004);
  vec2 dn = (vec2(n1-0.5, n3-0.5) + (n2-0.5)*vec2(0.62, -0.48)) * 0.7 * dFade;
  N = normalize(N + vec3(dn.x, 0.0, dn.y) * uDetail
                  + vec3(nBig-0.5, 0.0, 0.5-nBig) * 0.12);

  float ndv = max(dot(N, V), 0.0);

  // 菲涅尔：天空反射 + 水体颜色
  float fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 3.5);
  vec3 R = reflect(-V, N);
  float skyF = clamp(R.y * 1.4, 0.0, 1.0);
  vec3 skyRef = mix(uHorizonColor, uSkyColor, pow(skyF, 0.8));

  // ── 大尺度水体性格（~450-610m 双 sin 积场）：深浅斑驳 ±8%，不同海域"性格"不同 ──
  float seaPatch = sin(sp.x*0.0141 + sp.y*0.0103 + t*0.012) * sin(sp.x*0.0107 - sp.y*0.0139 - t*0.009);

  // 水体渐变：波峰更透亮；seaPatch 让深浅色斑驳（±8% 混色偏移）
  float crest = clamp(vHeight * 0.42 + 0.5, 0.0, 1.0);
  vec3 water = mix(uDeepColor, uShallowColor, clamp(crest * 0.85 + seaPatch * 0.08, 0.0, 1.0));

  vec3 col = mix(water, skyRef, fresnel);

  // 太阳高光 + 碎金闪烁（nBig 调制成片：这片亮、那片暗）
  float spec = pow(max(dot(R, uSunDir), 0.0), 260.0);
  float glit = noise(rot2(q, 0.6795, -0.7337) * 3.1 + vec2(t*2.0, -t*1.5));
  spec *= (0.7 + 0.6 * glit) * (0.30 + 1.4 * nBig);
  col += vec3(1.0, 0.93, 0.72) * spec * 2.6;
  // 太阳路径的宽幅亮带
  float sunPath = pow(max(dot(normalize(vec3(R.x, 0.0, R.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 24.0);
  col += vec3(1.0, 0.85, 0.55) * sunPath * 0.10 * clamp(R.y*3.0, 0.0, 1.0);

  // 浪尖泡沫：高度 + 双尺度破碎噪声（粗 1.9 + 细 5.2），nBig 让破碎成片更有机
  float ampLocal = clamp(1.0 + (vHeight * 0.28), 0.35, 2.6);
  float foamH = smoothstep(0.78, 1.08, vHeight / (ampLocal * 0.72));
  // 泡沫粗层：独立旋转角 + 独立漂移相，与细层 n2（漂移 -t*0.8,t*1.3）错相
  float f1 = noise(rot2(q, 0.8924, 0.4513) * 1.9 + vec2(t*0.5, t*0.35));
  // 破碎时机位置偏移（~170-330m 慢变化场）：不同海域浪头不同时破碎
  float foamOff = sin(sp.x*0.031 + sp.y*0.023 - t*0.13) * 0.6 + sin(sp.x*0.019 - sp.y*0.037 + t*0.09) * 0.4;
  float foamN = f1*0.55 + n2*0.45;
  float foamThr = 0.45 - (nBig - 0.5)*0.22 + foamOff*0.07 - seaPatch*0.05;
  float foam = foamH * smoothstep(foamThr, foamThr + 0.40, foamN);
  // 破碎边缘第二层：不同混合比 + 更窄窗口 + 与主边缘错相 → 边缘撕裂、蠕动、不成直线
  float edgeB = smoothstep(foamThr + 0.10, foamThr + 0.30, f1*0.30 + n2*0.70);
  foam = max(foam, foamH * edgeB * 0.85);
  // 波背斜坡白沫
  float slopeFoam = smoothstep(0.80, 0.58, N.y) * 0.3;
  foam = clamp(foam + slopeFoam * foamN * 0.5, 0.0, 1.0);
  col = mix(col, vec3(0.96, 0.99, 1.0), foam * 0.8);

  // 雾
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Ocean {
  constructor(scene, quality) {
    this.time = 0;
    const seg = quality.waterSegments;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.42, 0.5, 0.35).normalize() },
        uDeepColor: { value: new THREE.Color('#04306c') },
        uShallowColor: { value: new THREE.Color('#0c8fcb') },
        uSkyColor: { value: new THREE.Color('#2f8fe0') },
        uHorizonColor: { value: new THREE.Color('#9fd4f8') },
        uFogColor: { value: new THREE.Color('#a8dcff') },
        uFogNear: { value: quality.fogNear },
        uFogFar: { value: quality.fogFar },
        uDetail: { value: 0.5 },
      },
    });

    // 近景水面（跟随相机）
    const size = quality.waterSize;
    this.near = new THREE.Mesh(new THREE.PlaneGeometry(size, size, seg, seg), this.mat);
    this.near.rotation.x = -Math.PI / 2;
    this.near.frustumCulled = false;
    this.near.renderOrder = 1;
    scene.add(this.near);

    // 远景平面（雾色融合到海平线；y 低于最深波谷避免穿出水面）
    const farGeo = new THREE.CircleGeometry(quality.fogFar * 4.5, 40);
    this.far = new THREE.Mesh(farGeo, new THREE.MeshBasicMaterial({ color: '#a8dcff', fog: false }));
    this.far.rotation.x = -Math.PI / 2;
    this.far.position.y = -3.6;
    scene.add(this.far);
  }

  setQuality(q) {
    this.mat.uniforms.uFogNear.value = q.fogNear;
    this.mat.uniforms.uFogFar.value = q.fogFar;
    this.far.geometry.dispose();
    this.far.geometry = new THREE.CircleGeometry(q.fogFar * 4.5, 40);
    this.mat.uniforms.uDetail.value = q.detailNormals;
  }

  update(dt, camPos) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    // 网格吸附跟随机位，避免顶点游动
    const seg = this.near.geometry.parameters.widthSegments;
    const step = this.near.geometry.parameters.width / seg;
    this.near.position.x = Math.round(camPos.x / step) * step;
    this.near.position.z = Math.round(camPos.z / step) * step;
  }
}
