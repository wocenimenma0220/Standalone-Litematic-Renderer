package io.github.litematicrender.render.scene;

import io.github.litematicrender.nbt.*;
import io.github.litematicrender.render.*;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.schematic.SchematicEntity;
import io.github.litematicrender.world.BlockState;
import java.util.*;
import static io.github.litematicrender.render.scene.EntityGeometry.*;

/** 常用装饰与展示实体静态几何：盔甲架、画、末地水晶、拴绳结及 block/item/text_display。 */
final class DisplayAndDecorEntityGeometry {
    private static final Set<String> SUPPORTED = Set.of(
        "armor_stand", "painting", "end_crystal", "leash_knot",
        "block_display", "item_display", "text_display");

    /** 51 种原版画作的方块宽高表（宽, 高），兼容高清材质包不被贴图倍率放大。 */
    private static final Map<String, int[]> PAINTING_SIZES = Map.ofEntries(
        Map.entry("alban", new int[]{1, 1}), Map.entry("aztec", new int[]{1, 1}), Map.entry("aztec2", new int[]{1, 1}),
        Map.entry("bomb", new int[]{1, 1}), Map.entry("kebab", new int[]{1, 1}), Map.entry("meditative", new int[]{1, 1}),
        Map.entry("plant", new int[]{1, 1}), Map.entry("wasteland", new int[]{1, 1}),
        Map.entry("courbet", new int[]{2, 1}), Map.entry("creebet", new int[]{2, 1}), Map.entry("pool", new int[]{2, 1}),
        Map.entry("sea", new int[]{2, 1}), Map.entry("sunset", new int[]{2, 1}),
        Map.entry("graham", new int[]{1, 2}), Map.entry("prairie_ride", new int[]{1, 2}), Map.entry("wanderer", new int[]{1, 2}),
        Map.entry("baroque", new int[]{2, 2}), Map.entry("bust", new int[]{2, 2}), Map.entry("earth", new int[]{2, 2}),
        Map.entry("fire", new int[]{2, 2}), Map.entry("humble", new int[]{2, 2}), Map.entry("match", new int[]{2, 2}),
        Map.entry("skull_and_roses", new int[]{2, 2}), Map.entry("stage", new int[]{2, 2}), Map.entry("void", new int[]{2, 2}),
        Map.entry("water", new int[]{2, 2}), Map.entry("wind", new int[]{2, 2}), Map.entry("wither", new int[]{2, 2}),
        Map.entry("bouquet", new int[]{3, 3}), Map.entry("cavebird", new int[]{3, 3}), Map.entry("cotan", new int[]{3, 3}),
        Map.entry("dennis", new int[]{3, 3}), Map.entry("endboss", new int[]{3, 3}), Map.entry("fern", new int[]{3, 3}),
        Map.entry("owlemons", new int[]{3, 3}), Map.entry("sunflowers", new int[]{3, 3}), Map.entry("tides", new int[]{3, 3}),
        Map.entry("backyard", new int[]{3, 4}), Map.entry("pond", new int[]{3, 4}),
        Map.entry("changing", new int[]{4, 2}), Map.entry("fighters", new int[]{4, 2}), Map.entry("finding", new int[]{4, 2}),
        Map.entry("lowmist", new int[]{4, 2}), Map.entry("passage", new int[]{4, 2}),
        Map.entry("donkey_kong", new int[]{4, 3}), Map.entry("skeleton", new int[]{4, 3}),
        Map.entry("burning_skull", new int[]{4, 4}), Map.entry("orb", new int[]{4, 4}), Map.entry("pigscene", new int[]{4, 4}),
        Map.entry("pointer", new int[]{4, 4}), Map.entry("unpacked", new int[]{4, 4})
    );

    private DisplayAndDecorEntityGeometry() {}

    static boolean supports(String id) { return SUPPORTED.contains(id); }

    static void emit(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, float[] light) {
        String id = kind(entity);
        switch (id) {
            case "armor_stand" -> armorStand(geo, mesh, entity, x, y, z, light);
            case "painting" -> painting(geo, mesh, entity, x, y, z, light);
            case "end_crystal" -> endCrystal(geo, mesh, entity, x, y, z, light);
            case "leash_knot" -> leashKnot(geo, mesh, x, y, z, light);
            case "block_display", "item_display", "text_display" -> display(geo, mesh, entity, id, x, y, z, light);
            default -> { }
        }
    }

    private static double[] poseDeg(NbtCompound pose, String key, double dx, double dy, double dz) {
        if (pose == null) return new double[]{dx, dy, dz};
        var list = pose.getList(key).orElse(null);
        if (list == null || list.size() < 3) return new double[]{dx, dy, dz};
        return new double[]{
            SchematicEntity.number(list.get(0), dx),
            SchematicEntity.number(list.get(1), dy),
            SchematicEntity.number(list.get(2), dz)};
    }

    private static void armorStand(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, float[] light) {
        NbtCompound tag = entity.data();
        boolean small = tag.getBooleanOrDefault("Small", false);
        boolean showArms = tag.getBooleanOrDefault("ShowArms", false);
        boolean noBasePlate = tag.getBooleanOrDefault("NoBasePlate", false);
        boolean invisible = tag.getBooleanOrDefault("Invisible", false);
        NbtCompound pose = tag.getCompound("Pose").orElse(null);
        double[] pHead = poseDeg(pose, "Head", 0, 0, 0);
        double[] pBody = poseDeg(pose, "Body", 0, 0, 0);
        double[] pLeftArm = poseDeg(pose, "LeftArm", -10, 0, -10);
        double[] pRightArm = poseDeg(pose, "RightArm", -15, 0, 10);
        double[] pLeftLeg = poseDeg(pose, "LeftLeg", -1, 0, -1);
        double[] pRightLeg = poseDeg(pose, "RightLeg", 1, 0, 1);

        double scale = Math.max(.0625, Math.min(16, attribute(tag, "scale", 1))) * (small ? 0.5 : 1.0);
        Mat world = Mat.identity().translate(x, y, z).scale(scale, scale, scale)
            .rotateY(Math.toRadians(180 - entity.yaw())).scale(-1, -1, 1).translate(0, -1.501, 0);

        var root = new Part();
        Part head = root.child("head", 0, 1, 0, Math.toRadians(pHead[0]), Math.toRadians(pHead[1]), Math.toRadians(pHead[2]));
        Part body = root.child("body", 0, 0, 0, Math.toRadians(pBody[0]), Math.toRadians(pBody[1]), Math.toRadians(pBody[2]));
        Part rightArm = root.child("right_arm", -5, 2, 0, Math.toRadians(pRightArm[0]), Math.toRadians(pRightArm[1]), Math.toRadians(pRightArm[2]));
        Part leftArm = root.child("left_arm", 5, 2, 0, Math.toRadians(pLeftArm[0]), Math.toRadians(pLeftArm[1]), Math.toRadians(pLeftArm[2]));
        Part rightLeg = root.child("right_leg", -1.9, 12, 0, Math.toRadians(pRightLeg[0]), Math.toRadians(pRightLeg[1]), Math.toRadians(pRightLeg[2]));
        Part leftLeg = root.child("left_leg", 1.9, 12, 0, Math.toRadians(pLeftLeg[0]), Math.toRadians(pLeftLeg[1]), Math.toRadians(pLeftLeg[2]));

        if (!invisible) {
            head.box(0, 0, -1, -7, -1, 2, 7, 2);
            body.box(0, 26, -6, 0, -1.5, 12, 3, 3)
                .box(16, 0, -3, 3, -1, 2, 7, 2)
                .box(48, 16, 1, 3, -1, 2, 7, 2)
                .box(0, 48, -4, 10, -1, 8, 2, 2);
            if (showArms) {
                rightArm.box(24, 0, -2, -2, -1, 2, 12, 2);
                leftArm.box(32, 16, 0, -2, -1, 2, 12, 2, 0, true);
            }
            rightLeg.box(8, 0, -1, 0, -1, 2, 11, 2);
            leftLeg.box(40, 16, -1, 0, -1, 2, 11, 2, 0, true);
            if (!noBasePlate) {
                root.child("base_plate", 0, 12, 0, 0, 0, 0).box(0, 32, -6, 11, -6, 12, 1, 12);
            }
            geo.parts(mesh, root, world, geo.ensureTexture("minecraft:entity/armorstand/armorstand"), 64, 64, light);
        }

        // 渲染穿戴护甲、头部方块/头颅以及手持物品（隐形盔甲架同样保留装备）。
        geo.armor(mesh, entity, root, world, light);
        NbtCompound headItem = equipment(tag, "head");
        if (!empty(headItem)) {
            String hid = headItem.getStringOrDefault("id", "");
            if (!hid.endsWith("_helmet")) {
                Mat hm = world.mul(head.transform()).translate(0, -.25, 0).rotateY(Math.PI).scale(.625, -.625, -.625);
                geo.item(mesh, headItem, hm, "head", light);
            }
        }
        NbtCompound main = equipment(tag, "mainhand"), off = equipment(tag, "offhand");
        if (!empty(main)) geo.held(mesh, main, world.mul(rightArm.transform()), false, light);
        if (!empty(off)) geo.held(mesh, off, world.mul(leftArm.transform()), false, light);
    }

    private static void painting(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, float[] light) {
        NbtCompound tag = entity.data();
        String variant = "";
        var varEl = tag.get("variant").orElse(null);
        if (varEl instanceof NbtScalars.NbtString s) variant = s.value;
        else if (varEl instanceof NbtCompound c) variant = c.getStringOrDefault("asset_id", c.getStringOrDefault("id", ""));
        if (variant.isEmpty()) variant = tag.getStringOrDefault("Motive", "kebab");
        variant = variant.toLowerCase(Locale.ROOT);
        String ns = "minecraft", path = variant;
        int colon = variant.indexOf(':');
        if (colon >= 0) { ns = variant.substring(0, colon); path = variant.substring(colon + 1); }
        // 兼容 1.12 驼峰式 Motive 名称（如 SkullAndRoses -> skull_and_roses）。
        if (!PAINTING_SIZES.containsKey(path)) {
            String legacy = switch (path) {
                case "skullandroses" -> "skull_and_roses";
                case "burningskull" -> "burning_skull";
                case "donkeykong" -> "donkey_kong";
                default -> path;
            };
            path = legacy;
        }
        String frontTex = ns + ":painting/" + path;
        Image frontImg = geo.image(frontTex);
        if (frontImg == null) { frontTex = "minecraft:painting/kebab"; frontImg = geo.image(frontTex); path = "kebab"; }
        if (frontImg != null) geo.generated().putIfAbsent(frontTex, frontImg);
        String backTex = geo.ensureTexture("minecraft:painting/back");

        int[] dims = PAINTING_SIZES.get(path);
        double wBlocks = dims != null ? dims[0] : (frontImg != null ? Math.max(1, frontImg.width / 16.0) : 1);
        double hBlocks = dims != null ? dims[1] : (frontImg != null ? Math.max(1, frontImg.height / 16.0) : 1);

        int facing = 3; // 2=north, 3=south, 4=west, 5=east
        var fEl = tag.get("facing").orElse(null);
        if (fEl instanceof NbtScalars.NbtString s) {
            facing = switch (s.value) { case "north" -> 2; case "west" -> 4; case "east" -> 5; default -> 3; };
        } else if (fEl != null) {
            int raw = (int) SchematicEntity.number(fEl, 3);
            facing = raw >= 2 && raw <= 5 ? raw : switch (raw & 3) { case 0 -> 3; case 1 -> 4; case 2 -> 2; default -> 5; };
        } else if (tag.contains("Facing")) {
            int raw = (int) SchematicEntity.number(tag, "Facing", 0);
            facing = switch (raw & 3) { case 0 -> 3; case 1 -> 4; case 2 -> 2; default -> 5; };
        }
        double yawDeg = switch (facing) { case 2 -> 180; case 4 -> 90; case 5 -> -90; default -> 0; };
        Mat m = Mat.identity().translate(x, y, z).rotateY(Math.toRadians(yawDeg));
        double hw = wBlocks * 0.5, hh = hBlocks * 0.5, d = 1.0 / 32.0;
        // 正面朝 +Z（对应 south，经 yawDeg 旋转到目标墙面朝向）。
        geo.face(mesh, new double[][]{{-hw, hh, d}, {-hw, -hh, d}, {hw, -hh, d}, {hw, hh, d}},
            new float[]{0, 0, 1, 1}, new float[]{0, 1, 1, 0}, m, frontTex, light);
        geo.face(mesh, new double[][]{{hw, hh, -d}, {hw, -hh, -d}, {-hw, -hh, -d}, {-hw, hh, -d}},
            new float[]{0, 0, 1, 1}, new float[]{0, 1, 1, 0}, m, backTex, light);
        geo.face(mesh, new double[][]{{-hw, hh, -d}, {-hw, hh, d}, {hw, hh, d}, {hw, hh, -d}},
            new float[]{0, 0, 1, 1}, new float[]{0, 1f / 16f, 1f / 16f, 0}, m, backTex, light);
        geo.face(mesh, new double[][]{{-hw, -hh, d}, {-hw, -hh, -d}, {hw, -hh, -d}, {hw, -hh, d}},
            new float[]{0, 0, 1, 1}, new float[]{0, 1f / 16f, 1f / 16f, 0}, m, backTex, light);
        geo.face(mesh, new double[][]{{-hw, hh, -d}, {-hw, -hh, -d}, {-hw, -hh, d}, {-hw, hh, d}},
            new float[]{0, 0, 1f / 16f, 1f / 16f}, new float[]{0, 1, 1, 0}, m, backTex, light);
        geo.face(mesh, new double[][]{{hw, hh, d}, {hw, -hh, d}, {hw, -hh, -d}, {hw, hh, -d}},
            new float[]{0, 0, 1f / 16f, 1f / 16f}, new float[]{0, 1, 1, 0}, m, backTex, light);
    }

    private static void endCrystal(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, double x, double y, double z, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/end_crystal/end_crystal");
        boolean showBottom = entity.data().getBooleanOrDefault("ShowBottom", false);
        if (showBottom) {
            Mat base = Mat.identity().translate(x, y, z).scale(1, -1, 1);
            var ped = new Part();
            ped.box(0, 16, -6, -4, -6, 12, 4, 12);
            geo.parts(mesh, ped, base, tex, 64, 32, light);
        }
        float[] full = {1f, 1f, 1f};
        Mat center = Mat.identity().translate(x, y + 1.15, z).scale(0.875, 0.875, 0.875);
        var glass = new Part();
        glass.box(0, 0, -4, -4, -4, 8, 8, 8);
        Mat outer = center.rotateY(Math.toRadians(35)).rotateX(Math.toRadians(60)).rotateZ(Math.toRadians(60));
        geo.parts(mesh, glass, outer, tex, 64, 32, full);
        Mat inner = outer.scale(0.875, 0.875, 0.875).rotateY(Math.toRadians(45)).rotateX(Math.toRadians(60));
        geo.parts(mesh, glass, inner, tex, 64, 32, full);
        var core = new Part();
        core.box(32, 0, -4, -4, -4, 8, 8, 8);
        Mat coreMat = inner.scale(0.875, 0.875, 0.875).rotateY(Math.toRadians(45)).rotateX(Math.toRadians(60));
        geo.parts(mesh, core, coreMat, tex, 64, 32, full);
    }

    private static void leashKnot(EntityGeometry geo, SceneMesh mesh, double x, double y, double z, float[] light) {
        String tex = geo.ensureTexture("minecraft:entity/lead_knot/lead_knot");
        var root = new Part();
        root.box(0, 0, -3, -8, -3, 6, 8, 6);
        Mat world = Mat.identity().translate(x, y + 0.375, z).scale(-1, -1, 1);
        geo.parts(mesh, root, world, tex, 32, 32, light);
    }

    private static Mat parseDisplayTransform(NbtCompound tag) {
        var el = tag.get("transformation").orElse(null);
        if (el instanceof NbtList list && list.size() >= 16) {
            double[] vals = new double[16];
            for (int i = 0; i < 16; i++) vals[i] = SchematicEntity.number(list.get(i), i % 5 == 0 ? 1.0 : 0.0);
            return new Mat(vals);
        }
        if (el instanceof NbtCompound c) {
            double[] t = nbtVec3(c.get("translation").orElse(null), 0);
            double[] s = nbtVec3(c.get("scale").orElse(null), 1);
            Mat m = Mat.identity().translate(t[0], t[1], t[2]);
            m = applyNbtRotation(m, c.get("left_rotation").orElse(null));
            m = m.scale(s[0], s[1], s[2]);
            m = applyNbtRotation(m, c.get("right_rotation").orElse(null));
            return m;
        }
        return Mat.identity();
    }

    private static double[] nbtVec3(NbtElement el, double def) {
        double[] out = {def, def, def};
        if (el instanceof NbtList list) {
            for (int i = 0; i < Math.min(3, list.size()); i++) out[i] = SchematicEntity.number(list.get(i), def);
        }
        return out;
    }

    private static Mat applyNbtRotation(Mat m, NbtElement el) {
        if (el instanceof NbtList list && list.size() >= 4) {
            double x = SchematicEntity.number(list.get(0), 0), y = SchematicEntity.number(list.get(1), 0);
            double z = SchematicEntity.number(list.get(2), 0), w = SchematicEntity.number(list.get(3), 1);
            double len = Math.sqrt(x * x + y * y + z * z + w * w);
            if (len < 1e-9) return m;
            x /= len; y /= len; z /= len; w /= len;
            return m.mul(new Mat(new double[]{
                1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
                2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
                2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
                0, 0, 0, 1
            }));
        }
        if (el instanceof NbtCompound c) {
            double angle = SchematicEntity.number(c, "angle", 0);
            double[] ax = nbtVec3(c.get("axis").orElse(null), 0);
            double len = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]);
            if (len < 1e-9) return m;
            double ux = ax[0] / len, uy = ax[1] / len, uz = ax[2] / len;
            double half = angle * 0.5, s = Math.sin(half), w = Math.cos(half);
            double qx = ux * s, qy = uy * s, qz = uz * s;
            return m.mul(new Mat(new double[]{
                1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * w), 2 * (qx * qz + qy * w), 0,
                2 * (qx * qy + qz * w), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * w), 0,
                2 * (qx * qz - qy * w), 2 * (qy * qz + qx * w), 1 - 2 * (qx * qx + qy * qy), 0,
                0, 0, 0, 1
            }));
        }
        return m;
    }

    private static float[] displayLight(NbtCompound tag, float[] fallback) {
        var b = tag.getCompound("brightness").orElse(null);
        if (b == null) return fallback;
        int sky = Math.max(0, Math.min(15, (int) SchematicEntity.number(b, "sky", 15)));
        int blk = Math.max(0, Math.min(15, (int) SchematicEntity.number(b, "block", 0)));
        float[] out = new float[3];
        LightVolume.brightness((sky << 8) | blk, out);
        return out;
    }

    private static void display(EntityGeometry geo, SceneMesh mesh, SchematicEntity entity, String id,
                                double x, double y, double z, float[] light) {
        NbtCompound tag = entity.data();
        float[] rgb = displayLight(tag, light);
        Mat local = parseDisplayTransform(tag);
        Mat world = Mat.identity().translate(x, y, z)
            .rotateY(Math.toRadians(-entity.yaw())).rotateX(Math.toRadians(entity.pitch()))
            .mul(local);
        switch (id) {
            case "block_display" -> {
                var bsTag = tag.getCompound("block_state").orElse(null);
                if (bsTag == null) return;
                var raw = LitematicaSchematic.readBlockState(bsTag);
                BlockState state = geo.resolveBlockState(raw.blockId(), raw.properties());
                if (!state.isAir()) geo.emitMovingBlock(mesh, state, world, rgb);
            }
            case "item_display" -> {
                var stack = tag.getCompound("item").orElse(null);
                if (empty(stack)) return;
                String ctx = tag.getStringOrDefault("item_display", "fixed");
                if (ctx.equals("none") || ctx.isEmpty()) ctx = "fixed";
                geo.item(mesh, stack, world.rotateY(Math.PI), ctx, rgb);
            }
            case "text_display" -> {
                var textEl = tag.get("text").orElse(null);
                if (textEl == null) return;
                FontRenderer font = geo.baker().fontRenderer();
                var styled = BlockEntityData.parseStyledNbt(textEl, font.translations());
                int lineWidth = (int) SchematicEntity.number(tag, "line_width", 200);
                boolean defaultBg = tag.getBooleanOrDefault("default_background", false);
                int bg = defaultBg ? 0x40000000 : (int) SchematicEntity.number(tag, "background", 0x40000000);
                int opacity = ((int) SchematicEntity.number(tag, "text_opacity", -1)) & 0xFF;
                boolean shadow = tag.getBooleanOrDefault("shadow", false);
                String alignment = tag.getStringOrDefault("alignment", "center");
                var panel = font.textDisplayPanel(List.of(styled), lineWidth, bg, opacity, shadow, alignment);
                Image img = panel.image();
                geo.generated().put(panel.spriteId(), img);
                double scale = 0.0125; // 原版 1/40 格每逻辑像素，面板为 2× 采样
                double hw = img.width * scale * 0.5, h = img.height * scale;
                SceneMesh.Layer prev = geo.currentLayer();
                boolean translucent = Image.alpha(bg) > 0 && Image.alpha(bg) < 255 || (opacity > 0 && opacity < 255);
                geo.setLayer(translucent ? SceneMesh.Layer.TRANSLUCENT : SceneMesh.Layer.CUTOUT);
                try {
                    geo.face(mesh, new double[][]{{-hw, h, 0}, {-hw, 0, 0}, {hw, 0, 0}, {hw, h, 0}},
                        new float[]{0, 0, 1, 1}, new float[]{0, 1, 1, 0}, world, panel.spriteId(), rgb);
                    geo.face(mesh, new double[][]{{hw, h, 0}, {hw, 0, 0}, {-hw, 0, 0}, {-hw, h, 0}},
                        new float[]{1, 1, 0, 0}, new float[]{0, 1, 1, 0}, world, panel.spriteId(), rgb);
                } finally {
                    geo.setLayer(prev);
                }
            }
            default -> { }
        }
    }
}
