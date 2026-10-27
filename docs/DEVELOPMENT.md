# 开发与验证

开发版本由 `webapp/package.json` 的 `version` 统一管理，界面版本、启动器属性和包名由它派生。Java 引擎负责解析和渲染，Electron 界面通过逐行 UTF-8 JSON 调用引擎。

## 环境与启动

Windows 开发需要 PowerShell 7、JDK 21 或更新版本、Node.js。执行 `install.bat` 安装 Electron。打包另需 JDK 的 `jlink` 和 Windows 自带的 .NET Framework C# 编译器。

完整渲染需要 `assets/vanilla` 和 `assets/builtin`。可执行 `./tools/prepare-resources.ps1 -ClientJar "C:/path/to/client.jar"` 从本地 Minecraft Java 客户端准备原版资源。快速检查使用自有小型资源夹具，无需这些外部资源。

## 检查入口

在项目根目录运行：

```powershell
# 编译引擎，并检查模型、时序、编辑、保存与导出队列
./verify.ps1 -JdkHome 'C:/path/to/jdk'

# 加上真实资源下的编辑、容器和活塞引擎回归
./verify.ps1 -Profile Full -JdkHome 'C:/path/to/jdk'

# 额外执行隐藏浏览器界面回归
./verify.ps1 -Ui -JdkHome 'C:/path/to/jdk'

# 真实 Electron：GPU 画面、完整/分块切换、缓存和加载进度
./verify.ps1 -DesktopUi -JdkHome 'C:/path/to/jdk'

# 额外从四个角度导出指定投影
./verify.ps1 -Schematic 'C:/models/example.litematic' -JdkHome 'C:/path/to/jdk'
```

界面回归依赖 Playwright。在 `tools/verify` 运行 `npm install`；默认使用本机 Edge。已有公共安装可通过 `PLAYWRIGHT_MODULE_PATH` 指定模块目录。

完整加载回归使用真实桌面应用，在运行完整引擎回归生成测试投影后执行 `./tools/verify/RunHiddenElectron.ps1 -Script tools/verify/direct-preview-ui.cjs`。可用 `LITEMATIC_DIRECT_SCHEMATIC` 指定其他投影，用 `LITEMATIC_TEST_HOME` 指定含资源的独立引擎目录；检查完整加载不调用分块生成、LOD 不影响加载方式，以及切换到相同加载方式时复用模型。

验证产物位于 `tools/verify/verification-output`。完整引擎回归先复制资源，在独立目录中生成投影和编辑副本。无目录链接权限时，缓存测试明确跳过链接防护子项；设置 `LITEMATIC_RENDER_TEST_LINKS=1` 可要求该项必须成功。默认检查实际执行模型生成、光照、透明 PNG、旋转 GIF、场景缓存和格式导入，使用自有资源夹具，不能替代真实游戏资源的外观检查。持续集成还执行二维界面和真实 Electron 三维回归，并上传 PNG、GIF 和结果报告。

## 打包

```powershell
./package.ps1 -JdkHome 'C:/path/to/jdk'
```

打包会编译引擎和启动器，准备 Java/Electron 运行时，并输出到 `dist`。参数见脚本开头。README 存在时随包复制，缺失时不会阻止打包。

修改版本后执行 `node tools/version.cjs --write` 同步锁文件和界面版本；也可用 `node tools/version.cjs --write 1.2.0-test-v3`。验证与打包都会检查一致性，启动器编译时生成版本属性，包名自动派生。便携包附带[二维功能范围](二维微时序测试版说明.md)。

正式版可用 `node tools/version.cjs --write 1.2.0`。打包、检查并推送提交后，使用 `node tools/publish-test-release.cjs <完整提交 SHA>` 发布；工具名保留兼容，正式版会使用非 Pre-release 并标记为 Latest，带后缀的版本发布为 Pre-release。工具先核对提交与附件校验值，上传并验证附件后才公开 Release。更新说明来自 `docs/修复记录.md`。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `src/.../serve/RenderEngine.java` | 资源、投影、场景缓存和编辑会话 |
| `src/.../schematic/ProjectionEdits.java` | 保留 NBT 的修改、联动历史和原子写入 |
| `webapp/main.js`、`preload.js` | 桌面窗口和受限界面接口 |
| `webapp/renderer/renderer.js`、`gpu-view.js`、`lod-stream.js` | 预览、漫游和分块上传 |
| `webapp/renderer/projection-edit.js` | 三维编辑交互 |
| `webapp/renderer/materials-panel.js` | 独立材料统计、换算与导出面板 |
| `src/.../schematic/SchematicFormats.java` | Java 结构 NBT、Sponge v2/v3 导入，编辑与预览共用 |
| `webapp/renderer/board-loader.js` | 二维模块按需加载及失败重试 |
| `webapp/renderer/board-session.js` | 二维延迟保存和历史容量限制 |
| `board-fluids.js`、`board-explosions.js`、`board-tnt.js` | 二维流体、爆炸和 TNT；行为与边界见[实现说明](二维TNT与流体实现.md) |
| `tools/verify` | 逻辑、引擎和界面回归 |

## 实现约束

- 拾取、邻居查询和提交修改属于同一操作；异步返回后核对编辑会话，切换文件前等待当前编辑收尾。
- 三维局部预览超过 8192 个邻域单元时提交并重建基础模型。重建清理预览范围，保留历史；后台导出提交快照时保留当前画面依赖的范围。
- 二维缩放和平移复用世界快照。世界变化使快照失效，关闭画布前即时保存。撤销与重做合计最多 60 条、32 MiB JSON 字符数据。
- 分块传输保留场景归属、页校验、已发布长度、取消和内存预算，不增加无预算的模型页常驻副本。
- 完整加载不生成分块模型。较大的完整模型仍分批传输以限制临时内存，这与分块生成、按视角补充细节不同；界面状态和日志需明确区分。
- 加载阶段由引擎的实际步骤触发，通过 `previewProgress` 事件传递 `progressId`，界面只更新当前任务。缓存命中跳过光照和模型生成提示，关闭光照时不显示光照计算；显卡上传前让界面绘制一次，后台等待有时间上限。
- 模型、光照和动画变化应检查实际画面。总览出现或无报错不能替代完整材质和近景验证。

设置位于 `settings`，缓存位于 `cache` 和 `renders/.gpu`，编辑副本位于 `renders/.edit`，日志位于 `logs`。这些目录不纳入源码管理。
