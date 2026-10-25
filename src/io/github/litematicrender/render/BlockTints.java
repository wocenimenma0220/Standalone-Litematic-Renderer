package io.github.litematicrender.render;

import io.github.litematicrender.world.BlockState;

/** 按原版 BlockColors 和 BlockTintSources 计算方块染色；染色来源由 tintindex 决定，不能根据纹理名称猜测。 */
public final class BlockTints {
    /** 原版云杉树叶固定颜色：0xFF61A261。 */
    public static final int SPRUCE = (-10380959) & 0xFFFFFF;
    /** 原版白桦树叶固定颜色：0xFF80A755。 */
    public static final int BIRCH = (-8345771) & 0xFFFFFF;
    /** 原版已连接作物茎的固定颜色。 */
    public static final int ATTACHED_STEM = (-2046180) & 0xFFFFFF;
    /** 原版睡莲默认颜色。 */
    public static final int LILY_PAD_DEFAULT = (-9321636) & 0xFFFFFF;
    /** 原版睡莲在世界中的颜色。 */
    public static final int LILY_PAD_IN_WORLD = (-14647248) & 0xFFFFFF;

    /** 红石粉的 16 级颜色梯度，按原版信号强度公式从暗红渐变为亮红。 */
    private static final int[] REDSTONE_COLORS = buildRedstoneColors();

    private static int[] buildRedstoneColors() {
        int[] out = new int[16];
        for (int i = 0; i <= 15; i++) {
            float power = i / 15.0f;
            float red = power * 0.6f + (power > 0f ? 0.4f : 0.3f);
            float green = Math.max(0f, Math.min(1f, power * power * 0.7f - 0.5f));
            float blue = Math.max(0f, Math.min(1f, power * power * 0.6f - 0.7f));
            out[i] = (Math.round(red * 255f) << 16) | (Math.round(green * 255f) << 8) | Math.round(blue * 255f);
        }
        return out;
    }

    private BlockTints() {}

    /** 返回面片的染色值；没有注册染色来源时返回 -1。 */
    public static int colorFor(BlockState state, String spriteId, int layer) {
        if (layer < 0) return -1;
        String id = state.blockId;


        if (id.equals("minecraft:redstone_wire")) {
            return redstoneColor(state);
        }


        if (id.equals("minecraft:grass_block")) {
            // 草方块只染顶面，侧面保持原色。
            return layer == 0 && spriteId != null && spriteId.contains("grass_block_top")
                ? Colormaps.GRASS_DEFAULT : -1;
        }
        if (id.equals("minecraft:short_grass") || id.equals("minecraft:tall_grass")
            || id.equals("minecraft:fern") || id.equals("minecraft:large_fern")
            || id.equals("minecraft:potted_fern") || id.equals("minecraft:bush")) {
            return Colormaps.GRASS_DEFAULT;
        }
        if (id.equals("minecraft:pink_petals") || id.equals("minecraft:wildflowers")) {
            return layer == 1 ? Colormaps.GRASS_DEFAULT : -1;
        }


        if (id.endsWith("_leaves")) {
            return switch (id) {
                case "minecraft:spruce_leaves" -> SPRUCE;
                case "minecraft:birch_leaves" -> BIRCH;
                case "minecraft:oak_leaves", "minecraft:jungle_leaves", "minecraft:acacia_leaves",
                     "minecraft:dark_oak_leaves", "minecraft:mangrove_leaves" -> Colormaps.FOLIAGE_DEFAULT;
                default -> -1;                                     // 樱花、杜鹃和苍白橡树树叶不染色。
            };
        }
        if (id.equals("minecraft:vine") || id.equals("minecraft:leaf_litter")) {
            return Colormaps.FOLIAGE_DEFAULT;
        }
        if (id.equals("minecraft:sugar_cane")) {
            return Colormaps.GRASS_DEFAULT;
        }


        if (id.equals("minecraft:water") || id.equals("minecraft:bubble_column")
            || id.equals("minecraft:water_cauldron")) {
            return Colormaps.WATER_DEFAULT;
        }


        if (id.equals("minecraft:melon_stem") || id.equals("minecraft:pumpkin_stem")) {
            return stemColor(state);
        }
        if (id.equals("minecraft:attached_melon_stem") || id.equals("minecraft:attached_pumpkin_stem")) {
            return ATTACHED_STEM;
        }
        if (id.equals("minecraft:lily_pad")) {
            return layer == 1 ? LILY_PAD_IN_WORLD : LILY_PAD_DEFAULT;
        }

        // 未注册染色来源的模型保留原色，与原版 BLANK_LAYER 一致。

        return -1;
    }

    /** 原版红石粉按信号强度计算颜色。 */
    public static int redstoneColor(BlockState state) {
        String p = state.getValue("power");
        int power = 0;
        if (p != null) {
            try {
                power = Math.max(0, Math.min(15, Integer.parseInt(p)));
            } catch (NumberFormatException ignored) {
                power = 0;
            }
        }
        return REDSTONE_COLORS[power];
    }

    /** 原版作物茎按生长阶段计算颜色。 */
    private static int stemColor(BlockState state) {
        String a = state.getValue("age");
        int age = 0;
        if (a != null) {
            try {
                age = Math.max(0, Math.min(15, Integer.parseInt(a)));
            } catch (NumberFormatException ignored) {
                age = 0;
            }
        }
        int r = Math.min(255, age * 32);
        int g = Math.max(0, 255 - age * 8);
        int b = Math.min(255, age * 4);
        return (r << 16) | (g << 8) | b;
    }
}
