package io.github.litematicrender.world;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 不可变方块状态：方块标识及各属性值索引，遵循原版状态语义。 */
public final class BlockState {
    public final String blockId;
    public final BlockProperty[] properties;
    public final int[] propertyValues;

    private static final BlockState AIR = new BlockState("minecraft:air", new BlockProperty[0], new int[0]);

    public BlockState(String blockId, BlockProperty[] properties, int[] propertyValues) {
        this.blockId = blockId;
        this.properties = properties;
        this.propertyValues = propertyValues;
    }

    public static BlockState air() { return AIR; }

    public boolean isAir() {
        return this.blockId.equals("minecraft:air")
            || this.blockId.equals("minecraft:cave_air")
            || this.blockId.equals("minecraft:void_air");
    }


    public String getValue(String propertyName) {
        for (int i = 0; i < this.properties.length; i++) {
            if (this.properties[i].name().equals(propertyName)) {
                return this.properties[i].valueName(this.propertyValues[i]);
            }
        }
        return null;
    }

    /** 替换单个属性得到新状态；未知属性或值抛出异常。 */
    public BlockState with(String propertyName, String value) {
        for (int i = 0; i < this.properties.length; i++) {
            if (this.properties[i].name().equals(propertyName)) {
                Integer idx = this.properties[i].indexOf(value).orElseThrow(
                    () -> new IllegalArgumentException("Invalid value " + value + " for property " + propertyName + " on " + this.blockId));
                int[] newValues = this.propertyValues.clone();
                newValues[i] = idx;
                return new BlockState(this.blockId, this.properties, newValues);
            }
        }
        throw new IllegalArgumentException("Unknown property " + propertyName + " on " + this.blockId);
    }

    /** 宽松替换忽略未知属性和值，供数据驱动的方向修正使用。 */
    public BlockState tryWith(String propertyName, String value) {
        try {
            return this.with(propertyName, value);
        } catch (IllegalArgumentException e) {
            return this;
        }
    }


    public String propertyString() {
        if (this.properties.length == 0) return "";
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < this.properties.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(this.properties[i].name()).append('=').append(this.properties[i].valueName(this.propertyValues[i]));
        }
        return sb.append(']').toString();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof BlockState other)) return false;
        if (!this.blockId.equals(other.blockId)) return false;
        if (this.properties.length != other.properties.length) return false;
        for (int i = 0; i < this.properties.length; i++) {
            if (!this.properties[i].name().equals(other.properties[i].name())) return false;
            if (this.propertyValues[i] != other.propertyValues[i]) return false;
        }
        return true;
    }

    @Override
    public int hashCode() {
        int h = this.blockId.hashCode();
        for (int v : this.propertyValues) h = 31 * h + v;
        return h;
    }

    @Override
    public String toString() {
        return this.blockId + this.propertyString();
    }
}
