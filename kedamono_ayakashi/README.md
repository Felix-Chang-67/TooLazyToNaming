# KEDAMONO_AYAKASHI — 歌词视频（影絵劇場）

用 [素材文件夹](https://drive.google.com/drive/folders/1wg32shsOtUiH9RU9jeGxA1E3-MybtF-K)（官方 Hi-Res 音频 / 封面 / 官方歌词 + 中文翻译 LRC）
逐帧渲染的动态歌词视频。

- 画面：3840×2160（4K）原生渲染，60 fps，H.264（High@5.2，yuv420p，BT.709）；`SCALE=1` 可出 1080p
- 音频：**原样拷贝**官方母带 WAV 音轨（PCM 24-bit / 48 kHz / 立体声），不做任何重编码（`scripts/verify_output.sh` 逐样本校验）
- 封装：`.mov`（QuickTime 原生支持 PCM，剪辑软件 / 播放器兼容性好）
- 开头 0–5 秒标注「中文翻译为个人翻译，可能有误，欢迎捉虫～」（日文为官方歌词）
- 中文翻译按 LRC 原文显示，另有一处修订：「OS不兼容」→「操作系统不兼容」（`src/lyrics.mjs` 的 `CN_FIXES`）

## 设计：影絵劇場（影子戏剧场）

整支视频发生在同一个舞台上：一盏裸灯泡、一张纸幕、一只手影「兽」（从封面里抠出来的那只手影狗）。
歌词、小道具、兽都是灯泡和纸幕之间的「木偶」，观众看到的是它们投在纸上的影子：

- 木偶离纸越远（深度 z 越大），影子越大、越虚、越淡——歌词「对焦」就是木偶贴近纸面的过程
- 红色玻璃纸 → 正片叠底的红光（红字、红色的兽）；纸被撕破 → 光从裂口漏出；
  冷色投影仪 → 「失序」时刻闯入的数字光（ディスオーダー、OS非対応、噪音）；印章 / 规则本 → 印在纸上的墨
- 中文翻译固定在纸幕下方，电影字幕式；左上角只保留「ヒトリエ | KEDAMONO_AYAKASHI」小字

### 分镜（按段落）

- **Intro**：灯泡闪两下亮起，兽的影子对焦成封面构图，「ヒトリエ」黑色剪影 +「KEDAMONO_AYAKASHI」红色玻璃纸
- **Verse 1**：「傷」时爪痕撕破纸幕、透出光；处方签不停飘落；镜子里刷牙的兽，倒影慢半拍，「僕」时只剩下红色的倒影；
  「誰だったら良かった？」单字失焦抖动；歌词坠落在白色「停止線」上弹跳
- **Break**：打字机敲出「I beg your pardon?」；「Oh, I hate me.」灯泡炸裂，红色字在黑暗里发光
- **Pre-chorus**：红色警示灯旋转、楼梯扶手的影子滑过，「響き渡る」回声；「ノーサイド、/脳細胞に」两张镂空卡片荡进来相撞
- **Chorus**：乐队进入（0:44.8）时整面纸变红，巨大的兽随底鼓咬合；「けだもの」撕破纸幕；
  「ディスオーダー」「OS非対応」是冷色投影仪的故障画面；「対象外」盖章；「脳細胞」吊牌连成网
- **Interlude**：灯泡熄灭，幻灯机投出专辑封面，封面里的兽变成真的影子活过来、分裂成三只轮流咬合，最后扑向灯
- **Verse 2**：纸幕变成规则本（横线 + 条款编号），「勝利條件」被墨涂黑；问号吊坠摇晃；
  兽走进画面，「なあ」时转身；一双鞋的影子踩着拍子走过；「何すりゃいい」变成对话气泡
- **Break 2**：主灯变暗，多盏频闪灯从不同角度投出「I hate me.」的重影，第二遍灯更多、带红光
- **Pre-chorus 2**：楼梯改为向上，卡片从上方坠下
- **Bridge**：投影仪失去信号，雪花噪点里光标卡点按下 [CANCEL] 却报错；规则化作木偶线缠住歌词；
  胶片片头倒数后放映泛黄的旧影像，「あの時」
- **Chorus 2**：同副歌 1，纸幕边缘开始燃烧，两只兽轮流咬合
- **NO SIDE / Outro**：线绳在空白处结成网，「脳細胞」吊牌挂上网结，信号脉冲随拍沿线传递；
  最后「脳細胞に」被烧穿成发光的镂空字
- **End**：回到开场的画面，灯泡越摆越大，最后一拍炸裂、黑场

## 用法

依赖：Node ≥ 18、Python 3（`librosa soundfile fonttools scipy pillow`）、ffmpeg（带 libx264）。

```bash
npm install
pip install librosa soundfile fonttools scipy pillow
npm run fetch     # 下载素材（Google Drive）和字体（google/fonts，SIL OFL），并从封面抠出手影「兽」
npm run render    # 分析音频 -> 多进程渲染 -> 合并 -> 封装原始音轨
# 输出：output/KEDAMONO_AYAKASHI_lyric_video_4K60.mov
npm run cover     # 封面：output/cover_16x9.{jpg,png}（1920×1080）、output/cover_4x3.jpg（1440×1080）
./scripts/verify_output.sh   # 校验：音轨与源 WAV 逐样本一致、全片可解码、帧数正确
```

预览某几个时间点的画面：

```bash
npm run analyze                                   # 只需一次
node src/render.mjs --design theater --stills 4.5,45.6,110.6 --outdir build/stills
```

可调参数（环境变量）：`DESIGN`（`theater` = 影絵劇場，`classic` = 第一版故障风，默认 theater）、
`SCALE`（2 = 4K，1 = 1080p，默认 2）、`JOBS`（并行进程数，默认 3）、`CRF`（默认 17）、`PRESET`（默认 medium）、`FPS`（默认 60）。

画面逻辑坐标始终是 1920×1080，`SCALE` 只改变画布的物理分辨率，所以 4K 是原生绘制，不是放大 1080p。

封面的关键内容（手影、标题、标签）都在画面中央 1440×1080 的 4:3 安全区内，并避开底部平台叠加时长 / 播放量的区域，
所以 16:9 原图和居中裁成 4:3 都完整。

## 结构

| 文件 | 作用 |
| --- | --- |
| `src/analyze_audio.py` | 离线音频分析：响度、频段能量、鼓点（kick/snare）、频谱，逐帧写入 `build/analysis.json` |
| `src/audio.mjs` | 按时间查询分析结果；141 BPM 节拍网格（beat 0 = 0.112 s，对 onset 包络做网格搜索测得）；读取 16/24/32-bit PCM |
| `src/lyrics.mjs` | LRC 解析（同时间戳的第二行视为中文翻译）、翻译修订；classic 版的逐句编排表 |
| `src/theater.mjs` | **影絵劇場**：光源 / 投影 / 景深模型、逐句编排、各段道具与动效、字幕、封面构图 |
| `src/scene.mjs` | classic 版（第一版故障 / HUD 风格） |
| `src/lib.mjs` | 缓动、确定性随机、字体注册、素材文件名、封面变体、逐字排版 |
| `src/render.mjs` | 渲染静帧或指定帧区间，直接把 RGBA 帧喂给 ffmpeg（`--design theater|classic`） |
| `src/cover_theater.mjs` / `src/cover.mjs` | 封面（影絵劇場 / classic） |
| `scripts/extract_beast.py` | 从封面抠出手影「兽」的剪影和可以开合的下颚 |
| `scripts/render_video.sh` | 完整流水线（并行分段渲染 → concat → `-c:a copy` 封装原音轨） |
| `scripts/verify_output.sh` | 成片校验 |

每一帧只取决于时间 `t`（所有随机都由时间/序号做种子），所以可以任意顺序、多进程并行渲染。

## 说明

- 素材（音频 / 封面 / LRC）、由封面派生的手影图和字体都不入库，由 `npm run fetch` 下载 / 生成。
- 字体均为 SIL Open Font License：Shippori Mincho B1、Dela Gothic One、Zen Kaku Gothic New、DotGothic16、
  Noto Sans SC / Noto Serif SC、Antonio、Bebas Neue、Share Tech Mono、Courier Prime。
