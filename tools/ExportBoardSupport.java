import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SupportType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

/** 分别导出原版支撑面、导电和红石粉连接属性。 */
public class ExportBoardSupport {
    private static final Direction[] DIRECTIONS = {Direction.DOWN, Direction.UP, Direction.NORTH, Direction.SOUTH, Direction.WEST, Direction.EAST};
    private static final SupportType[] TYPES = {SupportType.FULL, SupportType.CENTER, SupportType.RIGID};

    private static int mask(BlockState state) {
        int mask = 0;
        for (int t = 0; t < TYPES.length; t++)
            for (int d = 0; d < DIRECTIONS.length; d++)
                if (state.isFaceSturdy(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, DIRECTIONS[d], TYPES[t]))
                    mask |= 1 << (t * 6 + d);
        if (state.isRedstoneConductor(EmptyBlockGetter.INSTANCE, BlockPos.ZERO)) mask |= 1 << 18;
        for (int d = 0; d < DIRECTIONS.length; d++)
            if (state.shouldRedstoneWireConnectTo(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, DIRECTIONS[d])) mask |= 1 << (19 + d);
        if (state.shouldRedstoneWireConnectTo(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, null)) mask |= 1 << 25;
        return mask;
    }

    private static String key(BlockState state, List<Property<?>> properties) {
        Map<String, String> values = new HashMap<>();
        state.getValues().forEach(value -> values.put(value.property().getName(), value.valueName()));
        return String.join(",", properties.stream().map(p -> values.get(p.getName())).toList());
    }

    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        Map<String, Object> blocks = new TreeMap<>();
        int count = 0;
        for (Block block : BuiltInRegistries.BLOCK) {
            List<BlockState> states = block.getStateDefinition().getPossibleStates();
            List<Property<?>> properties = new ArrayList<>(block.getStateDefinition().getProperties());
            properties.sort(Comparator.comparing(Property::getName));
            Map<BlockState, Integer> masks = new IdentityHashMap<>();
            for (BlockState state : states) masks.put(state, mask(state));
            count += states.size();
            // 排除不会影响支撑形状的含水、供电等属性。
            for (Property<?> property : new ArrayList<>(properties)) {
                List<Property<?>> rest = properties.stream().filter(p -> p != property).toList();
                Map<String, Integer> projected = new HashMap<>();
                boolean relevant = false;
                for (BlockState state : states) {
                    Integer old = projected.putIfAbsent(key(state, rest), masks.get(state));
                    if (old != null && !old.equals(masks.get(state))) { relevant = true; break; }
                }
                if (!relevant) properties.remove(property);
            }
            String id = BuiltInRegistries.BLOCK.getKey(block).getPath();
            if (properties.isEmpty()) blocks.put(id, masks.get(states.getFirst()));
            else {
                Map<String, Integer> values = new TreeMap<>();
                for (BlockState state : states) values.put(key(state, properties), masks.get(state));
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("keys", properties.stream().map(Property::getName).toList());
                entry.put("defaults", key(block.defaultBlockState(), properties).split(","));
                entry.put("values", values);
                blocks.put(id, entry);
            }
        }
        String source = "'use strict';\n// 从 Java 26.3 导出：支撑形状占 0～17 位，导电为第 18 位，六向红石连接占 19～24 位，空方向占第 25 位。\n"
            + "(function(root){const data=" + new Gson().toJson(blocks) + ";\n"
            + "if(typeof module!=='undefined')module.exports=data;else root.BoardSupportData=data;})(typeof window!=='undefined'?window:globalThis);\n";
        Files.writeString(Path.of(args[0]), source);
        Bootstrap.STDOUT.println("Exported " + blocks.size() + " blocks / " + count + " vanilla states");
    }
}
