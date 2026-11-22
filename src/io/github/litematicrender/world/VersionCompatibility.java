package io.github.litematicrender.world;

import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.schematic.UnresolvedBlockState;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 跨版本方块差异检测与双向映射（例如 1.21.9 铁链、1.20.3 矮草、1.17 草径/含水炼药锅、1.16 墙体属性、1.14 告示牌与 1.13 扁平化）。 */
public final class VersionCompatibility {
    public static final int ENGINE_DATA_VERSION = 5023;
    public static final String ENGINE_VERSION_LABEL = "26.3";
    public static final String ACTION_REMAP = "remap";
    public static final String ACTION_LEGACY = "legacy";

    public record DataVersionEntry(int dataVersion, String label) {}

    public static final List<DataVersionEntry> MC_DATA_VERSIONS = List.of(
        new DataVersionEntry(5023, "26.3"),
        new DataVersionEntry(4790, "26.1.2"),
        new DataVersionEntry(4786, "26.1.1"),
        new DataVersionEntry(4780, "26.1"),
        new DataVersionEntry(4690, "26.0"),
        new DataVersionEntry(4671, "1.21.11"),
        new DataVersionEntry(4556, "1.21.10"),
        new DataVersionEntry(4554, "1.21.9"),
        new DataVersionEntry(4440, "1.21.8"),
        new DataVersionEntry(4435, "1.21.6"),
        new DataVersionEntry(4325, "1.21.5"),
        new DataVersionEntry(4189, "1.21.4"),
        new DataVersionEntry(4082, "1.21.3"),
        new DataVersionEntry(4080, "1.21.2"),
        new DataVersionEntry(3955, "1.21.1"),
        new DataVersionEntry(3953, "1.21"),
        new DataVersionEntry(3839, "1.20.6"),
        new DataVersionEntry(3700, "1.20.4"),
        new DataVersionEntry(3698, "1.20.3"),
        new DataVersionEntry(3578, "1.20.2"),
        new DataVersionEntry(3465, "1.20.1"),
        new DataVersionEntry(3337, "1.19.4"),
        new DataVersionEntry(3120, "1.19.2"),
        new DataVersionEntry(2975, "1.19"),
        new DataVersionEntry(2865, "1.18.2"),
        new DataVersionEntry(2730, "1.17.1"),
        new DataVersionEntry(2724, "1.17"),
        new DataVersionEntry(2586, "1.16.5"),
        new DataVersionEntry(2566, "1.16"),
        new DataVersionEntry(2230, "1.15.2"),
        new DataVersionEntry(1976, "1.14.4"),
        new DataVersionEntry(1631, "1.13.2"),
        new DataVersionEntry(1343, "1.12.2")
    );

    /** 旧版方块标识到现代原版标识（26.3）的权威映射表。 */
    public static final Map<String, String> LEGACY_RENAMES = Map.ofEntries(
        Map.entry("minecraft:chain", "minecraft:iron_chain"),
        Map.entry("minecraft:grass", "minecraft:short_grass"),
        Map.entry("minecraft:grass_path", "minecraft:dirt_path"),
        Map.entry("minecraft:sign", "minecraft:oak_sign"),
        Map.entry("minecraft:wall_sign", "minecraft:oak_wall_sign"),
        Map.entry("minecraft:standing_sign", "minecraft:oak_sign"),
        Map.entry("minecraft:tallgrass", "minecraft:short_grass"),
        Map.entry("minecraft:deadbush", "minecraft:dead_bush"),
        Map.entry("minecraft:reeds", "minecraft:sugar_cane"),
        Map.entry("minecraft:waterlily", "minecraft:lily_pad"),
        Map.entry("minecraft:noteblock", "minecraft:note_block"),
        Map.entry("minecraft:golden_rail", "minecraft:powered_rail"),
        Map.entry("minecraft:yellow_flower", "minecraft:dandelion"),
        Map.entry("minecraft:red_flower", "minecraft:poppy"),
        Map.entry("minecraft:double_plant", "minecraft:sunflower"),
        Map.entry("minecraft:web", "minecraft:cobweb"),
        Map.entry("minecraft:magma", "minecraft:magma_block"),
        Map.entry("minecraft:red_nether_brick", "minecraft:red_nether_bricks"),
        Map.entry("minecraft:end_bricks", "minecraft:end_stone_bricks"),
        Map.entry("minecraft:brick_block", "minecraft:bricks"),
        Map.entry("minecraft:quartz_ore", "minecraft:nether_quartz_ore"),
        Map.entry("minecraft:hardened_clay", "minecraft:terracotta"),
        Map.entry("minecraft:stained_hardened_clay", "minecraft:white_terracotta"),
        Map.entry("minecraft:silver_glazed_terracotta", "minecraft:light_gray_glazed_terracotta"),
        Map.entry("minecraft:silver_shulker_box", "minecraft:light_gray_shulker_box"),
        Map.entry("minecraft:slime", "minecraft:slime_block"),
        Map.entry("minecraft:melon_block", "minecraft:melon"),
        Map.entry("minecraft:lit_pumpkin", "minecraft:jack_o_lantern"),
        Map.entry("minecraft:snow_layer", "minecraft:snow"),
        Map.entry("minecraft:mob_spawner", "minecraft:spawner"),
        Map.entry("minecraft:ender_portal", "minecraft:end_portal"),
        Map.entry("minecraft:portal", "minecraft:nether_portal"),
        Map.entry("minecraft:workbench", "minecraft:crafting_table"),
        Map.entry("minecraft:lit_furnace", "minecraft:furnace"),
        Map.entry("minecraft:unlit_redstone_torch", "minecraft:redstone_torch"),
        Map.entry("minecraft:unlit_redstone_wall_torch", "minecraft:redstone_wall_torch"),
        Map.entry("minecraft:lit_redstone_lamp", "minecraft:redstone_lamp"),
        Map.entry("minecraft:lit_redstone_ore", "minecraft:redstone_ore"),
        Map.entry("minecraft:powered_repeater", "minecraft:repeater"),
        Map.entry("minecraft:unpowered_repeater", "minecraft:repeater"),
        Map.entry("minecraft:powered_comparator", "minecraft:comparator"),
        Map.entry("minecraft:unpowered_comparator", "minecraft:comparator"),
        Map.entry("minecraft:daylight_detector_inverted", "minecraft:daylight_detector"),
        Map.entry("minecraft:piston_extension", "minecraft:moving_piston"),
        Map.entry("minecraft:flowing_water", "minecraft:water"),
        Map.entry("minecraft:flowing_lava", "minecraft:lava"),
        Map.entry("minecraft:standing_banner", "minecraft:white_banner"),
        Map.entry("minecraft:wall_banner", "minecraft:white_wall_banner"),
        Map.entry("minecraft:fence", "minecraft:oak_fence"),
        Map.entry("minecraft:fence_gate", "minecraft:oak_fence_gate"),
        Map.entry("minecraft:wooden_door", "minecraft:oak_door"),
        Map.entry("minecraft:trapdoor", "minecraft:oak_trapdoor"),
        Map.entry("minecraft:wooden_pressure_plate", "minecraft:oak_pressure_plate"),
        Map.entry("minecraft:wooden_button", "minecraft:oak_button"),
        Map.entry("minecraft:wooden_stairs", "minecraft:oak_stairs"),
        Map.entry("minecraft:wooden_slab", "minecraft:oak_slab"),
        Map.entry("minecraft:double_wooden_slab", "minecraft:oak_slab"),
        Map.entry("minecraft:double_stone_slab", "minecraft:smooth_stone_slab"),
        Map.entry("minecraft:double_stone_slab2", "minecraft:red_sandstone_slab"),
        Map.entry("minecraft:stone_slab2", "minecraft:red_sandstone_slab"),
        Map.entry("minecraft:purpur_double_slab", "minecraft:purpur_slab"),
        Map.entry("minecraft:bed", "minecraft:red_bed"),
        Map.entry("minecraft:skull", "minecraft:skeleton_skull"),
        Map.entry("minecraft:stonebrick", "minecraft:stone_bricks"),
        Map.entry("minecraft:nether_brick", "minecraft:nether_bricks"),
        Map.entry("minecraft:monster_egg", "minecraft:infested_stone"),
        Map.entry("minecraft:planks", "minecraft:oak_planks"),
        Map.entry("minecraft:sapling", "minecraft:oak_sapling"),
        Map.entry("minecraft:leaves", "minecraft:oak_leaves"),
        Map.entry("minecraft:leaves2", "minecraft:acacia_leaves"),
        Map.entry("minecraft:log", "minecraft:oak_log"),
        Map.entry("minecraft:log2", "minecraft:acacia_log"),
        Map.entry("minecraft:wool", "minecraft:white_wool"),
        Map.entry("minecraft:carpet", "minecraft:white_carpet"),
        Map.entry("minecraft:stained_glass", "minecraft:white_stained_glass"),
        Map.entry("minecraft:stained_glass_pane", "minecraft:white_stained_glass_pane"),
        Map.entry("minecraft:concrete", "minecraft:white_concrete"),
        Map.entry("minecraft:concrete_powder", "minecraft:white_concrete_powder")
    );

    private static final List<String> WALL_PROPS = List.of("north", "south", "east", "west");

    public record RuleSpec(
        String key,
        String title,
        String changedInVersion,
        int changedInDataVersion,
        String legacySample,
        String modernSample,
        String upgradeDesc,
        String downgradeDesc
    ) {}

    public static final List<RuleSpec> RULES = List.of(
        new RuleSpec(
            "chain",
            "铁链 (chain ↔ iron_chain)",
            "1.21.9",
            4554,
            "minecraft:chain",
            "minecraft:iron_chain",
            "Minecraft 1.21.9 起将旧版铁链 minecraft:chain 更名为 minecraft:iron_chain（与铜链 copper_chain 并列）。",
            "投影使用 1.21.9+ 的 minecraft:iron_chain，而当前关联 MC 版本使用旧版 ID minecraft:chain。"
        ),
        new RuleSpec(
            "grass",
            "矮草 (grass ↔ short_grass)",
            "1.20.3",
            3698,
            "minecraft:grass",
            "minecraft:short_grass",
            "Minecraft 1.20.3 起将旧版草 minecraft:grass（1.12 为 tallgrass）更名为 minecraft:short_grass。",
            "投影使用 1.20.3+ 的 minecraft:short_grass，而当前关联 MC 版本使用旧版 ID minecraft:grass。"
        ),
        new RuleSpec(
            "grass_path",
            "草径 / 土径 (grass_path ↔ dirt_path)",
            "1.17",
            2724,
            "minecraft:grass_path",
            "minecraft:dirt_path",
            "Minecraft 1.17 起将草径 minecraft:grass_path 更名为土径 minecraft:dirt_path。",
            "投影使用 1.17+ 的 minecraft:dirt_path，而当前关联 MC 版本使用旧版 ID minecraft:grass_path。"
        ),
        new RuleSpec(
            "sign",
            "旧版通用告示牌 (sign ↔ oak_sign)",
            "1.14",
            1976,
            "minecraft:sign",
            "minecraft:oak_sign",
            "Minecraft 1.14 起将旧版通用告示牌 sign / wall_sign 拆分为橡木告示牌 oak_sign / oak_wall_sign。",
            "投影使用 1.14+ 橡木告示牌 ID，而当前关联 MC 版本使用旧版通用告示牌 ID。"
        ),
        new RuleSpec(
            "water_cauldron",
            "含水炼药锅 (cauldron[level] ↔ water_cauldron)",
            "1.17",
            2724,
            "minecraft:cauldron",
            "minecraft:water_cauldron",
            "Minecraft 1.17 起将含水的炼药锅从 minecraft:cauldron 拆分为独立方块 minecraft:water_cauldron。",
            "投影使用 1.17+ 的 minecraft:water_cauldron，而当前关联 MC 版本使用旧版 minecraft:cauldron。"
        ),
        new RuleSpec(
            "wall_connections",
            "墙体连接属性 (true/false ↔ low/none)",
            "1.16",
            2566,
            "north=true/false",
            "north=low/none",
            "Minecraft 1.16 起将墙体连接属性值由布尔 true / false 升级为 low / tall / none。",
            ""
        ),
        new RuleSpec(
            "pre113",
            "1.13 扁平化前旧版方块",
            "1.13",
            1631,
            "旧版未扁平化方块 ID",
            "1.13+ 标准方块 ID",
            "Minecraft 1.13 扁平化重构了旧版方块 ID 与状态（如 lit_furnace、powered_repeater、fence、wool 等）。",
            ""
        )
    );

    private static final Map<String, RuleSpec> RULES_BY_KEY = indexRules();

    private static Map<String, RuleSpec> indexRules() {
        var map = new LinkedHashMap<String, RuleSpec>();
        for (RuleSpec r : RULES) map.put(r.key(), r);
        return Collections.unmodifiableMap(map);
    }

    /** 跨版本映射用户配置，控制全局策略、单条规则覆写以及联动 MC 目标版本。 */
    public static final class Config {
        public static final Config DEFAULT = new Config(ACTION_REMAP, Map.of(), 0, "", Set.of());

        public final String defaultAction;
        public final Map<String, String> ruleActions;
        public final int targetDataVersion;
        public final String targetVersionLabel;
        public final Set<String> targetBlockIds;

        public Config(String defaultAction, Map<String, String> ruleActions, int targetDataVersion,
                      String targetVersionLabel, Set<String> targetBlockIds) {
            this.defaultAction = ACTION_LEGACY.equals(defaultAction) ? ACTION_LEGACY : ACTION_REMAP;
            var cleanRules = new LinkedHashMap<String, String>();
            if (ruleActions != null) {
                for (var entry : ruleActions.entrySet()) {
                    if (RULES_BY_KEY.containsKey(entry.getKey())
                        && (ACTION_REMAP.equals(entry.getValue()) || ACTION_LEGACY.equals(entry.getValue()))) {
                        cleanRules.put(entry.getKey(), entry.getValue());
                    }
                }
            }
            this.ruleActions = Collections.unmodifiableMap(cleanRules);
            this.targetDataVersion = Math.max(0, targetDataVersion);
            this.targetVersionLabel = targetVersionLabel == null ? "" : targetVersionLabel.trim();
            if (targetBlockIds == null || targetBlockIds.isEmpty()) {
                this.targetBlockIds = Set.of();
            } else {
                var cleanBlocks = new HashSet<String>(targetBlockIds.size());
                for (String id : targetBlockIds) {
                    if (id != null && !id.isBlank()) cleanBlocks.add(id);
                }
                this.targetBlockIds = Collections.unmodifiableSet(cleanBlocks);
            }
        }

        public String actionFor(String ruleKey) {
            String explicit = this.ruleActions.get(ruleKey);
            return explicit != null ? explicit : this.defaultAction;
        }

        public int effectiveTargetDataVersion() {
            return this.targetDataVersion > 0 ? this.targetDataVersion : ENGINE_DATA_VERSION;
        }

        public String effectiveTargetLabel() {
            if (!this.targetVersionLabel.isEmpty()) return this.targetVersionLabel + " (已联动)";
            if (this.targetDataVersion > 0) return labelForDataVersion(this.targetDataVersion) + " (已联动)";
            return ENGINE_VERSION_LABEL + " (内置默认)";
        }

        public String fingerprint() {
            var keys = new ArrayList<>(this.ruleActions.keySet());
            Collections.sort(keys);
            var sb = new StringBuilder();
            sb.append(this.defaultAction).append('|').append(this.targetDataVersion).append('|');
            for (String k : keys) sb.append(k).append('=').append(this.ruleActions.get(k)).append(';');
            return sb.toString();
        }
    }

    public record Resolution(
        String effectiveId,
        String visualFallbackId,
        boolean adaptWallBoolean,
        boolean preserveLegacyProperties
    ) {}

    private VersionCompatibility() {}

    public static String labelForDataVersion(int dv) {
        if (dv <= 0) return "未知版本";
        for (DataVersionEntry e : MC_DATA_VERSIONS) {
            if (dv == e.dataVersion()) return e.label();
        }
        for (DataVersionEntry e : MC_DATA_VERSIONS) {
            if (dv > e.dataVersion()) return "Data v" + dv + " (约 " + e.label() + "+)";
        }
        return "Data v" + dv;
    }

    public static String ruleForLegacyBlock(UnresolvedBlockState raw) {
        String id = raw.blockId();
        return switch (id) {
            case "minecraft:chain" -> "chain";
            case "minecraft:grass", "minecraft:tallgrass" -> "grass";
            case "minecraft:grass_path" -> "grass_path";
            case "minecraft:sign", "minecraft:standing_sign", "minecraft:wall_sign" -> "sign";
            case "minecraft:cauldron" -> {
                String level = raw.properties().get("level");
                yield ("1".equals(level) || "2".equals(level) || "3".equals(level)) ? "water_cauldron" : null;
            }
            default -> {
                if (id.endsWith("_wall") && hasBooleanWallConnection(raw.properties())) yield "wall_connections";
                yield LEGACY_RENAMES.containsKey(id) ? "pre113" : null;
            }
        };
    }

    public static String ruleForModernBlock(String id) {
        return switch (id) {
            case "minecraft:iron_chain" -> "chain";
            case "minecraft:short_grass" -> "grass";
            case "minecraft:dirt_path" -> "grass_path";
            case "minecraft:oak_sign", "minecraft:oak_wall_sign" -> "sign";
            case "minecraft:water_cauldron" -> "water_cauldron";
            default -> null;
        };
    }

    private static boolean hasBooleanWallConnection(Map<String, String> props) {
        if (props == null || props.isEmpty()) return false;
        for (String dir : WALL_PROPS) {
            String val = props.get(dir);
            if ("true".equals(val) || "false".equals(val)) return true;
        }
        return false;
    }

    public static String canonicalBlockId(String id) {
        if (id == null) return null;
        if ("minecraft:cauldron".equals(id)) return "minecraft:cauldron";
        return LEGACY_RENAMES.getOrDefault(id, id);
    }

    public static String canonicalItemId(String id) {
        if (id == null) return null;
        return switch (id) {
            case "minecraft:chain" -> "minecraft:iron_chain";
            case "minecraft:grass", "minecraft:tallgrass" -> "minecraft:short_grass";
            case "minecraft:grass_path" -> "minecraft:dirt_path";
            case "minecraft:sign", "minecraft:standing_sign", "minecraft:wall_sign" -> "minecraft:oak_sign";
            default -> LEGACY_RENAMES.getOrDefault(id, id);
        };
    }

    /** 根据当前映射配置解析单条调色板方块，决定最终逻辑 ID、渲染替身 ID 与属性适配策略。 */
    public static Resolution resolve(UnresolvedBlockState raw, Config cfg) {
        Config config = cfg == null ? Config.DEFAULT : cfg;
        String rawId = raw.blockId();
        int targetDv = config.effectiveTargetDataVersion();

        String legacyRule = ruleForLegacyBlock(raw);
        if (legacyRule != null) {
            RuleSpec spec = RULES_BY_KEY.get(legacyRule);
            if ("wall_connections".equals(legacyRule)) {
                boolean remap = ACTION_REMAP.equals(config.actionFor(legacyRule)) && targetDv >= spec.changedInDataVersion();
                // 渲染几何始终需要识别 low/none 以保持墙体连接外观，但是否写回属性检查表由 preserveLegacyProperties 控制。
                return new Resolution(rawId, null, true, !remap);
            }
            String modernId = "water_cauldron".equals(legacyRule)
                ? "minecraft:water_cauldron"
                : LEGACY_RENAMES.getOrDefault(rawId, rawId);
            if (targetDv < spec.changedInDataVersion()) {
                // 关联的目标 MC 本身仍使用旧版 ID，保留原 ID，并在渲染层用 modernId 兜底模型。
                return new Resolution(rawId, modernId, false, false);
            }
            if (ACTION_REMAP.equals(config.actionFor(legacyRule))) {
                return new Resolution(modernId, null, false, false);
            }
            return new Resolution(rawId, modernId, false, true);
        }

        if (config.targetDataVersion > 0) {
            String modernRule = ruleForModernBlock(rawId);
            if (modernRule != null) {
                RuleSpec spec = RULES_BY_KEY.get(modernRule);
                if (config.targetDataVersion < spec.changedInDataVersion()) {
                    String downgraded = downgradeId(rawId);
                    if (ACTION_REMAP.equals(config.actionFor(modernRule))) {
                        return new Resolution(downgraded, rawId, false, false);
                    }
                    return new Resolution(rawId, null, false, false);
                }
            }
        }

        return new Resolution(rawId, null, false, false);
    }

    public static String downgradeId(String modernId) {
        return switch (modernId) {
            case "minecraft:iron_chain" -> "minecraft:chain";
            case "minecraft:short_grass" -> "minecraft:grass";
            case "minecraft:dirt_path" -> "minecraft:grass_path";
            case "minecraft:oak_sign" -> "minecraft:sign";
            case "minecraft:oak_wall_sign" -> "minecraft:wall_sign";
            case "minecraft:water_cauldron" -> "minecraft:cauldron";
            default -> modernId;
        };
    }

    /** 扫描已载入投影中的跨版本方块差异与目标版本不支持的高版本方块。 */
    public static Map<String, Object> analyze(LitematicaSchematic schematic, Config cfg, ResourceManager resources) {
        Config config = cfg == null ? Config.DEFAULT : cfg;
        int schemDv = schematic.minecraftDataVersion > 0
            ? schematic.minecraftDataVersion
            : schematic.metadata().minecraftDataVersion;
        int targetDv = config.effectiveTargetDataVersion();

        Map<String, Long> ruleCounts = new LinkedHashMap<>();
        Map<String, String> ruleDirections = new LinkedHashMap<>();
        Map<String, String> ruleFromIds = new LinkedHashMap<>();
        Map<String, String> ruleToIds = new LinkedHashMap<>();
        Map<String, Boolean> ruleHasLegacyPack = new LinkedHashMap<>();
        Map<String, Long> unsupportedCounts = new LinkedHashMap<>();

        for (var region : schematic.regions().values()) {
            if (region.blocks == null || region.storedPalette == null || region.storedPalette.isEmpty()) continue;
            long[] palCounts = new long[region.storedPalette.size()];
            long total = (long) region.blocks.sizeX * region.blocks.sizeY * region.blocks.sizeZ;
            for (long i = 0; i < total; i++) {
                int pid = LitematicaSchematic.getAt(region.blocks.storage, region.blocks.bits, i);
                if (pid >= 0 && pid < palCounts.length) palCounts[pid]++;
            }
            for (int pid = 0; pid < region.storedPalette.size(); pid++) {
                long count = palCounts[pid];
                if (count <= 0) continue;
                UnresolvedBlockState raw = region.storedPalette.get(pid);
                String rawId = raw.blockId();
                if ("minecraft:air".equals(rawId) || "minecraft:cave_air".equals(rawId) || "minecraft:void_air".equals(rawId)) {
                    continue;
                }
                String legacyRule = ruleForLegacyBlock(raw);
                if (legacyRule != null) {
                    RuleSpec spec = RULES_BY_KEY.get(legacyRule);
                    if (targetDv >= spec.changedInDataVersion()) {
                        String modernId = "water_cauldron".equals(legacyRule)
                            ? "minecraft:water_cauldron"
                            : "wall_connections".equals(legacyRule)
                            ? rawId + "[low/none]"
                            : LEGACY_RENAMES.getOrDefault(rawId, rawId);
                        String fromDisplay = "wall_connections".equals(legacyRule) ? rawId + "[true/false]" : rawId;
                        ruleCounts.merge(legacyRule, count, Long::sum);
                        ruleDirections.putIfAbsent(legacyRule, "upgrade");
                        ruleFromIds.putIfAbsent(legacyRule, fromDisplay);
                        ruleToIds.putIfAbsent(legacyRule, modernId);
                        if (!"wall_connections".equals(legacyRule) && !"pre113".equals(legacyRule)) {
                            boolean packHasLegacy = hasImportedAsset(resources, rawId);
                            ruleHasLegacyPack.merge(legacyRule, packHasLegacy, Boolean::logicalOr);
                        }
                    }
                    continue;
                }

                if (config.targetDataVersion > 0) {
                    String modernRule = ruleForModernBlock(rawId);
                    if (modernRule != null) {
                        RuleSpec spec = RULES_BY_KEY.get(modernRule);
                        if (config.targetDataVersion < spec.changedInDataVersion()) {
                            String downgraded = downgradeId(rawId);
                            ruleCounts.merge(modernRule, count, Long::sum);
                            ruleDirections.putIfAbsent(modernRule, "downgrade");
                            ruleFromIds.putIfAbsent(modernRule, rawId);
                            ruleToIds.putIfAbsent(modernRule, downgraded);
                            ruleHasLegacyPack.merge(modernRule, hasImportedAsset(resources, downgraded), Boolean::logicalOr);
                            continue;
                        }
                    }
                    if (!config.targetBlockIds.isEmpty() && rawId.startsWith("minecraft:") && !config.targetBlockIds.contains(rawId)) {
                        unsupportedCounts.merge(rawId, count, Long::sum);
                    }
                }
            }
        }

        List<Map<String, Object>> items = new ArrayList<>();
        for (RuleSpec spec : RULES) {
            Long count = ruleCounts.get(spec.key());
            if (count == null || count <= 0) continue;
            String dir = ruleDirections.get(spec.key());
            var row = new LinkedHashMap<String, Object>();
            row.put("ruleKey", spec.key());
            row.put("title", spec.title());
            row.put("direction", dir);
            row.put("fromId", ruleFromIds.get(spec.key()));
            row.put("toId", ruleToIds.get(spec.key()));
            row.put("changedIn", spec.changedInVersion());
            row.put("count", count);
            row.put("currentChoice", config.actionFor(spec.key()));
            row.put("hasLegacyPackAsset", Boolean.TRUE.equals(ruleHasLegacyPack.get(spec.key())));
            row.put("description", "downgrade".equals(dir) && !spec.downgradeDesc().isEmpty() ? spec.downgradeDesc() : spec.upgradeDesc());
            items.add(row);
        }

        List<Map<String, Object>> unsupported = new ArrayList<>();
        if (!unsupportedCounts.isEmpty()) {
            Map<String, String> names = loadNames(resources);
            for (var entry : unsupportedCounts.entrySet()) {
                String id = entry.getKey();
                String key = "block." + id.replace(':', '.');
                unsupported.add(Map.of(
                    "id", id,
                    "name", names.getOrDefault(key, id),
                    "count", entry.getValue()
                ));
            }
        }

        boolean hasMappable = !items.isEmpty();
        boolean hasDifferences = hasMappable || !unsupported.isEmpty();

        var out = new LinkedHashMap<String, Object>();
        out.put("schematicDataVersion", schemDv);
        out.put("schematicVersionLabel", labelForDataVersion(schemDv));
        out.put("targetDataVersion", config.targetDataVersion);
        out.put("targetVersionLabel", config.effectiveTargetLabel());
        out.put("engineVersionLabel", ENGINE_VERSION_LABEL);
        out.put("defaultAction", config.defaultAction);
        out.put("hasMappableDifferences", hasMappable);
        out.put("hasDifferences", hasDifferences);
        out.put("items", items);
        out.put("unsupportedInTarget", unsupported);
        return out;
    }

    private static boolean hasImportedAsset(ResourceManager resources, String blockId) {
        if (resources == null || blockId == null || !blockId.contains(":")) return false;
        String[] parts = blockId.split(":", 2);
        String ns = parts[0], name = parts[1];
        for (var pack : resources.importedPacks()) {
            if (pack.exists(ns, "blockstates/" + name + ".json") || pack.exists(ns, "textures/block/" + name + ".png")) {
                return true;
            }
        }
        return false;
    }

    private static Map<String, String> loadNames(ResourceManager resources) {
        var names = new HashMap<String, String>();
        if (resources == null) return names;
        for (String lang : List.of("en_us", "zh_cn")) {
            var stack = resources.getResourceStack("minecraft", "lang/" + lang + ".json");
            for (int i = stack.size() - 1; i >= 0; i--) {
                try {
                    io.github.litematicrender.util.MiniJson.parseObject(
                        new String(stack.get(i), java.nio.charset.StandardCharsets.UTF_8)
                    ).forEach((k, v) -> {
                        if (v instanceof String t) names.put(k, t);
                    });
                } catch (Exception ignored) {}
            }
        }
        return names;
    }
}
