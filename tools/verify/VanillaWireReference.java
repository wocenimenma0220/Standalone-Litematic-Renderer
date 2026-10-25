import com.google.gson.Gson;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.FluidState;


public class VanillaWireReference {
    private static class Grid implements BlockGetter {
        final Map<BlockPos, BlockState> cells = new HashMap<>();
        public BlockState getBlockState(BlockPos pos) { return cells.getOrDefault(pos, Blocks.AIR.defaultBlockState()); }
        public BlockEntity getBlockEntity(BlockPos pos) { return null; }
        public FluidState getFluidState(BlockPos pos) { return getBlockState(pos).getFluidState(); }
        public int getHeight() { return 384; }
        public int getMinY() { return -64; }
    }
    private static Map<String, String> stateValues(BlockState state) {
        Map<String, String> values = new TreeMap<>();
        state.getValues().forEach(v -> values.put(v.property().getName(), v.valueName()));
        return values;
    }
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
        RedstoneWireBlock wire = (RedstoneWireBlock)Blocks.REDSTONE_WIRE;
        Method connection = RedstoneWireBlock.class.getDeclaredMethod("getConnectionState", BlockGetter.class, BlockState.class, BlockPos.class);
        connection.setAccessible(true);
        List<BlockState> choices = new ArrayList<>();
        for (Block block : List.of(Blocks.AIR, Blocks.STONE, Blocks.GLASS, Blocks.HOPPER, Blocks.REDSTONE_BLOCK, Blocks.REDSTONE_WIRE,
                Blocks.REPEATER, Blocks.COMPARATOR, Blocks.OBSERVER, Blocks.OAK_BUTTON, Blocks.LEVER, Blocks.OAK_SLAB,
                Blocks.OAK_STAIRS, Blocks.OAK_TRAPDOOR, Blocks.CHEST, Blocks.PISTON, Blocks.OAK_LEAVES))
            choices.addAll(block.getStateDefinition().getPossibleStates());
        Random random = new Random(263);
        List<Object> fixtures = new ArrayList<>();
        for (int sample = 0; sample < 256; sample++) {
            Grid grid = new Grid(); BlockPos pos = new BlockPos(random.nextInt(33)-16, random.nextInt(7)-3, random.nextInt(33)-16);
            BlockState initial = wire.defaultBlockState().setValue(RedstoneWireBlock.POWER, random.nextInt(16));
            if (sample % 2 == 0) for (var property : RedstoneWireBlock.PROPERTY_BY_DIRECTION.values())
                initial = initial.setValue(property, net.minecraft.world.level.block.state.properties.RedstoneSide.SIDE);
            grid.cells.put(pos, initial);
            for (Direction direction : Direction.values()) grid.cells.put(pos.relative(direction), choices.get(random.nextInt(choices.size())));
            for (Direction direction : Direction.Plane.HORIZONTAL) for (int dy : new int[]{-1,1})
                grid.cells.put(pos.relative(direction).offset(0,dy,0), random.nextBoolean() ? wire.defaultBlockState() : choices.get(random.nextInt(choices.size())));
            BlockState result = (BlockState)connection.invoke(wire, grid, initial, pos);
            Map<String, Integer> signal = new TreeMap<>(), direct = new TreeMap<>();
            for (Direction direction : Direction.values()) {
                signal.put(direction.getSerializedName(), initial.getSignal(grid,pos,direction));
                direct.put(direction.getSerializedName(), initial.getDirectSignal(grid,pos,direction));
            }
            List<Object> cells = new ArrayList<>();
            for (var entry : grid.cells.entrySet()) cells.add(List.of(List.of(entry.getKey().getX(),entry.getKey().getY(),entry.getKey().getZ()),
                Map.of("id", BuiltInRegistries.BLOCK.getKey(entry.getValue().getBlock()).getPath(), "states", stateValues(entry.getValue()))));
            Set<BlockPos> notifications = new HashSet<>(); notifications.add(pos);
            for (Direction direction : Direction.values()) notifications.add(pos.relative(direction));
            fixtures.add(Map.of("pos", List.of(pos.getX(),pos.getY(),pos.getZ()), "cells", cells, "connection", stateValues(result),
                "signal", signal, "direct", direct, "notifications", notifications.stream().map(p->List.of(p.getX(),p.getY(),p.getZ())).toList()));
        }
        Files.writeString(Path.of(args[0]),new Gson().toJson(fixtures));
        Bootstrap.STDOUT.println("Wrote 256 vanilla wire connection/signal/HashSet reference cases");
    }
}
