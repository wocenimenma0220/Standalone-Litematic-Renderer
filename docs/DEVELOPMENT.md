# 开发与验证

应用版本号以 `webapp/package.json` 中的 `version` 为准，界面标题、启动器 `.exe` 属性与安装包名称均由 `tools/version.cjs` 统一同步派生。整体架构分为两层：Java 渲染引擎（`src/`）负责解析结构、构建网格和软件渲染导出；Electron 桌面端（`webapp/`）负责 GPU 视图、界面交互和二维画布，通过逐行 UTF-8 JSON-RPC 与 Java 进程通信。

## 环境准备

- **必备工具**：Windows、PowerShell 7（或兼容版本）、JDK 21+、Node.js（打包需使用 JDK 自带的 `jlink` 与 Windows `.NET Framework` 的 `csc.exe`）。
- **安装前端依赖**：根目录执行 `install.bat`。
- **提取游戏资源**：完整渲染与 `-Profile Full` 需要原版资产，可从本地 Minecraft Java 客户端 JAR 准备：
  ```powershell
  ./tools/prepare-resources.ps1 -ClientJar 'C:/path/to/client.jar'
  ```
  如果只跑默认快速校验（`./verify.ps1`），内置的小型夹具即可通过，不必先导完整客户端资源。

## 测试与验证脚本

在项目根目录运行：

```powershell
# 编译 Java 引擎并跑基础单测、版本同步、格式解析和渲染管线回归
./verify.ps1 -JdkHome 'C:/path/to/jdk'

# 附加完整游戏资源下的三维编辑、背包、活塞和预算回归（需已准备 assets/vanilla）
./verify.ps1 -Profile Full -JdkHome 'C:/path/to/jdk'

# 附加 Playwright 无头浏览器二维界面检查
./verify.ps1 -Ui -JdkHome 'C:/path/to/jdk'

# 附加真实 Electron 桌面端检查（GPU 画面、完整/分块加载与模型复用）
./verify.ps1 -DesktopUi -JdkHome 'C:/path/to/jdk'

# 从四个默认角度额外导出一份指定投影用于目视检查
./verify.ps1 -Schematic 'C:/models/example.litematic' -JdkHome 'C:/path/to/jdk'
```

- 浏览器 `-Ui` 检查依赖 `tools/verify` 下的 Playwright（运行前需在 `tools/verify` 执行 `npm install`）；默认调用系统 Edge，也可通过 `PLAYWRIGHT_MODULE_PATH` 指定已有的 Playwright 目录。
- `-DesktopUi` 在跑完渲染管线后通过 `./tools/verify/RunHiddenElectron.ps1 -Script tools/verify/editor/direct-preview-ui.cjs` 拉起真实 Electron 验证；可用 `LITEMATIC_DIRECT_SCHEMATIC` 指定测试投影，用 `LITEMATIC_TEST_HOME` 指定独立运行目录。
- 所有验证临时文件输出到 `tools/verify/verification-output/` 等 `*-output/` 目录（已忽略）。无目录链接权限的 Windows 环境会跳过软链接防护子检查，设置 `$env:LITEMATIC_RENDER_TEST_LINKS = '1'` 可将其转为强制断言。

## 验证目录分类（`tools/verify/`）

| 目录 | 内容 |
| --- | --- |
| `board/` | 二维画布时序、红石、活塞、流体、TNT、贴图及原版 26.3 对照脚本 |
| `editor/` | 三维编辑、选区、材料统计、资源包管理、背包/快捷栏与界面测试 |
| `render/` | Java 渲染管线、GPU/CPU 后端、LOD 流式、增量缓存、光照及性能基准测试 |
| `release/` | 版本同步、资源准备、`package.ps1` 产物冒烟及模块校验 |
| `fixtures/` | 静态回归夹具（如 `tnt-fluid-26.3.json`、`forbidden-city-size.json`） |
| `research/` | 历史对照基线、旧版引擎快照与采样记录（不参与常规构建） |

## 打包与发版

```powershell
./package.ps1 -JdkHome 'C:/path/to/jdk'
```

打包脚手架会编译 Java、重新构建带版本号属性的 `投影预览.exe`、裁剪精简 Java 运行时并打包 Electron，产物输出至 `dist/`。

版本更新流程：

1. 修改并同步版本：`node tools/version.cjs --write 1.3.0`（同步 `webapp/package-lock.json` 与 `webapp/renderer/app-version.js`）。
2. 重新构建打包并跑全套 `./verify.ps1` 检查。
3. 推送 Git 提交后，运行 `node tools/publish-test-release.cjs <完整提交 SHA>` 自动校验制品 SHA-256 并发布到 GitHub Releases（版本号不带 `-` 后缀视为正式版，自动标为 Latest；更新说明读取自 `docs/修复记录.md`）。

## 主要源码入口

| 路径 | 职责 |
| --- | --- |
| `src/.../serve/RenderEngine.java` | 资源加载、投影打开、场景缓存管理与编辑会话 |
| `src/.../schematic/ProjectionEdits.java` | 保留原 NBT 的方块修改、成对/活塞联动、撤销历史与原子写入 |
| `src/.../schematic/SchematicFormats.java` | Java `.nbt` 与 Sponge v2/v3 `.schem` 统一导入 |
| `webapp/main.js`、`preload.js` | Electron 主进程窗口、菜单及受限 IPC 接口 |
| `webapp/renderer/renderer.js`、`gpu-view.js`、`lod-stream.js` | GPU 视图、自由漫游与分块网格传输 |
| `webapp/renderer/projection-edit.js` | 三维编辑交互与快捷键控制 |
| `webapp/renderer/materials-panel.js` | 建材与容器统计、水桶换冰与表格导出 |
| `webapp/renderer/board-loader.js`、`board-session.js` | 二维画布按需加载、历史上限与暂存恢复 |
| `webapp/renderer/board-fluids.js`、`board-explosions.js`、`board-tnt.js` | 二维流体、爆炸射线与 TNT/矿车物理（详情见[二维实现说明](二维TNT与流体实现.md)） |

## 开发约定

- 三维编辑的拾取、邻居查询与提交操作需绑定到同一编辑会话；切换投影前先等在途修改收尾。局部预览变更超过 8192 个邻域方块时应提交并发起基模型重建，后台导出任务使用提交快照以避免画面撕裂。
- 二维平移与缩放直接复用已有世界快照，世界结构变化时使缓存失效并在关闭窗口前即时落盘暂存；历史栈上限控制为最多 60 步 / 32 MiB JSON。
- 分块流式加载与完整加载严格区分路径：完整加载不走分块生成；流式加载保留场景归属校验和显存预算淘汰，不常驻无上限的模型副本。
- 任务进度事件通过 `previewProgress` 的 `progressId` 匹配当前任务，避免并发/取消任务的阶段文字互相覆盖。

运行期的个人设置位于 `settings/`，磁盘缓存位于 `cache/` 和 `renders/.gpu/`，临时编辑副本在 `renders/.edit/`，运行日志在 `logs/`（均不纳入 Git）。
