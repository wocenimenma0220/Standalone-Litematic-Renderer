import io.github.litematicrender.model.ModelBaker;
import io.github.litematicrender.nbt.*;
import io.github.litematicrender.nbt.io.NbtFileUtils;
import io.github.litematicrender.render.*;
import io.github.litematicrender.render.scene.*;
import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.serve.MaterialList;
import io.github.litematicrender.world.*;
import java.nio.file.*;
import java.util.*;

/** 验证资源包草方块顶面与侧面覆盖层染色、远景色块颜色、跨版本方块映射与未知方块可见占位块。 */
public final class GrassAndVersionRegression {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    private static NbtCompound blockTag(String id, String... kv) {
        var props = new NbtCompound();
        for (int i = 0; i < kv.length; i += 2) props.putString(kv[i], kv[i + 1]);
        return new NbtCompound().putString("Name", id).put("Properties", props);
    }

    private static Path writeSchematic(Path file, List<NbtCompound> palette, int sx, int sy, int sz, int[] cells) throws Exception {
        int bits = Math.max(2, 32 - Integer.numberOfLeadingZeros(palette.size() - 1));
        long[] words = new long[(cells.length * bits + 63) / 64];
        for (int i = 0; i < cells.length; i++) {
            int word = i * bits / 64, shift = i * bits % 64;
            words[word] |= (long) cells[i] << shift;
            if (shift + bits > 64) words[word + 1] |= (long) cells[i] >>> (64 - shift);
        }
        var entries = new NbtList();
        palette.forEach(entries::add);
        var size = new NbtCompound().putInt("x", sx).putInt("y", sy).putInt("z", sz);
        var zero = new NbtCompound().putInt("x", 0).putInt("y", 0).putInt("z", 0);
        var region = new NbtCompound().put("Position", zero).put("Size", size).put("BlockStatePalette", entries).put("BlockStates", new NbtScalars.NbtLongArray(words));
        NbtFileUtils.writeCompressed(file, new NbtCompound().putInt("Version", 6).putInt("MinecraftDataVersion", 0).put("Metadata", new NbtCompound().put("EnclosingSize", size)).put("Regions", new NbtCompound().put("test", region)));
        return file;
    }

    private static List<SceneMesh.MeshQuad> allQuads(SceneMesh mesh) {
        var out = new ArrayList<SceneMesh.MeshQuad>();
        for (var list : List.of(mesh.solid, mesh.cutout, mesh.translucent)) out.addAll(list);
        return out;
    }

    private static boolean nearTint(SceneMesh.MeshQuad q, int rgb) {
        float er = ((rgb >> 16) & 255) / 255f, eg = ((rgb >> 8) & 255) / 255f, eb = (rgb & 255) / 255f;
        return Math.abs(q.tintR - er) < 0.02f && Math.abs(q.tintG - eg) < 0.02f && Math.abs(q.tintB - eb) < 0.02f;
    }

    private static void writeColormap(Path path, int argb) throws Exception {
        Files.createDirectories(path.getParent());
        var img = new Image(256, 256);
        Arrays.fill(img.pixels(), argb);
        img.writePng(path);
    }

    private static void verifyGrassAndOverview(Path root, Path out) throws Exception {
        try (ResourceManager resources = CliRenderer.openResources(root.resolve("assets/vanilla"), root)) {
            var registry = BlockRegistry.load(resources);
            var baker = new ModelBaker(resources, registry);
            var colors = new Colormaps();
            colors.load(resources);
            var atlas = SpriteAtlas.load(resources, "blocks");
            check(colors.grassColor() == 0x91BD59, "unexpected vanilla plains grass color: " + Integer.toHexString(colors.grassColor()));

            var f = writeSchematic(out.resolve("grass.litematic"), List.of(
                blockTag("minecraft:air"),
                blockTag("minecraft:grass_block", "snowy", "false"),
                blockTag("minecraft:grass_block", "snowy", "true"),
                blockTag("minecraft:oak_leaves", "persistent", "true")
            ), 5, 2, 2, new int[]{
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                1, 0, 2, 0, 3, 0, 0, 0, 0, 0
            });
            var sch = LitematicaSchematic.load(f);
            sch.materialize(registry);
            var builder = new SceneBuilder(registry, baker, colors, atlas);
            for (var r : sch.regions().values()) builder.addRegion(r, new int[]{0, 0, 0});
            var quads = allQuads(builder.build());

            var normalGrass = quads.stream().filter(q -> q.blockX == 0 && q.blockY == 1).toList();
            var top = normalGrass.stream().filter(q -> "minecraft:block/grass_block_top".equals(q.spriteId)).findFirst().orElseThrow();
            var overlay = normalGrass.stream().filter(q -> "minecraft:block/grass_block_side_overlay".equals(q.spriteId)).findFirst().orElseThrow();
            var baseSide = normalGrass.stream().filter(q -> "minecraft:block/grass_block_side".equals(q.spriteId)).findFirst().orElseThrow();
            check(nearTint(top, 0x91BD59), "vanilla grass top lost colormap tint");
            check(nearTint(overlay, 0x91BD59), "vanilla grass side overlay was not tinted");
            check(nearTint(baseSide, 0xFFFFFF), "dirt base side should remain untinted");

            var snowyQuads = quads.stream().filter(q -> q.blockX == 2 && q.blockY == 1).toList();
            check(snowyQuads.stream().allMatch(q -> nearTint(q, 0xFFFFFF)), "snowy grass block should stay untinted");
        }

        // 验证自定义材质包 grass.png / foliage.png 会同时作用于近景方块和远景纯色概览块。
        Path customPack = out.resolve("custom-colormap-pack");
        writeColormap(customPack.resolve("assets/minecraft/textures/colormap/grass.png"), 0xFF22CC66);
        writeColormap(customPack.resolve("assets/minecraft/textures/colormap/foliage.png"), 0xFF11AA55);
        try (ResourceManager resources = CliRenderer.openResources(root.resolve("assets/vanilla"), root)) {
            resources.importPack(customPack);
            var registry = BlockRegistry.load(resources);
            var baker = new ModelBaker(resources, registry);
            var colors = new Colormaps();
            colors.load(resources);
            var atlas = SpriteAtlas.load(resources, "blocks");
            check(colors.grassColor() == 0x22CC66, "custom grass colormap did not override vanilla");

            var f = writeSchematic(out.resolve("custom-pack.litematic"), List.of(
                blockTag("minecraft:air"),
                blockTag("minecraft:grass_block", "snowy", "false"),
                blockTag("minecraft:oak_leaves", "persistent", "true")
            ), 3, 1, 1, new int[]{1, 0, 2});
            var sch = LitematicaSchematic.load(f);
            sch.materialize(registry);
            var builder = new SceneBuilder(registry, baker, colors, atlas);
            for (var r : sch.regions().values()) builder.addRegion(r, new int[]{0, 0, 0});
            var quads = allQuads(builder.build());
            var top = quads.stream().filter(q -> q.blockX == 0 && "minecraft:block/grass_block_top".equals(q.spriteId)).findFirst().orElseThrow();
            var overlay = quads.stream().filter(q -> q.blockX == 0 && "minecraft:block/grass_block_side_overlay".equals(q.spriteId)).findFirst().orElseThrow();
            check(nearTint(top, 0x22CC66) && nearTint(overlay, 0x22CC66), "custom resource pack grass tint not applied to top+overlay");

            var grassSch = LitematicaSchematic.load(writeSchematic(out.resolve("overview-grass.litematic"), List.of(blockTag("minecraft:air"), blockTag("minecraft:grass_block", "snowy", "false")), 1, 1, 1, new int[]{1}));
            grassSch.materialize(registry);
            var grassOverview = new OverviewMesh(grassSch, baker, colors, atlas);
            int upRgb = grassOverview.buildSection(grassOverview.sections().getFirst()).solid.stream().filter(q -> q.y0 > 0 && q.y1 > 0).findFirst().orElseThrow().rgb;
            int r = (upRgb >> 16) & 255, g = (upRgb >> 8) & 255, b = upRgb & 255;
            check(g > r * 2 && g > b, "overview grass color block did not reflect resource pack green: #" + Integer.toHexString(upRgb));
        }
    }

    private static void verifyLegacyAndMissing(Path root, Path out) throws Exception {
        try (ResourceManager resources = CliRenderer.openResources(root.resolve("assets/vanilla"), root)) {
            var registry = BlockRegistry.load(resources);
            var baker = new ModelBaker(resources, registry);
            var colors = new Colormaps();
            colors.load(resources);
            var atlas = SpriteAtlas.load(resources, "blocks");

            var palette = List.of(
                blockTag("minecraft:air"),
                blockTag("minecraft:chain", "axis", "y"),
                blockTag("minecraft:grass"),
                blockTag("minecraft:grass_path"),
                blockTag("minecraft:sign", "rotation", "4"),
                blockTag("minecraft:wall_sign", "facing", "north"),
                blockTag("minecraft:cobblestone_wall", "north", "true", "south", "false", "up", "true"),
                blockTag("minecraft:cauldron", "level", "2"),
                blockTag("minecraft:future_test_block", "phase", "42")
            );
            int[] cells = new int[16];
            for (int i = 1; i < palette.size(); i++) cells[i * 2 - 2] = i;
            var f = writeSchematic(out.resolve("legacy-and-missing.litematic"), palette, 16, 1, 1, cells);
            var sch = LitematicaSchematic.load(f);
            sch.materialize(registry);

            var reg = sch.regions().values().iterator().next();
            check("minecraft:iron_chain".equals(reg.blocks.get(0, 0, 0).blockId), "chain did not map to iron_chain");
            check("minecraft:short_grass".equals(reg.blocks.get(2, 0, 0).blockId), "grass did not map to short_grass");
            check("minecraft:dirt_path".equals(reg.blocks.get(4, 0, 0).blockId), "grass_path did not map to dirt_path");
            check("minecraft:oak_sign".equals(reg.blocks.get(6, 0, 0).blockId), "sign did not map to oak_sign");
            check("minecraft:oak_wall_sign".equals(reg.blocks.get(8, 0, 0).blockId), "wall_sign did not map to oak_wall_sign");
            check("low".equals(reg.blocks.get(10, 0, 0).getValue("north")), "pre-1.16 wall true did not adapt to low");
            check("minecraft:water_cauldron".equals(reg.blocks.get(12, 0, 0).blockId), "filled cauldron did not map to water_cauldron");

            RenderDiagnostics.reset();
            var builder = new SceneBuilder(registry, baker, colors, atlas);
            builder.addRegion(reg, new int[]{0, 0, 0});
            var quads = allQuads(builder.build());
            for (int cell = 0; cell < 7; cell++) {
                final int bx = cell * 2;
                var cq = quads.stream().filter(q -> q.blockX == bx).toList();
                check(!cq.isEmpty(), "legacy block rendered 0 quads at x=" + bx);
                check(cq.stream().noneMatch(q -> "minecraft:missingno".equals(q.spriteId)), "legacy block rendered missingno at x=" + bx);
            }
            var missingQuads = quads.stream().filter(q -> q.blockX == 14).toList();
            check(missingQuads.size() == 6 && missingQuads.stream().allMatch(q -> "minecraft:missingno".equals(q.spriteId)),
                "unknown future block should render 6 missingno cube faces, got: " + missingQuads.size());
            var diagBytes = new java.io.ByteArrayOutputStream();
            RenderDiagnostics.report(new java.io.PrintStream(diagBytes, true, java.nio.charset.StandardCharsets.UTF_8));
            check(diagBytes.toString(java.nio.charset.StandardCharsets.UTF_8).contains("future_test_block"),
                "diagnostic missing for unmapped future block");

            var report = new MaterialList(resources, root).collect(sch);
            @SuppressWarnings("unchecked")
            var warnings = (List<String>) report.get("warnings");
            check(warnings.stream().noneMatch(w -> w.contains("iron_chain") || w.contains("short_grass") || w.contains("dirt_path") || w.contains("oak_sign")),
                "legacy block missing from material stack table: " + warnings);
        }
    }

    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]).toAbsolutePath();
        Path out = root.resolve("tools/verify/grass-version-output");
        Files.createDirectories(out);
        System.setProperty("litematicrender.home", root.toString());
        System.setProperty("litematicrender.skins.offline", "true");
        verifyGrassAndOverview(root, out);
        verifyLegacyAndMissing(root, out);
        System.out.println("PASS: vanilla & custom resource-pack grass tint (top+overlay+overview), legacy IDs/states, and visible missingno cube");
    }
}
