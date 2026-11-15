import io.github.litematicrender.model.ModelBaker;
import io.github.litematicrender.render.*;
import io.github.litematicrender.render.raster.Camera;
import io.github.litematicrender.render.scene.SceneMesh;
import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.schematic.BoardSchematic;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.serve.JsonRpcServer;
import io.github.litematicrender.serve.RenderEngine;
import io.github.litematicrender.world.BlockRegistry;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;

/** 验证 8192～81920 超高分辨率流式 PNG、无损清晰度计算与逐像素一致性。 */
public final class LosslessAndHighResRegression {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    private static void writeText(Path root, String ns, String rel, String content) throws Exception {
        Path p = root.resolve("assets/" + ns).resolve(rel);
        Files.createDirectories(p.getParent());
        Files.writeString(p, content);
    }

    private static void writeCheckerTex(Path root, String ns, String name, int res, int baseArgb) throws Exception {
        Path p = root.resolve("assets/" + ns + "/textures/block/" + name + ".png");
        Files.createDirectories(p.getParent());
        Image img = new Image(res, res);
        int cell = Math.max(1, res / 4);
        for (int y = 0; y < res; y++) {
            for (int x = 0; x < res; x++) {
                boolean dark = ((x / cell) + (y / cell)) % 2 == 1;
                img.pixels()[y * res + x] = dark ? (baseArgb - 0x00181818) : baseArgb;
            }
        }
        img.writePng(p);
    }

    private static void buildPack(Path packRoot, String ns, int texRes) throws Exception {
        writeText(packRoot, ns, "atlases/blocks.json",
            "{\"sources\":[{\"type\":\"minecraft:directory\",\"source\":\"block\",\"prefix\":\"block/\"}]}");
        StringBuilder faces = new StringBuilder();
        for (String side : List.of("up", "down", "north", "south", "east", "west")) {
            if (!faces.isEmpty()) faces.append(',');
            faces.append('"').append(side).append("\":{\"texture\":\"#all\",\"cullface\":\"").append(side).append("\"}");
        }
        for (String block : List.of("stone", "glass", "glowstone")) {
            writeText(packRoot, ns, "blockstates/" + block + ".json",
                "{\"variants\":{\"\":{\"model\":\"minecraft:block/" + block + "\"}}}");
            writeText(packRoot, ns, "models/block/" + block + ".json",
                "{\"textures\":{\"all\":\"minecraft:block/" + block + "\"},\"elements\":[{\"from\":[0,0,0],\"to\":[16,16,16],\"faces\":{" + faces + "}}]}");
        }
        writeText(packRoot, ns, "blockstates/air.json", "{\"variants\":{}}");
        writeText(packRoot, ns, "blockstates/water.json", "{\"variants\":{\"level=0\":{}}}");
        writeCheckerTex(packRoot, ns, "stone", texRes, 0xFF9C8A78);
        writeCheckerTex(packRoot, ns, "glass", texRes, 0x7060B8E8);
        writeCheckerTex(packRoot, ns, "glowstone", texRes, 0xFFFFD870);
        writeCheckerTex(packRoot, ns, "water_still", texRes, 0x903070D0);
        writeCheckerTex(packRoot, ns, "water_flow", texRes, 0x903070D0);
    }

    private static int[] readPngIhdr(Path png) throws Exception {
        byte[] header = new byte[24];
        try (var ch = Files.newByteChannel(png)) {
            var buf = java.nio.ByteBuffer.wrap(header);
            while (buf.hasRemaining()) {
                if (ch.read(buf) < 0) break;
            }
        }
        check(header[0] == (byte) 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47,
            "invalid PNG signature: " + png);
        check(header[12] == 'I' && header[13] == 'H' && header[14] == 'D' && header[15] == 'R',
            "missing IHDR chunk: " + png);
        int w = ((header[16] & 0xFF) << 24) | ((header[17] & 0xFF) << 16)
            | ((header[18] & 0xFF) << 8) | (header[19] & 0xFF);
        int h = ((header[20] & 0xFF) << 24) | ((header[21] & 0xFF) << 16)
            | ((header[22] & 0xFF) << 8) | (header[23] & 0xFF);
        return new int[]{w, h};
    }

    private static void verifyPixelMatch(SceneMesh mesh, SpriteAtlas atlas, RenderSettings base,
                                         Path outPng, int maxDeltaPerChannel) throws Exception {
        Image expected = SchematicRenderer.render(null, mesh, new Colormaps(), atlas, base);
        Camera cam = new Camera();
        cam.rotationDeg = base.rotationDeg;
        cam.slantDeg = base.slantDeg;
        SchematicRenderer.fitCameraToMesh(cam, mesh, base.width, base.height);
        cam.update();
        // 强制使用仅 3100 像素的极小条带缓冲区（分成 17 个条带）来验证与全图完全一致。
        SchematicRenderer.renderStreamingPng(mesh, atlas, base, cam, base.width, base.height, outPng, 3100, null);
        BufferedImage actual = ImageIO.read(outPng.toFile());
        check(actual.getWidth() == expected.width && actual.getHeight() == expected.height,
            "streamed PNG size mismatch");
        int maxDiff = 0;
        for (int y = 0; y < expected.height; y++) {
            for (int x = 0; x < expected.width; x++) {
                int a = expected.pixel(x, y);
                int b = actual.getRGB(x, y);
                if (a != b) {
                    int da = Math.abs(((a >>> 24) & 255) - ((b >>> 24) & 255));
                    int dr = Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255));
                    int dg = Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255));
                    int db = Math.abs((a & 255) - (b & 255));
                    maxDiff = Math.max(maxDiff, Math.max(Math.max(da, dr), Math.max(dg, db)));
                }
            }
        }
        check(maxDiff <= maxDeltaPerChannel,
            "streamed PNG pixel mismatch maxDiff=" + maxDiff + " > " + maxDeltaPerChannel + " for " + outPng.getFileName());
    }

    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]).toAbsolutePath().resolve("lossless-test");
        Files.createDirectories(root);

        Path vanillaHome = root.resolve("vanilla-home");
        buildPack(vanillaHome.resolve("assets/vanilla"), "minecraft", 16);

        List<Object> blocks = new ArrayList<>();
        for (int z = 0; z < 4; z++) {
            for (int x = 0; x < 4; x++) {
                String id = (x + z) % 3 == 0 ? "glowstone" : ((x == 1 && z == 1) ? "water" : "stone");
                blocks.add(Map.of("x", x, "y", 0, "z", z, "id", id));
            }
        }
        blocks.add(Map.of("x", 1, "y", 1, "z", 1, "id", "glass"));
        blocks.add(Map.of("x", 2, "y", 1, "z", 2, "id", "stone"));

        Path schemFile = root.resolve("sample.litematic");
        BoardSchematic.write(schemFile, blocks);

        LitematicaSchematic schem = LitematicaSchematic.load(schemFile);
        try (ResourceManager res16 = new ResourceManager(vanillaHome.resolve("assets/vanilla/assets"))) {
            BlockRegistry reg16 = BlockRegistry.load(res16);
            schem.materialize(reg16);
            Colormaps cm16 = new Colormaps();
            cm16.load(res16);
            SpriteAtlas atlas16 = SpriteAtlas.load(res16, "blocks");
            ModelBaker baker16 = new ModelBaker(res16, reg16);
            var sb16 = new io.github.litematicrender.render.scene.SceneBuilder(reg16, baker16, cm16, atlas16);
            for (var r : schem.regions().values()) {
                var o = r.blockOrigin();
                sb16.addRegion(r, new int[]{o.x(), o.y(), o.z()});
            }
            SceneMesh mesh16 = sb16.build();

            // 1. 分带流式输出与内存单帧输出逐像素对比（透明、纯色、选区半透明、图片背景）。
            RenderSettings transparent = new RenderSettings(45f, 30f, 257, 193);
            transparent.transparentBackground = true;
            verifyPixelMatch(mesh16, atlas16, transparent, root.resolve("band-transparent.png"), 0);

            RenderSettings solid = new RenderSettings(135f, 25f, 257, 193);
            solid.transparentBackground = false;
            solid.backgroundMode = "color";
            solid.backgroundColor = 0xFF1E293B;
            verifyPixelMatch(mesh16, atlas16, solid, root.resolve("band-solid.png"), 0);

            RenderSettings selected = new RenderSettings(45f, 30f, 257, 193);
            selected.selectionMin = new double[]{0, 0, 0};
            selected.selectionMax = new double[]{2.1, 2.1, 2.1};
            selected.selectionMesh = sb16.buildSelection(selected.selectionMin, selected.selectionMax);
            verifyPixelMatch(mesh16, atlas16, selected, root.resolve("band-selection.png"), 0);

            RenderSettings bgImg = new RenderSettings(45f, 30f, 257, 193);
            bgImg.transparentBackground = false;
            bgImg.backgroundMode = "image";
            Image bg = new Image(4, 3);
            for (int i = 0; i < bg.pixels().length; i++) bg.pixels()[i] = 0xFF204080 + i * 0x00100804;
            bgImg.backgroundImage = bg;
            verifyPixelMatch(mesh16, atlas16, bgImg, root.resolve("band-image.png"), 1);

            // 2. 无损尺寸随贴图清晰度自适应（16px vs 64px 资源包应提升分辨率）。
            List<Object> wideBlocks = new ArrayList<>();
            for (int x = 0; x < 16; x++) {
                for (int z = 0; z < 16; z++) {
                    wideBlocks.add(Map.of("x", x, "y", 0, "z", z, "id", "stone"));
                }
            }
            Path wideSchemPath = root.resolve("wide.litematic");
            BoardSchematic.write(wideSchemPath, wideBlocks);
            LitematicaSchematic wideSchem = LitematicaSchematic.load(wideSchemPath);
            wideSchem.materialize(reg16);
            SceneMesh wide16 = SchematicRenderer.buildScene(wideSchem, baker16, reg16, cm16, atlas16);

            RenderSettings ls16 = new RenderSettings();
            ls16.lossless = true;
            int[] size16 = SchematicRenderer.resolveOutputSize(wide16, atlas16, ls16);
            check(size16[0] >= 1024 && size16[0] < 4096, "expected 16px lossless width in [1024,4096): " + Arrays.toString(size16));

            // 加载 64x 高清资源包，同一投影无损输出尺寸应放大至 > 4096（约 4 倍）。
            Path hdPack = root.resolve("hd64-pack");
            buildPack(hdPack, "minecraft", 64);
            try (ResourceManager res64 = new ResourceManager(vanillaHome.resolve("assets/vanilla/assets"))) {
                res64.importPack(hdPack);
                BlockRegistry reg64 = BlockRegistry.load(res64);
                wideSchem.materialize(reg64);
                Colormaps cm64 = new Colormaps();
                cm64.load(res64);
                SpriteAtlas atlas64 = SpriteAtlas.load(res64, "blocks");
                ModelBaker baker64 = new ModelBaker(res64, reg64);
                SceneMesh wide64 = SchematicRenderer.buildScene(wideSchem, baker64, reg64, cm64, atlas64);

                int[] size64 = SchematicRenderer.resolveOutputSize(wide64, atlas64, ls16);
                check(size64[0] > 4096 && size64[0] >= size16[0] * 3,
                    "64px resource pack did not scale up lossless size: 16px=" + Arrays.toString(size16) + " 64px=" + Arrays.toString(size64));
            }

            // 3. 超大场景在无损模式下按 MAX_EXPORT_EDGE=81920 封顶并保持比例。
            float[] farXs = {0f, 5000f, 5000f, 0f}, farYs = {0f, 0f, 200f, 200f}, farZs = {0f, 0f, 0f, 0f};
            SceneMesh hugeMesh = new SceneMesh();
            hugeMesh.solid.add(new SceneMesh.MeshQuad(farXs, farYs, farZs, 0, 0, 1, 0, 1, 1, 0, 1, "minecraft:block/stone", -1, 1, 1, 1, 1, null, SceneMesh.Layer.SOLID));
            int[] cappedSize = SchematicRenderer.resolveOutputSize(hugeMesh, atlas16, ls16);
            check(Math.max(cappedSize[0], cappedSize[1]) == RenderSettings.MAX_EXPORT_EDGE,
                "huge lossless render was not capped to 81920: " + Arrays.toString(cappedSize));
        }

        // 4. 通过 RenderEngine 在 -Xmx1g 下端到端导出 16384x16384、81920x512、512x81920 与无损 PNG。
        System.setProperty("litematicrender.home", vanillaHome.toString());
        System.setProperty("litematicrender.skins.offline", "true");
        try (RenderEngine engine = new RenderEngine(vanillaHome)) {
            engine.loadResources(engine.defaultPackRoot());
            engine.open(schemFile);

            Path png16k = root.resolve("export-16384.png");
            RenderSettings s16k = new RenderSettings(45f, 30f, 16384, 16384);
            Map<String, Object> r16k = engine.render(png16k, s16k, false);
            check(Integer.valueOf(16384).equals(r16k.get("width")) && Integer.valueOf(16384).equals(r16k.get("height")),
                "16384 metadata mismatch: " + r16k);
            int[] ihdr16k = readPngIhdr(png16k);
            check(ihdr16k[0] == 16384 && ihdr16k[1] == 16384, "16384 IHDR mismatch: " + Arrays.toString(ihdr16k));

            Path pngWideMax = root.resolve("export-81920x512.png");
            Map<String, Object> rWide = engine.render(pngWideMax, new RenderSettings(45f, 30f, 81920, 512), false);
            check(Integer.valueOf(81920).equals(rWide.get("width")), "81920 width metadata mismatch");
            int[] ihdrWide = readPngIhdr(pngWideMax);
            check(ihdrWide[0] == 81920 && ihdrWide[1] == 512, "81920x512 IHDR mismatch");

            Path pngTallMax = root.resolve("export-512x81920.png");
            Map<String, Object> rTall = engine.render(pngTallMax, new RenderSettings(45f, 30f, 512, 81920), false);
            check(Integer.valueOf(81920).equals(rTall.get("height")), "81920 height metadata mismatch");
            int[] ihdrTall = readPngIhdr(pngTallMax);
            check(ihdrTall[0] == 512 && ihdrTall[1] == 81920, "512x81920 IHDR mismatch");

            // 无损 RPC 参数解析 & 进度事件 & 取消不留临时文件。
            var parse = JsonRpcServer.class.getDeclaredMethod("settingsFrom", Map.class);
            parse.setAccessible(true);
            RenderSettings parsedLossless = (RenderSettings) parse.invoke(null, Map.of("lossless", true, "width", 1024, "height", 1024));
            check(parsedLossless.lossless, "JsonRpcServer did not parse lossless=true");
            RenderSettings parsedInteractive = (RenderSettings) parse.invoke(null, Map.of("lossless", true, "interactive", 320));
            check(!parsedInteractive.lossless, "interactive preview must ignore lossless");

            List<String> stages = new ArrayList<>();
            Path pngLossless = root.resolve("export-lossless.png");
            Map<String, Object> rLossless = engine.render(pngLossless, parsedLossless, false, (stage, completed, total) -> stages.add(stage));
            check(Boolean.TRUE.equals(rLossless.get("lossless")), "lossless flag missing in result");
            check(stages.contains("rendering") && stages.contains("encoding"), "PNG export progress missing stages: " + stages);

            // GIF 禁止超过 4096 或 lossless。
            boolean gifRejected = false;
            try {
                engine.renderAnimation(root.resolve("bad.gif"), new RenderSettings(45f, 30f, 8192, 8192), 2, 2);
            } catch (IllegalArgumentException expectedErr) {
                gifRejected = true;
            }
            check(gifRejected, "GIF accepted 8192 resolution");

            // 取消流式导出时不能损坏磁盘目标或泄露 .tmp 文件。
            Path cancelTarget = root.resolve("cancel-streaming.png");
            RenderSettings cancelSettings = new RenderSettings(45f, 30f, 8192, 8192);
            AtomicBoolean cancelled = new AtomicBoolean(false);
            cancelSettings.cancelSignal = cancelled::get;
            boolean threwCancel = false;
            try {
                // 使用反射无法直接改 engine.cancelled，直接调用 SchematicRenderer.renderToPng 测试取消与临时文件清理。
                var mesh = engine.getClass().getDeclaredMethod("sceneMesh", boolean.class, boolean.class);
                mesh.setAccessible(true);
                SceneMesh sm = (SceneMesh) mesh.invoke(engine, false, true);
                var atlasField = engine.getClass().getDeclaredField("atlas");
                atlasField.setAccessible(true);
                SpriteAtlas at = (SpriteAtlas) atlasField.get(engine);
                SchematicRenderer.renderToPng(sm, at, cancelSettings, cancelTarget, (stage, completed, total) -> {
                    if ("rendering".equals(stage) && completed >= 1) cancelled.set(true);
                });
            } catch (CancellationException expectedCancel) {
                threwCancel = true;
            }
            check(threwCancel, "streaming PNG cancellation did not trigger");
            check(!Files.exists(cancelTarget), "cancelled streaming PNG created output file");
            try (var dir = Files.list(root)) {
                check(dir.noneMatch(p -> p.getFileName().toString().startsWith(".projection-png-")),
                    "cancelled streaming PNG leaked temp file");
            }
        }

        System.out.println("PASS: streaming banded PNG exact match, lossless 16x/64x scaling, 16384x16384 & 81920 edges, GIF guard and cancellation");
    }
}
