package io.github.litematicrender.world;

import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.util.MiniJson;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** 从资源的 blockstates 定义推导属性表，补充外观所需但 JSON 未声明的原版属性。 */
public final class BlockRegistry {
    public static final class BlockInfo {
        public final String id;
        public final LinkedHashMap<String, BlockProperty> properties = new LinkedHashMap<>();
        public final BlockState defaultState;

        public final Map<String, Object> definition;

        BlockInfo(String id, LinkedHashMap<String, BlockProperty> properties, Map<String, Object> definition) {
            this.id = id;
            this.properties.putAll(properties);
            this.definition = definition;
            BlockProperty[] props = properties.values().toArray(BlockProperty[]::new);
            int[] defaults = new int[props.length];
            for (int i = 0; i < props.length; i++) defaults[i] = 0;
            this.defaultState = new BlockState(id, props, defaults);
        }

        public BlockState state(Map<String, String> values) {
            BlockState state = this.defaultState;
            for (Map.Entry<String, String> e : values.entrySet()) {
                state = state.tryWith(e.getKey(), e.getValue());
            }
            return state;
        }
    }

    private final Map<String, BlockInfo> blocks = new HashMap<>();
    private final ResourceManager resources;

    private BlockRegistry(ResourceManager resources) {
        this.resources = resources;
    }

    public static BlockRegistry load(ResourceManager resources) {
        BlockRegistry registry = new BlockRegistry(resources);

        for (String[] pair : resources.listResources("blockstates", ".json")) {
            String ns = pair[0];
            String rel = pair[1];

            String name = rel.substring("blockstates/".length(), rel.length() - 5);
            String blockId = ns + ":" + name;
            try {
                byte[] data = resources.getResource(ns, rel).orElse(null);
                if (data == null) continue;
                Map<String, Object> json = MiniJson.parseObject(new String(data, java.nio.charset.StandardCharsets.UTF_8));
                registry.blocks.putIfAbsent(blockId, registry.build(blockId, json));
            } catch (Exception e) {
                System.err.println("[BlockRegistry] failed to load " + blockId + ": " + e);
            }
        }
        return registry;
    }

    private BlockInfo build(String blockId, Map<String, Object> json) {
        LinkedHashMap<String, BlockProperty> props = new LinkedHashMap<>();
        Map<String, LinkedHashSetSet> propValues = new LinkedHashMap<>();

        List<Map<String, Object>> variantMaps = new ArrayList<>();
        Map<String, Object> variants = MiniJson.asObject(json.get("variants"));
        if (variants != null) {
            for (Map.Entry<String, Object> e : variants.entrySet()) {

                addKeyToProps(propValues, e.getKey());
            }
        }
        List<Object> multipart = MiniJson.asArray(json.get("multipart"));
        if (multipart != null) {
            for (Object mpObj : multipart) {
                Map<String, Object> mp = MiniJson.asObject(mpObj);
                if (mp == null) continue;
                Map<String, Object> when = MiniJson.asObject(mp.get("when"));
                if (when != null) {
                    collectConditionProps(propValues, when);
                }
            }
        }

        // multipart 通常只声明已连接状态，需要补齐未连接值，避免静默回退。

        for (var entry : propValues.entrySet()) {
            var domain = entry.getValue();
            if (domain.values.contains("true") || domain.values.contains("false")) {
                domain.add("false"); domain.add("true");
            }
            if (List.of("north", "south", "east", "west").contains(entry.getKey())
                && (domain.values.contains("low") || domain.values.contains("tall")
                    || domain.values.contains("side") || domain.values.contains("up"))) domain.add("none");
        }

        // 补充影响外观但未出现在模型条件中的属性，例如红石粉的 power。


        List<String> extra = EXTRA_TINT_PROPERTIES.get(blockId);
        if (extra != null) {
            for (String name : extra) {
                if (!propValues.containsKey(name)) {
                    propValues.put(name, valuesFor(EXTRA_TINT_VALUES.get(name)));
                }
            }
        }
        // 空模型方块也必须保留真实属性，避免箱子等状态被丢弃。

        if (MODELLESS_BLOCKS.contains(blockId)) {
            for (Map.Entry<String, List<String>> e : MODELLESS_PROPERTIES.entrySet()) {
                if (!propValues.containsKey(e.getKey())) {
                    propValues.put(e.getKey(), valuesFor(e.getValue()));
                }
            }
        }
        if (HEADED_BLOCKS.contains(blockId)) {
            for (Map.Entry<String, List<String>> e : HEADED_PROPERTIES.entrySet()) {
                if (!propValues.containsKey(e.getKey())) {
                    propValues.put(e.getKey(), valuesFor(e.getValue()));
                }
            }
        }

        if (blockId.equals("minecraft:decorated_pot")) {
            propValues.putIfAbsent("facing", valuesFor(List.of("north","east","south","west")));
            propValues.putIfAbsent("cracked", valuesFor(List.of("false","true")));
        }
        if (blockId.equals("minecraft:lectern"))propValues.putIfAbsent("has_book",valuesFor(List.of("false","true")));
        if (isCopperGolemStatue(blockId)) {
            propValues.putIfAbsent("facing", valuesFor(List.of("north","east","south","west")));
            propValues.putIfAbsent("copper_golem_pose", valuesFor(List.of("standing","sitting","running","star")));
        }
        if (blockId.endsWith("_wall_banner"))propValues.putIfAbsent("facing",valuesFor(List.of("north","east","south","west")));
        else if(blockId.endsWith("_banner"))propValues.putIfAbsent("rotation",valuesFor(java.util.stream.IntStream.range(0,16).mapToObj(Integer::toString).toList()));
        if ((blockId.endsWith("_wall_head") || blockId.endsWith("_wall_skull")) && !propValues.containsKey("facing")) {
            propValues.put("facing", valuesFor(List.of("north", "south", "east", "west")));
        }
        // 流体的 level 和 falling 不在模型条件中，需显式保留以显示流动高度。

        if (FLUID_BLOCKS.contains(blockId)) {
            for (Map.Entry<String, List<String>> e : FLUID_PROPERTIES.entrySet()) {
                if (!propValues.containsKey(e.getKey())) {
                    propValues.put(e.getKey(), valuesFor(e.getValue()));
                }
            }
        }
        // 含水状态不改变实体模型，但决定独立流体层，必须保留 waterlogged。


        if (!propValues.containsKey("waterlogged")) {
            propValues.put("waterlogged", valuesFor(List.of("false", "true")));
        }

        for (Map.Entry<String, LinkedHashSetSet> e : propValues.entrySet()) {
            // 属性值采用稳定顺序：布尔值、升序数字和稳定枚举顺序。
            List<String> values = new ArrayList<>(e.getValue().values);
            values.sort(BlockRegistry::compareValues);
            props.put(e.getKey(), new BlockProperty(e.getKey(), values));
        }

        return new BlockInfo(blockId, props, json);
    }

    private static LinkedHashSetSet valuesFor(List<String> values) {
        LinkedHashSetSet set = new LinkedHashSetSet();
        for (String v : values) set.add(v);
        return set;
    }

    /** 按方块类型补充原版染色依赖的额外属性。 */
    private static final Map<String, List<String>> EXTRA_TINT_PROPERTIES = Map.of(
        "minecraft:redstone_wire", List.of("power"),
        "minecraft:melon_stem", List.of("age"),
        "minecraft:pumpkin_stem", List.of("age")
    );


    private static final Map<String, List<String>> EXTRA_TINT_VALUES = Map.of(
        "power", List.of("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"),
        "age", List.of("0", "1", "2", "3", "4", "5", "6", "7")
    );

    /** 流体由专用渲染器绘制，因此空 blockstate JSON 之外仍需补齐流体属性。 */
    private static final Map<String, List<String>> FLUID_PROPERTIES = Map.of(
        "level", List.of("0", "1", "2", "3", "4", "5", "6", "7", "8"),
        "falling", List.of("false", "true")
    );


    private static final java.util.Set<String> FLUID_BLOCKS = java.util.Set.of(
        "minecraft:water", "minecraft:lava", "minecraft:bubble_column"
    );

    /** 为箱子等无实体模型条件的方块补齐其状态属性。 */
    private static final Map<String, List<String>> MODELLESS_PROPERTIES = Map.of(
        "facing", List.of("north", "south", "west", "east"),
        "type", List.of("single", "left", "right"),
        "waterlogged", List.of("false", "true")
    );


    private static final java.util.Set<String> MODELLESS_BLOCKS = java.util.Set.of(
        "minecraft:chest", "minecraft:trapped_chest", "minecraft:ender_chest"
    );

    private static final java.util.Set<String> COPPER_GOLEM_STATUES = java.util.Set.of(
        "minecraft:copper_golem_statue", "minecraft:exposed_copper_golem_statue",
        "minecraft:weathered_copper_golem_statue", "minecraft:oxidized_copper_golem_statue",
        "minecraft:waxed_copper_golem_statue", "minecraft:waxed_exposed_copper_golem_statue",
        "minecraft:waxed_weathered_copper_golem_statue", "minecraft:waxed_oxidized_copper_golem_statue"
    );

    public static boolean isCopperGolemStatue(String blockId) { return COPPER_GOLEM_STATUES.contains(blockId); }

    /** 头颅的实际朝向由方块实体渲染读取，需保留模型 JSON 未使用的属性。 */
    private static final Map<String, List<String>> HEADED_PROPERTIES = Map.of(
        "rotation", List.of("0", "1", "2", "3", "4", "5", "6", "7",
                            "8", "9", "10", "11", "12", "13", "14", "15")
    );


    private static final java.util.Set<String> HEADED_BLOCKS = java.util.Set.of(
        "minecraft:skeleton_skull", "minecraft:wither_skeleton_skull",
        "minecraft:player_head", "minecraft:zombie_head", "minecraft:creeper_head",
        "minecraft:piglin_head", "minecraft:dragon_head"
    );


    public static boolean isHead(String blockId) {
        return (blockId.endsWith("_head")||blockId.endsWith("_skull"))
            && HEADED_BLOCKS.contains(blockId.replace("_wall_", "_"));
    }

    @SuppressWarnings("unchecked")
    private static void collectConditionProps(Map<String, LinkedHashSetSet> props, Map<String, Object> when) {
        for (Map.Entry<String, Object> e : when.entrySet()) {
            if (e.getKey().equals("OR") || e.getKey().equals("AND")) {
                List<Object> sub = MiniJson.asArray(e.getValue());
                if (sub != null) {
                    for (Object o : sub) {
                        Map<String, Object> m = MiniJson.asObject(o);
                        if (m != null) collectConditionProps(props, m);
                    }
                }
                continue;
            }
            addValueToProps(props, e.getKey(), MiniJson.asString(e.getValue(), "true"));
        }
    }

    private static void addKeyToProps(Map<String, LinkedHashSetSet> props, String key) {
        if (key.isEmpty()) return;
        for (String part : key.split(",")) {
            int eq = part.indexOf('=');
            if (eq <= 0) continue;
            addValueToProps(props, part.substring(0, eq).trim(), part.substring(eq + 1).trim());
        }
    }

    private static void addValueToProps(Map<String, LinkedHashSetSet> props, String name, String value) {
        if (value.isEmpty()) return;

        for (String v : value.split("\\|")) {
            if (v.isEmpty()) continue;
            props.computeIfAbsent(name, k -> new LinkedHashSetSet()).add(v);
        }
    }


    private static int compareValues(String a, String b) {
        Boolean ab = parseBool(a), bb = parseBool(b);
        if (ab != null && bb != null) return Boolean.compare(ab, bb);
        if (ab != null) return 1;
        if (bb != null) return -1;
        Double ad = parseNum(a), bd = parseNum(b);
        if (ad != null && bd != null) return Double.compare(ad, bd);
        return a.compareTo(b);
    }

    private static Boolean parseBool(String s) {
        if (s.equals("true")) return Boolean.TRUE;
        if (s.equals("false")) return Boolean.FALSE;
        return null;
    }

    private static Double parseNum(String s) {
        try {
            if (s.matches("-?\\d+(\\.\\d+)?")) return Double.parseDouble(s);
        } catch (NumberFormatException ignored) {}
        return null;
    }


    private static final class LinkedHashSetSet {
        final java.util.LinkedHashSet<String> values = new java.util.LinkedHashSet<>();
        void add(String v) { this.values.add(v); }
    }

    public BlockInfo get(String blockId) {
        BlockInfo info = this.blocks.get(blockId);
        if (info != null) return info;
        // 旧版方块重命名先映射到当前标识，再查询真实属性表。

        String current = LEGACY_RENAMES.get(blockId);
        return current == null ? null : this.blocks.get(current);
    }


    private static final Map<String, String> LEGACY_RENAMES = Map.of(
        "minecraft:chain", "minecraft:iron_chain"
    );

    public BlockInfo getOrMissing(String blockId) {


        BlockInfo info = this.get(blockId);
        if (info != null) return info;
        // 缺失方块使用占位信息，后续显示粉黑缺失纹理。
        return this.blocks.computeIfAbsent(blockId, id -> new BlockInfo(id, new LinkedHashMap<>(), new HashMap<>()));
    }

    public boolean has(String blockId) {
        return this.blocks.containsKey(blockId);
    }

    public int blockCount() {
        return this.blocks.size();
    }


    public java.util.Set<String> blockIds() {
        return java.util.Collections.unmodifiableSet(this.blocks.keySet());
    }


    public BlockState parseState(String fullId) {
        String blockId = fullId;
        Map<String, String> propValues = new LinkedHashMap<>();
        int bracket = fullId.indexOf('[');
        if (bracket >= 0) {
            blockId = fullId.substring(0, bracket);
            String props = fullId.substring(bracket + 1, fullId.endsWith("]") ? fullId.length() - 1 : fullId.length());
            for (String part : props.split(",")) {
                int eq = part.indexOf('=');
                if (eq > 0) propValues.put(part.substring(0, eq).trim(), part.substring(eq + 1).trim());
            }
        }
        int colon = blockId.indexOf(':');
        if (colon < 0) blockId = "minecraft:" + blockId;
        return this.getOrMissing(blockId).state(propValues);
    }

    public Optional<BlockInfo> lookup(String blockId) {
        return Optional.ofNullable(this.blocks.get(blockId));
    }
}
