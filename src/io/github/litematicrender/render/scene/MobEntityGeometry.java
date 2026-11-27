package io.github.litematicrender.render.scene;

import io.github.litematicrender.nbt.*;
import io.github.litematicrender.render.Image;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.schematic.SchematicEntity;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static io.github.litematicrender.render.scene.EntityGeometry.*;

/** 常见原版生物实体的静态几何（遵循原版模型尺寸与贴图 UV；保留 pig/cow 不纳入以兼容旧回归测试）。 */
final class MobEntityGeometry {
    private static final Set<String> SUPPORTED = Set.of(
        "villager", "zombie_villager", "wandering_trader",
        "shulker", "allay", "copper_golem",
        "zombie", "husk", "drowned",
        "skeleton", "stray", "wither_skeleton", "bogged",
        "zombified_piglin", "piglin_brute",
        "witch", "pillager", "vindicator", "evoker",
        "creeper", "enderman",
        "slime", "magma_cube", "blaze",
        "guardian", "elder_guardian", "ghast", "happy_ghast", "warden"
    );

    private static final String[] SHULKER_DYES = {
        "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
        "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"
    };

    private MobEntityGeometry() {}

    static boolean supports(String id) { return SUPPORTED.contains(id); }

    static void emit(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, float[] light) {
        String id = kind(entity);
        if (id.equals("shulker")) { shulker(geo, mesh, entity, x, y, z, light); return; }
        double attrScale = Math.max(.0625, Math.min(16, attribute(entity.data(), "scale", 1)));
        Mat world = Mat.identity().translate(x, y, z).scale(attrScale, attrScale, attrScale)
            .rotateY(Math.toRadians(180 - entity.yaw())).scale(-1, -1, 1).translate(0, -1.501, 0);
        switch (id) {
            case "villager", "zombie_villager", "wandering_trader" -> villager(geo, mesh, entity, id, world, light);
            case "allay" -> allay(geo, mesh, entity, world, light);
            case "copper_golem" -> copperGolem(geo, mesh, entity, x, y, z, attrScale, light);
            case "zombie", "husk", "drowned" -> zombie(geo, mesh, entity, id, world, light);
            case "skeleton", "stray", "wither_skeleton", "bogged" -> skeleton(geo, mesh, entity, id, world, light);
            case "zombified_piglin", "piglin_brute" -> geo.piglinVariant(mesh, entity, world, light, id);
            case "witch" -> witch(geo, mesh, entity, world, light);
            case "pillager", "vindicator", "evoker" -> illager(geo, mesh, entity, id, world, light);
            case "creeper" -> creeper(geo, mesh, entity, world, light);
            case "enderman" -> enderman(geo, mesh, entity, world, light);
            case "slime", "magma_cube" -> slime(geo, mesh, entity, id.equals("magma_cube"), x, y, z, attrScale, light);
            case "blaze" -> blaze(geo, mesh, entity, world, light);
            case "guardian", "elder_guardian" -> guardian(geo, mesh, entity, id.equals("elder_guardian"), x, y, z, attrScale, light);
            case "ghast", "happy_ghast" -> ghast(geo, mesh, entity, id.equals("happy_ghast"), x, y, z, attrScale, light);
            case "warden" -> warden(geo, mesh, entity, world, light);
            default -> { }
        }
    }

    private static void villager(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, String id, Mat world, float[] light) {
        boolean baby = !id.equals("wandering_trader") && (baby(entity) || SchematicEntity.number(entity.data(), "Age", 0) < 0);
        boolean zombie = id.equals("zombie_villager");
        Mat m = baby ? world.translate(0, .75, 0).scale(.5, .5, .5) : world;
        double pitch = Math.toRadians(entity.pitch());
        var root = new Part();
        Part head = root.child("head", 0, 0, 0, pitch, 0, 0);
        head.box(0, 0, -4, -10, -4, 8, 10, 8);
        head.box(32, 0, -4, -10, -4, 8, 10, 8, 0.51, false);
        head.box(24, 0, -1, -3, -6, 2, 4, 2);
        Part body = root.child("body", 0, 0, 0, 0, 0, 0);
        body.box(16, 20, -4, 0, -3, 8, 12, 6);
        body.box(0, 38, -4, 0, -3, 8, 20, 6, 0.5, false);
        if (zombie) {
            root.child("right_arm", -5, 2, 0, -Math.PI / 2, 0, 0).box(44, 22, -3, -2, -2, 4, 12, 4);
            root.child("left_arm", 5, 2, 0, -Math.PI / 2, 0, 0).box(44, 22, -1, -2, -2, 4, 12, 4, 0, true);
        } else {
            Part arms = root.child("arms", 0, 3, -1, -0.75, 0, 0);
            arms.box(40, 38, -4, 2, -2, 8, 4, 4);
            arms.box(44, 22, -8, -2, -2, 4, 8, 4);
            arms.box(44, 22, 4, -2, -2, 4, 8, 4, 0, true);
        }
        root.child("right_leg", -2, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 22, -2, 0, -2, 4, 12, 4);
        root.child("left_leg", 2, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 22, -2, 0, -2, 4, 12, 4, 0, true);

        String tex;
        if (id.equals("wandering_trader")) {
            tex = geo.ensureTexture("minecraft:entity/wandering_trader/wandering_trader");
        } else {
            String folder = zombie ? "zombie_villager" : "villager";
            var vd = entity.data().getCompound("VillagerData").orElse(null);
            String biome = vd == null ? "plains" : vd.getStringOrDefault("type", "plains").replace("minecraft:", "");
            String prof = vd == null ? "none" : vd.getStringOrDefault("profession", "none").replace("minecraft:", "");
            int level = vd == null ? 1 : (int) SchematicEntity.number(vd, "level", 1);
            String levelName = switch (level) { case 2 -> "iron"; case 3 -> "gold"; case 4 -> "emerald"; case 5 -> "diamond"; default -> "stone"; };
            String key = folder + "|" + biome + "|" + prof + "|" + (prof.equals("none") || prof.equals("nitwit") ? "" : levelName);
            tex = "litematicrender:entity/" + folder + "/" + UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));
            final String fFolder = folder, fBiome = biome, fProf = prof, fLevel = levelName;
            geo.generated().computeIfAbsent(tex, k -> {
                Image base = geo.image("minecraft:entity/" + fFolder + "/" + fFolder);
                if (base == null) return new Image(64, 64);
                Image out = new Image(base.width, base.height);
                System.arraycopy(base.pixels(), 0, out.pixels(), 0, base.pixels().length);
                Image typeImg = geo.image("minecraft:entity/" + fFolder + "/type/" + fBiome);
                if (typeImg != null) SpecialBlockGeometry.over(out, typeImg, 0xFFFFFF);
                if (!fProf.equals("none") && !fProf.isEmpty()) {
                    Image profImg = geo.image("minecraft:entity/" + fFolder + "/profession/" + fProf);
                    if (profImg != null) SpecialBlockGeometry.over(out, profImg, 0xFFFFFF);
                    if (!fProf.equals("nitwit")) {
                        Image lvImg = geo.image("minecraft:entity/" + fFolder + "/profession_level/" + fLevel);
                        if (lvImg != null) SpecialBlockGeometry.over(out, lvImg, 0xFFFFFF);
                    }
                }
                return out;
            });
        }
        geo.parts(mesh, root, m, tex, 64, 64, light);
        if (zombie) geo.armor(mesh, entity, root, m, light);
    }

    private static void shulker(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, float[] light) {
        NbtCompound tag = entity.data();
        int color = (int) SchematicEntity.number(tag, "Color", 16);
        String tex = (color >= 0 && color < 16)
            ? "minecraft:entity/shulker/shulker_" + SHULKER_DYES[color]
            : "minecraft:entity/shulker/shulker";
        geo.ensureTexture(tex);
        int attach = Math.max(0, Math.min(5, (int) SchematicEntity.number(tag, "AttachFace", 0)));
        double peek = Math.max(0, Math.min(100, SchematicEntity.number(tag, "Peek", 0))) / 100.0;
        double lift = (0.5 - Math.sin((0.5 + peek) * Math.PI) * 0.5) * 8.0; // 0..8 model px
        Mat world = Mat.identity().translate(x, y + 0.5, z);
        world = switch (attach) {
            case 1 -> world.rotateX(Math.PI);             // up (ceiling)
            case 2 -> world.rotateX(Math.PI / 2);         // north
            case 3 -> world.rotateX(-Math.PI / 2);        // south
            case 4 -> world.rotateZ(-Math.PI / 2);        // west
            case 5 -> world.rotateZ(Math.PI / 2);         // east
            default -> world;                             // down (floor)
        };
        world = world.scale(-1, -1, 1).translate(0, -1.0, 0);
        var root = new Part();
        root.child("base", 0, 24, 0, 0, 0, 0).box(0, 28, -8, -8, -8, 16, 8, 16);
        root.child("lid", 0, 24 - lift, 0, 0, peek > 0.01 ? peek * Math.PI * 0.5 : 0, 0).box(0, 0, -8, -16, -8, 16, 12, 16);
        if (peek > 0.05) {
            root.child("head", 0, 12, 0, 0, Math.toRadians(entity.yaw()), 0).box(0, 52, -3, 0, -3, 6, 6, 6);
        }
        geo.parts(mesh, root, world, tex, 64, 64, light);
    }

    private static void allay(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, Mat world, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/allay/allay");
        float[] full = {1f, 1f, 1f};
        var root = new Part();
        root.child("head", 0, 18, 0, Math.toRadians(entity.pitch()), 0, 0).box(0, 0, -2.5, -5, -2.5, 5, 5, 5);
        Part body = root.child("body", 0, 18, 0, 0.15, 0, 0);
        body.box(0, 10, -1.5, 0, -1, 3, 4, 2).box(0, 16, -1.5, 0, -1, 3, 5, 2, -0.2, false);
        body.child("right_arm", -1.75, 0.5, 0, -0.6, 0, 0).box(23, 0, -0.75, -0.5, -1, 1, 4, 2);
        body.child("left_arm", 1.75, 0.5, 0, -0.6, 0, 0).box(23, 6, -0.25, -0.5, -1, 1, 4, 2);
        body.child("right_wing", -0.5, 0, 0.6, 0.4, -0.6, 0).box(16, 14, 0, 1, 0, 0, 5, 8);
        body.child("left_wing", 0.5, 0, 0.6, 0.4, 0.6, 0).box(16, 14, 0, 1, 0, 0, 5, 8);
        geo.parts(mesh, root, world, tex, 32, 32, full);
        NbtCompound held = equipment(entity.data(), "mainhand");
        if (!empty(held)) {
            Mat hm = world.mul(body.transform()).translate(0, 0.25, -0.2).scale(0.5, -0.5, -0.5);
            geo.item(mesh, held, hm, "ground", full);
        }
    }

    private static void copperGolem(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, double scale, float[] light) {
        String weather = entity.data().getStringOrDefault("weather_state", "unaffected").toLowerCase(Locale.ROOT);
        String suffix = switch (weather) {
            case "exposed" -> "_exposed"; case "weathered" -> "_weathered"; case "oxidized" -> "_oxidized";
            default -> "";
        };
        String baseTex = "minecraft:entity/copper_golem/copper_golem" + suffix;
        String eyesTex = "minecraft:entity/copper_golem/copper_golem_eyes" + suffix;
        String sprite = "litematicrender:entity/copper_golem/living" + suffix;
        geo.generated().computeIfAbsent(sprite, k -> {
            Image base = geo.image(baseTex);
            if (base == null) return new Image(64, 64);
            Image out = new Image(base.width, base.height);
            System.arraycopy(base.pixels(), 0, out.pixels(), 0, base.pixels().length);
            Image eyes = geo.image(eyesTex);
            if (eyes != null) SpecialBlockGeometry.over(out, eyes, 0xFFFFFF);
            return out;
        });
        Part root = new Part(); root.rz = Math.PI;
        Part body = root.child("body", 0, -5, 0, 0, 0, 0).box(0, 15, -4, -6, -3, 8, 6, 6);
        body.child("head", 0, -6, 0, Math.toRadians(-entity.pitch()), 0, 0)
            .box(0, 0, -4, -5, -5, 8, 5, 10, .015, false)
            .box(56, 0, -1, -2, -6, 2, 3, 2)
            .box(37, 8, -1, -9, -1, 2, 4, 2, -.015, false)
            .box(37, 0, -2, -13, -2, 4, 4, 4, -.015, false);
        body.child("right_arm", -4, -6, 0, 0, 0, 0).box(36, 16, -3, -1, -2, 3, 10, 4);
        body.child("left_arm", 4, -6, 0, 0, 0, 0).box(50, 16, 0, -1, -2, 3, 10, 4);
        root.child("right_leg", 0, -5, 0, 0, 0, 0).box(0, 27, -4, 0, -2, 4, 5, 4);
        root.child("left_leg", 0, -5, 0, 0, 0, 0).box(16, 27, 0, 0, -2, 4, 5, 4);
        Mat world = Mat.identity().translate(x, y, z).scale(scale, scale, scale).rotateY(Math.toRadians(180 - entity.yaw()));
        geo.parts(mesh, root, world, sprite, 64, 64, light);
    }

    private static void zombie(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, String id, Mat world, float[] light) {
        boolean baby = baby(entity);
        Mat m = baby ? world.translate(0, .75, 0).scale(.5, .5, .5) : (id.equals("husk") ? world.scale(1.0625, 1.0625, 1.0625) : world);
        double pitch = Math.toRadians(entity.pitch());
        var root = new Part();
        root.child("head", 0, 0, 0, pitch, 0, 0).box(0, 0, -4, -8, -4, 8, 8, 8).box(32, 0, -4, -8, -4, 8, 8, 8, .5, false);
        root.child("body", 0, 0, 0, 0, 0, 0).box(16, 16, -4, 0, -2, 8, 12, 4);
        root.child("right_arm", -5, 2, 0, -Math.PI / 2, 0, 0).box(40, 16, -3, -2, -2, 4, 12, 4);
        root.child("left_arm", 5, 2, 0, -Math.PI / 2, 0, 0).box(40, 16, -1, -2, -2, 4, 12, 4, 0, true);
        root.child("right_leg", -1.9, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -2, 0, -2, 4, 12, 4);
        root.child("left_leg", 1.9, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -2, 0, -2, 4, 12, 4, 0, true);
        String tex = "minecraft:entity/zombie/" + id;
        geo.parts(mesh, root, m, tex, 64, 64, light);
        if (id.equals("drowned")) {
            var outer = new Part();
            outer.child("head", 0, 0, 0, pitch, 0, 0).box(0, 0, -4, -8, -4, 8, 8, 8, .25, false);
            outer.child("body", 0, 0, 0, 0, 0, 0).box(16, 16, -4, 0, -2, 8, 12, 4, .25, false);
            outer.child("right_arm", -5, 2, 0, -Math.PI / 2, 0, 0).box(40, 16, -3, -2, -2, 4, 12, 4, .25, false);
            outer.child("left_arm", 5, 2, 0, -Math.PI / 2, 0, 0).box(40, 16, -1, -2, -2, 4, 12, 4, .25, true);
            outer.child("right_leg", -1.9, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -2, 0, -2, 4, 12, 4, .25, false);
            outer.child("left_leg", 1.9, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -2, 0, -2, 4, 12, 4, .25, true);
            geo.parts(mesh, outer, m, "minecraft:entity/zombie/drowned_outer_layer", 64, 64, light);
        }
        var main = equipment(entity.data(), "mainhand"); var off = equipment(entity.data(), "offhand");
        if (!empty(main)) geo.held(mesh, main, m.mul(root.children.get("right_arm").transform()), false, light);
        if (!empty(off)) geo.held(mesh, off, m.mul(root.children.get("left_arm").transform()), false, light);
        geo.armor(mesh, entity, root, m, light);
    }

    private static void skeleton(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, String id, Mat world, float[] light) {
        Mat m = id.equals("wither_skeleton") ? world.translate(0, -.3, 0).scale(1.2, 1.2, 1.2) : world;
        double pitch = Math.toRadians(entity.pitch());
        var main = equipment(entity.data(), "mainhand"); var off = equipment(entity.data(), "offhand");
        boolean hasBow = !empty(main) && main.getStringOrDefault("id", "").equals("minecraft:bow");
        double rArmX = hasBow ? -Math.PI / 2 : 0, lArmX = hasBow ? -Math.PI / 2 : 0;
        var root = new Part();
        root.child("head", 0, 0, 0, pitch, 0, 0).box(0, 0, -4, -8, -4, 8, 8, 8).box(32, 0, -4, -8, -4, 8, 8, 8, .25, false);
        root.child("body", 0, 0, 0, 0, 0, 0).box(16, 16, -4, 0, -2, 8, 12, 4);
        root.child("right_arm", -5, 2, 0, rArmX, 0, 0).box(40, 16, -1, -2, -1, 2, 12, 2);
        root.child("left_arm", 5, 2, 0, lArmX, 0, 0).box(40, 16, -1, -2, -1, 2, 12, 2, 0, true);
        root.child("right_leg", -2, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -1, 0, -1, 2, 12, 2);
        root.child("left_leg", 2, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -1, 0, -1, 2, 12, 2, 0, true);
        geo.parts(mesh, root, m, "minecraft:entity/skeleton/" + id, 64, 32, light);
        if (id.equals("stray") || id.equals("bogged")) {
            var ov = new Part();
            ov.child("head", 0, 0, 0, pitch, 0, 0).box(0, 0, -4, -8, -4, 8, 8, 8, .25, false);
            ov.child("body", 0, 0, 0, 0, 0, 0).box(16, 16, -4, 0, -2, 8, 12, 4, .25, false);
            ov.child("right_arm", -5, 2, 0, rArmX, 0, 0).box(40, 16, -3, -2, -2, 4, 12, 4, .25, false);
            ov.child("left_arm", 5, 2, 0, lArmX, 0, 0).box(40, 16, -1, -2, -2, 4, 12, 4, .25, true);
            ov.child("right_leg", -2, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -2, 0, -2, 4, 12, 4, .25, false);
            ov.child("left_leg", 2, 12, 0, entity.riding() ? -1.4137 : 0, 0, 0).box(0, 16, -2, 0, -2, 4, 12, 4, .25, true);
            geo.parts(mesh, ov, m, "minecraft:entity/skeleton/" + id + "_overlay", 64, 32, light);
        }
        if (!empty(main)) geo.held(mesh, main, m.mul(root.children.get("right_arm").transform()), false, light);
        if (!empty(off)) geo.held(mesh, off, m.mul(root.children.get("left_arm").transform()), false, light);
        geo.armor(mesh, entity, root, m, light);
    }

    private static void witch(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, Mat world, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/witch/witch");
        var root = new Part();
        Part head = root.child("head", 0, 0, 0, Math.toRadians(entity.pitch()), 0, 0);
        head.box(0, 0, -4, -10, -4, 8, 10, 8).box(24, 0, -1, -3, -6, 2, 4, 2).box(0, 0, 0, -1, -6.75, 1, 1, 1);
        Part hat = head.child("hat", -5, -10.03, -5, 0, 0, 0).box(0, 64, 0, 0, 0, 10, 2, 10);
        Part h2 = hat.child("h2", 1.75, -4, 2, -.052, 0, .026).box(0, 76, 0, 0, 0, 7, 4, 7);
        Part h3 = h2.child("h3", 1.75, -4, 2, -.105, 0, .052).box(0, 87, 0, 0, 0, 4, 4, 4);
        h3.child("h4", 1.75, -2, 2, -.209, 0, .105).box(0, 95, 0, 0, 0, 1, 2, 1, .25, false);
        root.child("body", 0, 0, 0, 0, 0, 0).box(16, 20, -4, 0, -3, 8, 12, 6).box(0, 38, -4, 0, -3, 8, 20, 6, .5, false);
        Part arms = root.child("arms", 0, 3, -1, -0.75, 0, 0);
        arms.box(40, 38, -4, 2, -2, 8, 4, 4).box(44, 22, -8, -2, -2, 4, 8, 4).box(44, 22, 4, -2, -2, 4, 8, 4, 0, true);
        root.child("right_leg", -2, 12, 0, 0, 0, 0).box(0, 22, -2, 0, -2, 4, 12, 4);
        root.child("left_leg", 2, 12, 0, 0, 0, 0).box(0, 22, -2, 0, -2, 4, 12, 4, 0, true);
        geo.parts(mesh, root, world, tex, 64, 128, light);
    }

    private static void illager(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, String id, Mat world, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/illager/" + id);
        var root = new Part();
        Part head = root.child("head", 0, 0, 0, Math.toRadians(entity.pitch()), 0, 0);
        head.box(0, 0, -4, -10, -4, 8, 10, 8).box(24, 0, -1, -3, -6, 2, 4, 2);
        root.child("body", 0, 0, 0, 0, 0, 0).box(16, 20, -4, 0, -3, 8, 12, 6).box(0, 38, -4, 0, -3, 8, 20, 6, .5, false);
        var main = equipment(entity.data(), "mainhand");
        if (id.equals("pillager") || !empty(main)) {
            double rx = id.equals("pillager") ? -Math.PI / 3 : -Math.PI / 6;
            root.child("right_arm", -5, 2, 0, rx, 0, 0).box(40, 46, -3, -2, -2, 4, 12, 4);
            root.child("left_arm", 5, 2, 0, id.equals("pillager") ? -Math.PI / 3 : 0, 0, 0).box(40, 46, -1, -2, -2, 4, 12, 4, 0, true);
        } else {
            Part arms = root.child("arms", 0, 3, -1, -0.75, 0, 0);
            arms.box(40, 38, -4, 2, -2, 8, 4, 4).box(44, 22, -8, -2, -2, 4, 8, 4).box(44, 22, 4, -2, -2, 4, 8, 4, 0, true);
        }
        root.child("right_leg", -2, 12, 0, 0, 0, 0).box(0, 22, -2, 0, -2, 4, 12, 4);
        root.child("left_leg", 2, 12, 0, 0, 0, 0).box(0, 22, -2, 0, -2, 4, 12, 4, 0, true);
        geo.parts(mesh, root, world, tex, 64, 64, light);
        if (!empty(main) && root.children.containsKey("right_arm")) {
            geo.held(mesh, main, world.mul(root.children.get("right_arm").transform()), false, light);
        }
    }

    private static void creeper(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, Mat world, float[] light) {
        var root = new Part();
        root.child("head", 0, 6, 0, Math.toRadians(entity.pitch()), 0, 0).box(0, 0, -4, -8, -4, 8, 8, 8);
        root.child("body", 0, 6, 0, 0, 0, 0).box(16, 16, -4, 0, -2, 8, 12, 4);
        root.child("right_hind_leg", -2, 18, 4, 0, 0, 0).box(0, 16, -2, 0, -2, 4, 6, 4);
        root.child("left_hind_leg", 2, 18, 4, 0, 0, 0).box(0, 16, -2, 0, -2, 4, 6, 4);
        root.child("right_front_leg", -2, 18, -4, 0, 0, 0).box(0, 16, -2, 0, -2, 4, 6, 4);
        root.child("left_front_leg", 2, 18, -4, 0, 0, 0).box(0, 16, -2, 0, -2, 4, 6, 4);
        geo.parts(mesh, root, world, "minecraft:entity/creeper/creeper", 64, 32, light);
    }

    private static void enderman(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, Mat world, float[] light) {
        var carried = entity.data().getCompound("carriedBlockState").orElse(null);
        boolean carrying = carried != null && !carried.getStringOrDefault("Name", "minecraft:air").equals("minecraft:air");
        double armX = carrying ? -0.5 : 0;
        var root = new Part();
        root.child("head", 0, -14, 0, Math.toRadians(entity.pitch()), 0, 0)
            .box(0, 0, -4, -8, -4, 8, 8, 8).box(0, 16, -4, -8, -4, 8, 8, 8, -.5, false);
        root.child("body", 0, -14, 0, 0, 0, 0).box(32, 16, -4, 0, -2, 8, 12, 4);
        root.child("right_arm", -5, -12, 0, armX, 0, 0).box(56, 0, -1, -2, -1, 2, 30, 2);
        root.child("left_arm", 5, -12, 0, armX, 0, 0).box(56, 0, -1, -2, -1, 2, 30, 2, 0, true);
        root.child("right_leg", -2, -2, 0, 0, 0, 0).box(56, 0, -1, 0, -1, 2, 30, 2);
        root.child("left_leg", 2, -2, 0, 0, 0, 0).box(56, 0, -1, 0, -1, 2, 30, 2, 0, true);
        geo.parts(mesh, root, world, "minecraft:entity/enderman/enderman", 64, 32, light);
        var eyes = new Part();
        eyes.child("head", 0, -14, 0, Math.toRadians(entity.pitch()), 0, 0).box(0, 0, -4, -8, -4, 8, 8, 8, .05, false);
        geo.parts(mesh, eyes, world, "minecraft:entity/enderman/enderman_eyes", 64, 32, new float[]{1, 1, 1});
        if (carrying) {
            var raw = LitematicaSchematic.readBlockState(carried);
            var st = geo.resolveBlockState(raw.blockId(), raw.properties());
            Mat bm = world.translate(0, 0.55, -0.65).scale(0.5, -0.5, -0.5).translate(-0.5, -0.5, -0.5);
            geo.emitMovingBlock(mesh, st, bm, light);
        }
    }

    private static void slime(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, boolean magma,
                              double x, double y, double z, double attrScale, float[] light) {
        int size = Math.max(0, Math.min(16, (int) SchematicEntity.number(entity.data(), "Size", 1)));
        double s = (size + 1) * 0.999 * attrScale;
        Mat world = Mat.identity().translate(x, y, z).scale(s, s, s)
            .rotateY(Math.toRadians(180 - entity.yaw())).scale(-1, -1, 1).translate(0, -1.501, 0);
        if (magma) {
            String tex = geo.ensureTexture("minecraft:entity/slime/magmacube");
            Image mImg = geo.image(tex);
            boolean modern64 = mImg != null && mImg.height >= mImg.width;
            var root = new Part();
            for (int i = 0; i < 8; i++) {
                int u = modern64 ? (i / 4) * 32 : (i == 2 || i == 3 ? 24 : 0);
                int v = modern64 ? (i % 4) * 9 : (i == 2 ? 10 : i == 3 ? 19 : i);
                root.child("cube" + i, 0, 0, 0, 0, 0, 0).box(u, v, -4, 16 + i, -4, 8, 1, 8);
            }
            root.child("core", 0, 0, 0, 0, 0, 0).box(modern64 ? 24 : 0, modern64 ? 40 : 16, -2, 18, -2, 4, 4, 4);
            geo.parts(mesh, root, world, tex, 64, modern64 ? 64 : 32, light);
        } else {
            String tex = geo.ensureTexture("minecraft:entity/slime/slime");
            var inner = new Part();
            inner.box(0, 16, -3, 17, -3, 6, 6, 6);
            inner.box(32, 0, -3.25, 18, -3.5, 2, 2, 2);
            inner.box(32, 4, 1.25, 18, -3.5, 2, 2, 2);
            inner.box(32, 8, 0, 21, -3.5, 1, 1, 1);
            geo.parts(mesh, inner, world, tex, 64, 32, light);
            var outer = new Part();
            outer.box(0, 0, -4, 16, -4, 8, 8, 8);
            SceneMesh.Layer prev = geo.currentLayer();
            geo.setLayer(SceneMesh.Layer.TRANSLUCENT);
            try { geo.parts(mesh, outer, world, tex, 64, 32, light); }
            finally { geo.setLayer(prev); }
        }
    }

    private static void blaze(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, Mat world, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/blaze/blaze");
        float[] full = {1f, 1f, 1f};
        var root = new Part();
        root.child("head", 0, 0, 0, Math.toRadians(entity.pitch()), 0, 0).box(0, 0, -4, -4, -4, 8, 8, 8);
        for (int i = 0; i < 4; i++) {
            double a = i * Math.PI / 2;
            root.child("rod_u" + i, Math.cos(a) * 9, -2, Math.sin(a) * 9, 0, 0, 0).box(0, 16, 0, 0, 0, 2, 8, 2);
        }
        for (int i = 0; i < 4; i++) {
            double a = i * Math.PI / 2 + Math.PI / 4;
            root.child("rod_m" + i, Math.cos(a) * 7, 2, Math.sin(a) * 7, 0, 0, 0).box(0, 16, 0, 0, 0, 2, 8, 2);
        }
        for (int i = 0; i < 4; i++) {
            double a = i * Math.PI / 2 + Math.PI / 8;
            root.child("rod_l" + i, Math.cos(a) * 5, 10, Math.sin(a) * 5, 0, 0, 0).box(0, 16, 0, 0, 0, 2, 8, 2);
        }
        geo.parts(mesh, root, world, tex, 64, 32, full);
    }

    private static void guardian(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, boolean elder,
                                 double x, double y, double z, double attrScale, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/guardian/" + (elder ? "guardian_elder" : "guardian"));
        double s = (elder ? 2.35 : 1.0) * attrScale;
        Mat world = Mat.identity().translate(x, y, z).scale(s, s, s)
            .rotateY(Math.toRadians(180 - entity.yaw())).scale(-1, -1, 1).translate(0, -1.501, 0);
        var root = new Part();
        Part head = root.child("head", 0, 16, 0, Math.toRadians(entity.pitch()), 0, 0);
        head.box(0, 0, -6, -6, -8, 12, 12, 16)
            .box(0, 28, -8, -6, -6, 2, 12, 12)
            .box(0, 28, 6, -6, -6, 2, 12, 12, 0, true)
            .box(16, 40, -6, -8, -6, 12, 2, 12)
            .box(16, 40, -6, 6, -6, 12, 2, 12);
        head.child("eye", 0, 0, -8.25, 0, 0, 0).box(8, 0, -1, -1, 0, 2, 2, 1);
        double[][] spikes = {
            {0, -5.5, -5.5, Math.PI / 4, 0, 0}, {0, -5.5, 5.5, -Math.PI / 4, 0, 0},
            {0, 5.5, -5.5, 3 * Math.PI / 4, 0, 0}, {0, 5.5, 5.5, -3 * Math.PI / 4, 0, 0},
            {5.5, -5.5, 0, 0, 0, Math.PI / 4}, {-5.5, -5.5, 0, 0, 0, -Math.PI / 4},
            {5.5, 5.5, 0, 0, 0, 3 * Math.PI / 4}, {-5.5, 5.5, 0, 0, 0, -3 * Math.PI / 4},
            {5.5, 0, -5.5, Math.PI / 2, -Math.PI / 4, 0}, {-5.5, 0, -5.5, Math.PI / 2, Math.PI / 4, 0},
            {5.5, 0, 5.5, Math.PI / 2, -3 * Math.PI / 4, 0}, {-5.5, 0, 5.5, Math.PI / 2, 3 * Math.PI / 4, 0}
        };
        for (int i = 0; i < spikes.length; i++) {
            double[] sp = spikes[i];
            head.child("spike" + i, sp[0], sp[1], sp[2], sp[3], sp[4], sp[5]).box(0, 0, -1, -6.5, -1, 2, 9, 2);
        }
        Part tail0 = head.child("tail0", 0, 0, 8, 0, 0, 0).box(40, 0, -2, -2, 0, 4, 4, 8);
        Part tail1 = tail0.child("tail1", 0, 0, 7, 0, 0, 0).box(0, 54, -1.5, -1.5, 0, 3, 3, 7);
        tail1.child("tail2", 0, 0, 6, 0, 0, 0).box(41, 32, -1, -1, 0, 2, 2, 6).box(25, 19, 0, -4.5, 3, 1, 9, 9);
        geo.parts(mesh, root, world, tex, 64, 64, light);
    }

    private static void ghast(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, boolean happy,
                              double x, double y, double z, double attrScale, float[] light) {
        boolean baby = happy && (baby(entity) || SchematicEntity.number(entity.data(), "Age", 0) < 0);
        String tex = geo.ensureTexture(happy ? (baby ? "minecraft:entity/ghast/happy_ghast_baby" : "minecraft:entity/ghast/happy_ghast") : "minecraft:entity/ghast/ghast");
        double s = (happy ? (baby ? 1.0 : 4.0) : 4.5) * attrScale;
        Mat world = Mat.identity().translate(x, y, z).scale(s, s, s)
            .rotateY(Math.toRadians(180 - entity.yaw())).scale(-1, -1, 1).translate(0, -1.501, 0);
        var root = new Part();
        root.child("body", 0, 16.0, 0, 0, 0, 0).box(0, 0, -8, -8, -8, 16, 16, 16);
        int[] lengths = {9, 11, 13, 10, 12, 10, 13, 11, 9};
        for (int i = 0; i < 9; i++) {
            double tx = ((i % 3) - 1) * 5.0;
            double tz = ((i / 3) - 1) * 5.0;
            int len = happy ? 5 : lengths[i];
            root.child("tentacle" + i, tx, 23.5, tz, 0, 0, 0).box(0, 0, -1, 0, -1, 2, len, 2);
        }
        geo.parts(mesh, root, world, tex, 64, happy ? 64 : 32, light);
    }

    private static Part wardenModel(double pitch, double grow) {
        var root = new Part();
        Part body = root.child("body", 0, 3, 0, 0, 0, 0);
        body.box(0, 0, -9, -13, -4, 18, 21, 11, grow, false);
        Part head = body.child("head", 0, -13, 0, pitch, 0, 0);
        head.box(0, 32, -8, -16, -5, 16, 16, 10, grow, false);
        head.child("left_tendril", 8, -12, 0, 0, 0, 0).box(58, 0, 0, -13, 0, 16, 16, 0, grow, false);
        head.child("right_tendril", -8, -12, 0, 0, 0, 0).box(52, 32, -16, -13, 0, 16, 16, 0, grow, false);
        body.child("right_arm", -13, -10, 1, 0, 0, 0).box(44, 50, -4, 0, -4, 8, 28, 8, grow, false);
        body.child("left_arm", 13, -10, 1, 0, 0, 0).box(0, 58, -4, 0, -4, 8, 28, 8, grow, false);
        root.child("right_leg", -5.9, 11, 0, 0, 0, 0).box(76, 48, -3.1, 0, -3, 6, 13, 6, grow, false);
        root.child("left_leg", 5.9, 11, 0, 0, 0, 0).box(76, 76, -2.9, 0, -3, 6, 13, 6, grow, false);
        return root;
    }

    private static void warden(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, Mat world, float[] light) {
        double pitch = Math.toRadians(entity.pitch());
        geo.parts(mesh, wardenModel(pitch, 0), world, geo.ensureTexture("minecraft:entity/warden/warden"), 128, 128, light);
        geo.parts(mesh, wardenModel(pitch, 0.04), world, geo.ensureTexture("minecraft:entity/warden/warden_bioluminescent_layer"), 128, 128, new float[]{1, 1, 1});
    }
}
