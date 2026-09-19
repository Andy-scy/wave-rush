// 天空 —— 渐变穹顶 + 程序云层 + 太阳 + 海平线雾霭（明亮夏日感）
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}
`;

const SKY_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.15 + vec2(13.7); a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -0.05, 1.0);

  // 天空渐变
  float g = pow(max(h, 0.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, g);

  // 太阳
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 900.0) * 3.0;                    // 日盘
  col += uSunColor * pow(sd, 28.0) * 0.5;                     // 内晕
  col += uSunColor * pow(sd, 5.0) * 0.16;                     // 大范围散射

  // 云层（仅地平线以上，随时间漂移）
  if (dir.y > 0.015) {
    vec2 cuv = dir.xz / (dir.y + 0.16) * 0.75;
    float cl = fbm(cuv * 0.55 + vec2(uTime * 0.008, uTime * 0.003));
    cl = smoothstep(0.44, 0.78, cl);
    float shade = fbm(cuv * 0.55 + vec2(uTime * 0.008, uTime * 0.003) + vec2(0.35));
    vec3 cloudCol = mix(vec3(1.0, 0.99, 0.97), vec3(0.62, 0.72, 0.86), clamp(shade * 1.2 - 0.35, 0.0, 1.0));
    // 靠近太阳的云被照亮
    cloudCol += uSunColor * pow(sd, 6.0) * 0.35;
    float fade = smoothstep(0.015, 0.12, dir.y) * 0.92;
    col = mix(col, cloudCol, cl * fade);
  }

  // 海平线雾霭
  col = mix(col, uHorizon * 0.96, smoothstep(0.16, 0.0, abs(dir.y)) * 0.85);
  if (dir.y < 0.0) col = uHorizon * 0.96;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const SUN_DIR = new THREE.Vector3(0.42, 0.5, 0.35).normalize();

export class Sky {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
        uZenith: { value: new THREE.Color('#1e7ad6') },
        uHorizon: { value: new THREE.Color('#9fd4f8') },
        uSunColor: { value: new THREE.Color('#fff2cc') },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 18), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  update(dt, camPos) {
    this.mat.uniforms.uTime.value += dt;
    this.mesh.position.copy(camPos);
  }
}
