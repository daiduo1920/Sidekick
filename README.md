# KuroDesk · 双引擎二次元桌面伴侣工坊（v5）

> **新手请先看这里**：[新手使用与模型下载指南.md](新手使用与模型下载指南.md)（包含 30 秒上手、VRM / Live2D / BongoCat 免费模型去哪下载、认准什么格式、以及保姆级导入步骤）。

一款面向 C 端质感标准设计的 Windows 透明始终置顶桌面伴侣，采用 **VRM 3D（Three.js + `@pixiv/three-vrm`）** 与 **Live2D Cubism 4/5 + BongoCat / BongoCatMver** 双商业级完整渲染引擎。

- **绝对纯净的桌面本体**：悬停零弹窗、零按钮干扰，透明逐像素抗锯齿合成；支持 **桌面桌伴** 与 **窗沿坐姿/趴窗磁吸** 两种形态。
- **独立的 C 端配置后台（KuroStudio）**：点击系统托盘图标、双击角色或按 `Ctrl + Alt + S` 呼出，支持和纸浅色 / 墨炭深色双主题、实时互动预览、3D 镜头/着色切换、实时表情与动作触发条、以及全格式本地模型导入。
- **VRM 3D 完整渲染引擎（对标 Desktop Mate，100% 离线内置）**：
  - 基于 MIT 开源 `Three.js` + `@pixiv/three-vrm` + `@pixiv/three-vrm-animation` 离线本地化打包。
  - 原生支持 VRM 0.x / 1.0、真实 MToon 二次元三渲二描边与色阶、**SpringBone 头发/饰品物理**、MorphTarget 表情系统、骨骼与 UV 眼动追踪、**窗沿坐姿晃腿**、以及自定义 `.vrma` 骨骼动作。
  - 开箱内置 4 款官方公开许可动漫 VRM 模型（`AvatarSample_A`、`AvatarSample_B`、`Vita`、`Seed-san`），并可一键导入 VRoid Studio 自捏或 VRoid Hub / Booth 任意 `.vrm`。
- **Live2D Cubism 4/5 + BongoCat / BongoCatMver 完整渲染引擎**：
  - 完整实现硬件 FBO **蒙版裁剪与反蒙版**、**Multiply/Screen 混色**、**`physics3.json` 多摆物理模拟**、**`exp3.json` 表情混合**、**`motion3.json` 动画曲线（线性/贝塞尔/阶梯）** 与 **`pose3.json` 部件切换**。
  - 原生识别社区 **BongoCat**（`resources/background.png` + `left-keys`/`right-keys`）与 **BongoCatMver**（`config.json` + `hand`/`keyboard`）`.zip` 包，精准按 Windows 键码叠画逐键手部与键帽图层。
  - 遵循 Live2D 官方协议，用户可在「外部模型生态」中一键导入本地 `live2dcubismcore.min.js` 激活完整骨骼驱动。

## 核心功能亮点

1. **真实屏幕空间眼神追踪 & 靠近互动**：实时计算 `鼠标屏幕坐标 − 角色双眼屏幕坐标` 绝对向量；鼠标靠近时双瞳自然轻微内聚（近焦视差）、瞳孔放大、好奇歪头；快速绕眼画圈触发转圈晕乎眼（`@ @`）；轻抚头顶触发眯眼呼噜。
2. **应用场景智能感知（离线读取前台进程名，零隐私上传）**：写代码/深夜自动摆出热咖啡杯、打游戏自动切出无线游戏手柄、听歌/看视频自动戴上降噪耳机、画图设计自动切换压感数位板与画笔。
3. **Windows 系统音频实时律动（WASAPI Loopback）**：无需麦克风，原生捕获系统播放音频低频鼓点，角色随节拍点头晃发、飘出音符，桌沿灯带呈现微光频谱律动。
4. **高频快捷键专属梗表情（零文本记录）**：连按 `Ctrl+Z` 冒汗珠、按下 `Ctrl+S` 安心点头+翡翠扫光、狂按 `Ctrl+C/V` 星星眼连拍、狠拍 `Enter` 桌面冲击波。
5. **窗口边缘智能磁吸（趴窗模式）**：按 `Ctrl + Alt + D` 或在后台切换至「趴窗磁吸」，角色平滑滑行并趴在当前活动窗口顶部边缘，全屏时自动优雅隐藏。
6. **壁纸环境光融合 & 开放式资产工坊**：采样桌宠周边屏幕色调自适应调节轮廓边缘光与阴影深浅；在「资产工坊」一键导入 `.vrm` / `.glb` / `.png` / `.svg` / `.model3.json` / `.wav`，并内置可视化眼位与缩放锚点校准器。

## 启动与全局快捷键

- 双击 `KuroCat.exe` 启动桌宠；**单击系统托盘图标**（或双击桌面角色 / 按 `Ctrl + Alt + S`）打开 **KuroStudio 后台工坊**。
- 带参数启动并直接打开后台：`.\KuroCat.exe --studio`
- **全局快捷键**：
  - `Ctrl + Alt + S`：打开 / 隐藏 **KuroStudio 后台工坊**
  - `Ctrl + Alt + D`：切换 **桌面工位 / 趴窗磁吸**
  - `Ctrl + Alt + P`：开启 / 解除 **鼠标穿透锁定**
  - `Ctrl + Alt + H`：显示 / 隐藏桌宠

## 分层架构（低维护、高扩展）

- `host/`（原生 C# OS 宿主层，零外部 DLL）：`Win32Native.cs`、`WebView2Native.cs`、`ConfigStore.cs`、`AssetManager.cs`（VRM 缩略图提取 + BongoCat/Mver ZIP 解析）、`GlobalInputHook.cs`、`SystemContextMonitor.cs`、`WasapiAudioMonitor.cs`、`PetWindow.cs`、`StudioWindow.cs`、`AppCoordinator.cs`。
- `ui/vendor/`（MIT 开源离线 3D 引擎）：`three.module.min.js`、`three.core.min.js`、`GLTFLoader.js`、`BufferGeometryUtils.js`、`three-vrm.module.min.js`、`three-vrm-animation.module.min.js`、`vrmBridge.js`。
- `ui/models/vrm/`（内置公开许可 3D 动漫模型）：`AvatarSample_A.vrm`、`AvatarSample_B.vrm`、`Vita.vrm`、`Seed-san.vrm` 及提取头像。
- `ui/core/`（Pet 与 Studio 共享引擎）：`bus.js`、`registry.js`、`keymap.js`、`soundEngine.js`、`stateMachine.js`。
- `ui/renderers/`（双引擎渲染管线）：`stagePipeline.js`、`vrmRenderer.js`、`live2dRenderer.js`、`custom2dRenderer.js`、`fxLayer.js`。
- `ui/pet.*`（零 UI 透明桌宠入口）与 `ui/studio.*` + `ui/studio/studioApp.js`（C 端后台工坊）。

## 编译与调试

```powershell
.\build.ps1
```

调试模式（启用 WebView2 DevTools）：

```powershell
.\KuroCat.exe --debug --studio
```
