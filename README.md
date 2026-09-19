# WAVE RUSH 🌊 — 3D 摩托艇海上竞速对战

纯 Web 的 Stylized 3D 街机摩托艇竞速游戏：动态海洋着色器、巨浪起飞、空中特技、氮气加速、
AI 对手（三档难度）、检查点竞速、程序合成音乐音效、移动端触控、局域网联机。
**零构建、零 npm 依赖、纯浏览器运行。**

![tech](https://img.shields.io/badge/three.js-r180-blue) ![deps](https://img.shields.io/badge/npm%20依赖-0-brightgreen) ![license](https://img.shields.io/badge/license-MIT-green)

## 🚀 启动

方式一（推荐，Windows）：

```
双击 启动游戏.bat
```

方式二（任意系统，需要 Node.js ≥ 18）：

```
node server.mjs
# 打开 http://localhost:8080
```

> Windows 用户可选：从 [nodejs.org](https://nodejs.org/dist/) 下载 `node-v22.x-win-x64.zip`，
> 解压到 `tools/node-v22.14.0-win-x64/` 即可实现免安装运行（启动脚本会自动优先使用它）。
> 手机联机：同一 WiFi 下打开 `http://<电脑IP>:8080`。

## 🎮 操作

| 按键 | 功能 |
|---|---|
| W / ↑ | 加速 |
| S / ↓ | 刹车 / 空中后空翻 |
| A D / ← → | 转向 / 空中侧滚 |
| Space | 跳跃（冲上浪尖可自然起飞） |
| Shift | 氮气加速 |
| C | 切换镜头 |
| Esc | 暂停 |

手机：左右下角虚拟按键，自动检测触摸设备。

## 🏁 玩法

- 开放海域 + 9 检查点环形赛道（约 1.9 km/圈），圈数 1/2/3 可选
- 7 名 AI 车手，**开赛前可选难度**（低 / 中 / 高，实测圈速差 ~14% / ~9%）
- 巨浪区自然起飞 → 空中特技（前/后空翻、侧滚）→ COMBO 连击加分
- 氮气：特技/道具/随时间恢复；BOOST / SHIELD / TURBO 三种道具环
- 小地图 + 水面箭头光带 + 头顶指向箭头 + 巨型门牌 + 罗盘，四重赛道指引
- 画质 AUTO/LOW/MEDIUM/HIGH/ULTRA，AUTO 依 FPS 自动升降档
- 最佳成绩与设置保存在 localStorage

## 🌐 局域网联机

1. 主机点 `本地联机 → 创建房间`，得到 5 位房间码
2. 同一局域网设备浏览器打开 `http://<主机IP>:8080`，输入房间码加入
3. 房主点 `开始比赛`，全员同步开赛；服务器负责权威排名与完赛判定
4. 服务器未启动时联机入口自动禁用，单机模式完全不受影响

## 🗂 结构

```
wave-rush/
├── server.mjs               # 零依赖 Node 服务器（静态文件 + 手写 RFC6455 WebSocket 房间）
├── index.html               # 入口 + importmap
├── 启动游戏.bat              # 一键启动（有便携 Node 用便携版，否则回退系统 Node）
├── vendor/three/            # three.js r180 本地化（离线可用）
└── src/
    ├── main.js              # 入口
    ├── game/                # Ocean / Sky / JetSki / Player / AIPlayer / RaceManager /
    │                        # TrackGuide / MiniMap 相关 / Effects / AudioManager / …
    ├── multiplayer/         # NetClient / RemotePlayer（120ms 插值）
    ├── ui/                  # HUD / 菜单 / 设置 / 结算 / 触控 / 小地图
    └── data/store.js        # localStorage 存档
```

## ⚙️ 技术要点

- 海面：自定义 Shader（域扭曲 + 7 向浪系 + 群波包络 + 涌浪团块；片元菲涅尔/太阳碎金/浪尖泡沫），
  JS 与 GLSL 共享同一套波形公式（逐常量一致），摩托艇严格贴合浪面
- 巨浪起飞：检测脚下海面抬升速率，超阈值自动离水；特技为纯模型旋转 + 落地判定
- 摩托艇：11 段截面放样程序化建模，顶点色合并，每艘 ≈ 6 个 draw call
- 特效全对象池（水花 900 + 泡沫 700 粒子 + 水环）
- 音频 100% Web Audio 程序合成（引擎随速变调 + lookahead 音序器音乐），无任何外部素材
- 联机：手写 WebSocket 服务器（无 ws 依赖），15Hz 状态同步 + 120ms 插值缓冲，服务端权威排名

## License

MIT — 游戏代码可自由使用。`vendor/three/` 内的 three.js 遵循其自身的 [MIT 许可证](https://github.com/mrdoob/three.js/blob/dev/LICENSE)。
