// 画质分级 —— LOW/MEDIUM/HIGH/ULTRA + AUTO 自适应
export const QUALITY_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

export const QUALITY_PRESETS = {
  LOW: {
    pixelRatio: 0.75, antialias: false,
    waterSize: 1650, waterSegments: 110, fogNear: 130, fogFar: 780, detailNormals: 0.18,
    particles: 0.45, shadows: false, shadowRes: 512, bloom: false,
    aiCount: 5, viewDistance: 1000, gulls: 0,
  },
  MEDIUM: {
    pixelRatio: 1.0, antialias: true,
    waterSize: 2000, waterSegments: 160, fogNear: 165, fogFar: 1000, detailNormals: 0.28,
    particles: 0.8, shadows: false, shadowRes: 1024, bloom: false,
    aiCount: 6, viewDistance: 1200, gulls: 4,
  },
  HIGH: {
    pixelRatio: 1.0, antialias: true,
    waterSize: 2300, waterSegments: 220, fogNear: 195, fogFar: 1150, detailNormals: 0.32,
    particles: 1.0, shadows: true, shadowRes: 1024, bloom: true,
    aiCount: 7, viewDistance: 1350, gulls: 7,
  },
  ULTRA: {
    pixelRatio: 1.25, antialias: true,
    waterSize: 2600, waterSegments: 256, fogNear: 220, fogFar: 1300, detailNormals: 0.45,
    particles: 1.4, shadows: true, shadowRes: 2048, bloom: true,
    aiCount: 7, viewDistance: 1500, gulls: 9,
  },
};

export function isMobileDevice() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

// AUTO 档的起始层级（运行时 Game 会根据 FPS 自动升降）
export function autoStartTier() {
  return isMobileDevice() ? 'MEDIUM' : 'HIGH';
}
