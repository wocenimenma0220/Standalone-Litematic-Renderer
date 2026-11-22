import io.github.litematicrender.nbt.*;
import io.github.litematicrender.nbt.io.NbtFileUtils;
import io.github.litematicrender.render.*;
import io.github.litematicrender.render.scene.*;
import io.github.litematicrender.serve.RenderEngine;
import io.github.litematicrender.world.*;
import java.nio.file.*;
import java.util.*;

/** 验证跨版本方块差异检测、更改映射与按旧版保留双路径、反向降级映射及 MaterialList / 渲染一致性。 */
public final class VersionCompatibilityRegression {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    private static NbtCompound blockTag(String id, String... kv) {
        var props = new NbtCompound();
        for (int i = 0; i < kv.length; i += 2) props.putString(kv[i], kv[i + 1]);
        return new NbtCompound().putString("Name", id).put("Properties", props);
    }

    private static Path writeSchematic(Path file, int dataVersion, List<NbtCompound> palette, int sx, int sy, int sz, int[] cells) throws Exception {
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
        NbtFileUtils.writeCompressed(file, new NbtCompound().putInt("Version", 6).putInt("MinecraftDataVersion", dataVersion).put("Metadata", new NbtCompound().put("EnclosingSize", size)).put("Regions", new NbtCompound().put("test", region)));
        return file;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Path home = Path.of(args[0]).toAbsolutePath();
        Path out = home.resolve("tools/verify/version-compat-output");
        Files.createDirectories(out);

        Path legacyFile = writeSchematic(out.resolve("legacy-1201.litematic"), 3465, List.of(
            blockTag("minecraft:air"),
            blockTag("minecraft:chain", "axis", "y"),
            blockTag("minecraft:grass"),
            blockTag("minecraft:grass_path"),
            blockTag("minecraft:sign", "rotation", "4"),
            blockTag("minecraft:cauldron", "level", "2"),
            blockTag("minecraft:cobblestone_wall", "north", "true", "south", "false")
        ), 8, 1, 1, new int[]{1, 2, 3, 4, 5, 6, 0, 0});

        Path modernFile = writeSchematic(out.resolve("modern-263.litematic"), 5023, List.of(
            blockTag("minecraft:air"),
            blockTag("minecraft:iron_chain", "axis", "y"),
            blockTag("minecraft:cinnabar")
        ), 4, 1, 1, new int[]{1, 2, 0, 0});

        try (var engine = new RenderEngine(home)) {
            engine.loadResources(engine.defaultPackRoot(), List.of());

            // 1. 默认 remap 模式打开 1.20.1 投影：应检测到差异并映射为新版 ID
            var openRes = engine.open(legacyFile);
            var compat = (Map<String, Object>) openRes.get("versionCompatibility");
            check(Boolean.TRUE.equals(compat.get("hasDifferences")), "expected cross-version differences");
            check("1.20.1".equals(compat.get("schematicVersionLabel")), "unexpected version label: " + compat.get("schematicVersionLabel"));
            var items = (List<Map<String, Object>>) compat.get("items");
            check(items.size() == 6, "expected 6 detected rules, got " + items.size());

            var matRemap = (List<Map<String, Object>>) engine.materials().get("building");
            check(matRemap.stream().anyMatch(r -> "minecraft:iron_chain".equals(r.get("id"))), "remap missing iron_chain");
            check(matRemap.stream().anyMatch(r -> "minecraft:short_grass".equals(r.get("id"))), "remap missing short_grass");
            check(engine.inspectPosition(new int[]{0, 0, 0}).get("id").equals("minecraft:iron_chain"), "inspector did not show iron_chain");

            Path pngRemap = out.resolve("remap.png");
            var renderRemap = engine.render(pngRemap, new RenderSettings(), true);
            check(!renderRemap.containsKey("unresolved"), "remap render had unresolved textures: " + renderRemap.get("unresolved"));

            // 2. 切换为按旧版保留（legacy）：应保留原 ID、无缺失材质、且草仍然正确渲染不报错
            var switchRes = engine.setVersionMapping(Map.of(
                "defaultAction", "legacy",
                "ruleActions", Map.of("chain", "legacy", "grass", "legacy", "grass_path", "legacy", "sign", "legacy", "water_cauldron", "legacy", "wall_connections", "legacy")
            ));
            var compatLegacy = (Map<String, Object>) switchRes.get("versionCompatibility");
            var legacyItems = (List<Map<String, Object>>) compatLegacy.get("items");
            check(legacyItems.stream().allMatch(i -> "legacy".equals(i.get("currentChoice"))), "currentChoice did not update to legacy");

            var matReportLegacy = engine.materials();
            var matLegacy = (List<Map<String, Object>>) matReportLegacy.get("building");
            var matWarnings = (List<String>) matReportLegacy.get("warnings");
            check(matLegacy.stream().anyMatch(r -> "minecraft:chain".equals(r.get("id"))), "legacy mode lost minecraft:chain in materials");
            check(matLegacy.stream().anyMatch(r -> "minecraft:grass".equals(r.get("id"))), "legacy mode lost minecraft:grass in materials");
            check(matWarnings.stream().noneMatch(w -> w.contains("chain") || w.contains("grass") || w.contains("sign")),
                "legacy mode produced missing stack warning: " + matWarnings);
            check("minecraft:chain".equals(engine.inspectPosition(new int[]{0, 0, 0}).get("id")), "inspector did not preserve minecraft:chain");

            Path pngLegacy = out.resolve("legacy.png");
            var renderLegacy = engine.render(pngLegacy, new RenderSettings(), true);
            check(!renderLegacy.containsKey("unresolved"), "legacy render had unresolved textures: " + renderLegacy.get("unresolved"));

            // 3. 联动 MC 1.21.8（4440）并打开含 iron_chain + cinnabar 的投影：应检测反向降级与高版本不支持方块
            engine.setVersionMapping(Map.of(
                "defaultAction", "remap",
                "ruleActions", Map.of(),
                "targetDataVersion", 4440,
                "targetVersionLabel", "1.21.8",
                "targetBlockIds", List.of("minecraft:stone", "minecraft:chain")
            ));
            var openModern = engine.open(modernFile);
            var modernCompat = (Map<String, Object>) openModern.get("versionCompatibility");
            var modernItems = (List<Map<String, Object>>) modernCompat.get("items");
            var unsupported = (List<Map<String, Object>>) modernCompat.get("unsupportedInTarget");
            check(modernItems.stream().anyMatch(i -> "chain".equals(i.get("ruleKey")) && "downgrade".equals(i.get("direction"))),
                "expected downgrade rule for iron_chain under MC 1.21.8");
            check(unsupported.stream().anyMatch(u -> "minecraft:cinnabar".equals(u.get("id"))),
                "expected cinnabar listed as unsupported in MC 1.21.8");
            check("minecraft:chain".equals(engine.inspectPosition(new int[]{0, 0, 0}).get("id")),
                "downgrade remap should expose minecraft:chain");
        }
        System.out.println("PASS: VersionCompatibility detection, remap vs legacy preservation, downgrade mapping & rendering");
    }
}
