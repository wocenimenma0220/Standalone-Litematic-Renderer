package io.github.litematicrender.schematic;

import java.util.Map;

/** 注册表解析前，按文件原样保存的调色板条目。 */
public record UnresolvedBlockState(String blockId, Map<String, String> properties) {

    public UnresolvedBlockState {
        properties = properties == null ? Map.of() : Map.copyOf(properties);
    }
}
