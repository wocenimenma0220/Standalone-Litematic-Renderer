package io.github.litematicrender.world;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** 方块属性以字符串值列表表示，状态保存对应值的索引。 */
public final class BlockProperty {
    private final String name;
    private final List<String> values;
    private final Map<String, Integer> indexByName;

    public BlockProperty(String name, List<String> values) {
        this.name = name;
        this.values = List.copyOf(values);
        Map<String, Integer> idx = new HashMap<>();
        for (int i = 0; i < this.values.size(); i++) idx.put(this.values.get(i), i);
        this.indexByName = Collections.unmodifiableMap(idx);
    }

    public String name() { return this.name; }
    public List<String> values() { return this.values; }
    public int valueCount() { return this.values.size(); }

    public Optional<Integer> indexOf(String value) {
        Integer i = this.indexByName.get(value);
        return i == null ? Optional.empty() : Optional.of(i);
    }

    public String valueName(int index) {
        return index >= 0 && index < this.values.size() ? this.values.get(index) : "";
    }

    @Override
    public String toString() {
        return this.name + "[" + String.join(",", this.values) + "]";
    }
}
