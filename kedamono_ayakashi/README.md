# KEDAMONO_AYAKASHI — 歌词视频

用 [素材文件夹](https://drive.google.com/drive/folders/1wg32shsOtUiH9RU9jeGxA1E3-MybtF-K)（音频 / 封面 / 双语 LRC）
逐帧渲染的动态歌词视频（kinetic typography）。

- 画面：3840×2160（4K）原生渲染，60 fps，H.264（High@5.2，yuv420p，BT.709）；`SCALE=1` 可出 1080p
- 音频：**原样拷贝**素材里的 WAV 音轨（PCM 32-bit 整数 / 96 kHz / 立体声），不做任何重编码
- 封装：`.mov`（QuickTime 原生支持 32-bit 整数 PCM，剪辑软件 / 播放器兼容性好）
- 开头 0–5 秒标注「歌词与翻译为个人听译，可能有误，欢迎捉虫～」

## 用法

依赖：Node ≥ 18、Python 3（`librosa soundfile fonttools`）、ffmpeg（带 libx264）。

```bash
npm install
pip install librosa soundfile fonttools
npm run fetch     # 下载素材（Google Drive）和字体（google/fonts，SIL OFL）
npm run render    # 分析音频 -> 多进程渲染 -> 合并 -> 封装原始音轨
# 输出：output/KEDAMONO_AYAKASHI_lyric_video_4K60.mov
```

预览某几个时间点的画面：

```bash
npm run analyze                       # 只需一次
node src/render.mjs --stills 4.5,45.6,110.6 --outdir build/stills
```

可调参数（环境变量）：`SCALE`（2 = 4K，1 = 1080p，默认 2）、`JOBS`（并行进程数，默认 3）、`CRF`（默认 17）、`PRESET`（默认 medium）、`FPS`（默认 60）。

画面逻辑坐标始终是 1920×1080，`SCALE` 只改变画布的物理分辨率，所以 4K 是原生绘制（文字、线条、阴影都按比例放大），不是放大 1080p。

### 封面（同时兼容 16:9 与 4:3）

```bash
npm run cover     # -> output/cover_16x9.jpg / cover_16x9.png（1920×1080）、output/cover_4x3.jpg（1440×1080）
```

所有关键内容（专辑图、标题、标签）都放在画面中央 1440×1080 的 4:3 安全区内，并避开底部会被平台
叠加时长 / 播放量的区域；两侧 240 px 只有背景，所以 16:9 原图和居中裁成 4:3 都完整。

## 结构

| 文件 | 作用 |
| --- | --- |
| `src/analyze_audio.py` | 离线音频分析：响度、频段能量、鼓点（kick/snare）、48 段频谱，逐帧写入 `build/analysis.json` |
| `src/audio.mjs` | 按时间查询分析结果；141 BPM 节拍网格（对 onset 包络做网格搜索测得）；读取原始 PCM 画示波器 |
| `src/lyrics.mjs` | LRC 解析（同时间戳的第二行视为中文翻译）+ 每一句的动效编排表 |
| `src/scene.mjs` | 画面本体：分段背景、各句专属动效、逐字入场/退场、镜头抖动、闪白/反色、故障切片、RGB 分离、胶片颗粒、HUD |
| `src/lib.mjs` | 缓动、确定性随机、字体注册、封面变体（红光 / 负片 / 纸面）、逐字排版 |
| `src/render.mjs` | 渲染静帧或指定帧区间，直接把 RGBA 帧喂给 ffmpeg |
| `src/cover.mjs` | 视频封面（16:9 + 4:3 安全区） |
| `scripts/render_video.sh` | 完整流水线（并行分段渲染 → concat → `-c:a copy` 封装原音轨） |

每一帧只取决于时间 `t`（所有随机都由时间/序号做种子），所以可以任意顺序、多进程并行渲染。

## 动效一览（按段落）

- **Intro**：封面卡片冲击入场 + 故障切片，卡片穿镜头飞出进入主歌；底部 5 秒免责声明（打字机 + 乱码解码）
- **Verse 1**（明朝体）：逐字上浮、乱码解码、无尽走廊（受付窗口永远到不了）、镜面倒影 + 背景水平翻转、
  「僕」重击 + 反色、身份不稳的抖动与 RGB 分离、并列句上下对照、红色「一線」划过画面
- **Break**：英文打字机 + 光标、回声残影；「Oh, I hate me」重击时红线从中间断裂坠落
- **Pre-chorus**：歌词沿「非常階段」逐级下落、「響き渡る」回声波纹、旋转警示灯；「ノーサイド」从两侧（第二次为上下）冲撞合拢
- **Chorus**（Dela Gothic）：按鼓点切镜、节拍缩放、放射速度线、火星粒子、频谱；
  「ケダモノ」爪痕、「ディスコード」像素字体故障、「対象外」印章盖章、「脳細胞」神经元连线
- **Interlude**：漂浮的封面卡片（按小节翻面，背面为负片）、光束、跑马灯标题、16 步节拍灯
- **Verse 2**（纸面负片风格）：任务界面框 +「勝利条件」被涂黑、漂浮问号、行进脚印、巨大的「」括号
- **Break 2**：满屏滚动的「I HATE ME」，第二遍加速并随拍红闪
- **Bridge**：满屏雪花噪点 + 系统对话框：光标卡点按下 [CANCEL] 却报错「NOISE CANNOT BE CANCELLED」；
  越来越多的「ルール」线条缠住歌词；心电图在「死んだ」处归零
- **Outro**：「NO SIDE」过门，神经网络逐渐生长，「脳細胞」落在节点上并以信号脉冲相连
- **End**：封面卡片 + 标题，最后一拍故障闪断、淡出

## 说明

- 素材（音频 / 封面 / LRC）与字体不入库，由 `scripts/` 下的脚本下载。
- 字体均为 SIL Open Font License：Shippori Mincho B1、Dela Gothic One、Zen Kaku Gothic New、DotGothic16、
  Noto Sans SC / Noto Serif SC、Antonio、Bebas Neue、Share Tech Mono。
