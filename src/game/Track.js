// 赛道全局常量 —— 所有系统（环境/AI/比赛/道具）共用
// 坐标系：+Z 北，yaw=0 朝 +Z；前进方向 (sin yaw, 0, cos yaw)

// 检查点环形赛道（索引 0 = 起点/终点线），一圈约 1.9km
export const TRACK = [
  { x: 0, z: 0 },       // 0 起点/终点
  { x: 0, z: 230 },     // 1
  { x: 150, z: 480 },   // 2
  { x: 340, z: 560 },   // 3
  { x: 490, z: 400 },   // 4
  { x: 440, z: 190 },   // 5
  { x: 250, z: 50 },    // 6
  { x: 0, z: -140 },    // 7（穿过中浪区）
  { x: -210, z: -40 },  // 8
];

// 木质跳台（CP4 → CP5 之间），w=横向宽 d=纵深
export const RAMP = { x: 462, z: 295, yaw: 3.38, w: 10, d: 13 };

// 道具点 kind: 0=BOOST(氮气) 1=SHIELD(护盾) 2=TURBO(极速)
export const PICKUP_SPOTS = [
  { x: 0, z: 120, kind: 0 },
  { x: 70, z: 355, kind: 1 },
  { x: 250, z: 520, kind: 2 },
  { x: 470, z: 290, kind: 0 },
  { x: 350, z: 120, kind: 1 },
  { x: 110, z: -40, kind: 2 },
  { x: -110, z: -90, kind: 0 },
  { x: -100, z: -20, kind: 1 },
];

// 碰撞障碍（圆形碰撞体），环境模块负责可视化
export const OBSTACLES = [
  { x: 320, z: 680, r: 55, kind: 'island' },   // 大岛 + 灯塔
  { x: 540, z: 300, r: 22, kind: 'island' },   // 小岛
  { x: -280, z: 80, r: 16, kind: 'rocks' },    // 礁石群
  { x: -240, z: 130, r: 10, kind: 'rocks' },
];
