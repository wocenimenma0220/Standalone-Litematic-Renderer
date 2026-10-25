# 开发与验证

当前对外版本为 `1.2.0tetst-v2`，Electron 包版本为 `1.2.0-tetst-v2`。Java 引擎负责解析和渲染，Electron 界面通过逐行 UTF-8 JSON 调用引擎。

## 环境与启动

Windows 开发需要 PowerShell 7、JDK 21 或更新版本、Node.js。执行 `install.bat` 安装 Electron。打包另需 JDK 的 `jlink` 和 Windows 自带的 .NET Framework C# 编译器。

完整渲染需要 `assets/vanilla` 和 `assets/builtin`，可从已有便携包复制资源目录。快速检查无需这些资源。

## 检查入口

在项目根目录运行：

```powershell
# 编译引擎，并检查模型、时序、编辑、保存与导出队列
./verify.ps1 -JdkHome 'C:/path/to/jdk'

# 加上真实资源下的编辑、容器和活塞引擎回归
./verify.ps1 -Profile Full -JdkHome 'C:/path/to/jdk'

# 额外执行隐藏浏览器界面回归
./verify.ps1 -Ui -JdkHome 'C:/path/to/jdk'

# 额外从四个角度导出指定投影
./verify.ps1 -Schematic 'C:/models/example.litematic' -JdkHome 'C:/path/to/jdk'
```

界面回归依赖 Playwright。在 `tools/verify` 运行 `npm install`；默认使用本机 Edge。已有公共安装可通过 `PLAYWRIGHT_MODULE_PATH` 指定模块目录。

完整加载回归使用真实桌面应用，在运行完整引擎回归生成测试投影后执行 `./tools/verify/RunHiddenElectron.ps1 -Script tools/verify/direct-preview-ui.cjs`。可用 `LITEMATIC_DIRECT_SCHEMATIC` 指定其他投影，用 `LITEMATIC_TEST_HOME` 指定含资源的独立引擎目录；检查完整加载不调用分块生成、LOD 不影响加载方式，以及切换到相同加载方式时复用模型。

验证产物位于 `tools/verify/verification-output`。完整引擎回归先复制资源，在独立目录中生成投影和编辑副本。无目录链接权限时，缓存测试明确跳过链接防护子项；设置 `LITEMATIC_RENDER_TEST_LINKS=1` 可要求该项必须成功。持续集成执行默认快速检查。

## 打包

```powershell
./package.ps1 -JdkHome 'C:/path/to/jdk'
```

打包会编译引擎和启动器，准备 Java/Electron 运行时，并输出到 `dist`。参数见脚本开头。README 存在时随包复制，缺失时不会阻止打包。

发布前同步 `webapp/package.json`、锁文件、`package.ps1` 和 `tools/launcher/Launcher.cs` 的版本。发布工具读取[二维功能范围](二维微时序测试版说明.md)作为说明附件。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `src/.../serve/RenderEngine.java` | 资源、投影、场景缓存和编辑会话 |
| `src/.../schematic/ProjectionEdits.java` | 保留 NBT 的修改、联动历史和原子写入 |
| `webapp/main.js`、`preload.js` | 桌面窗口和受限界面接口 |
| `webapp/renderer/renderer.js`、`gpu-view.js`、`lod-stream.js` | 预览、漫游和分块上传 |
| `webapp/renderer/projection-edit.js` | 三维编辑交互 |
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
