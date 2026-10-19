import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.util.RandomSource;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.entity.DispenserBlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/** Real 26.3 runtime fixtures, independent of the JavaScript implementation. */
public class VanillaDeviceReference {
    private static Map<String, String> states(BlockState s) {
        Map<String, String> result = new TreeMap<>();
        s.getValues().forEach(v -> result.put(v.property().getName(), v.valueName()));
        return result;
    }
    private static Map<String, Object> cell(BlockState s) {
        return Map.of("id", BuiltInRegistries.BLOCK.getKey(s.getBlock()).getPath(), "states", states(s));
    }
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
        BuiltInRegistries.DATA_COMPONENT_INITIALIZERS.build(net.minecraft.data.registries.VanillaRegistries.createWorldLookup()).forEach(pending -> pending.apply());
        BlockPos p = BlockPos.ZERO;
        List<Object> analog = new ArrayList<>(), torches = new ArrayList<>(), rails = new ArrayList<>(), inventories = new ArrayList<>(), slots = new ArrayList<>();
        for (Block b : BuiltInRegistries.BLOCK) {
            if (b instanceof AbstractCauldronBlock || b instanceof ComposterBlock || b instanceof CakeBlock || b instanceof CandleCakeBlock
                    || b instanceof BeehiveBlock || b instanceof RespawnAnchorBlock || b instanceof EndPortalFrameBlock || b instanceof CopperGolemStatueBlock)
                for (BlockState s : b.getStateDefinition().getPossibleStates())
                    analog.add(Map.of("cell", cell(s), "signal", s.getAnalogOutputSignal(null, p, Direction.NORTH)));
            if (b instanceof RedstoneTorchBlock)
                for (BlockState s : b.getStateDefinition().getPossibleStates()) {
                    Map<String, Integer> weak = new TreeMap<>(), strong = new TreeMap<>();
                    for (Direction d : Direction.values()) { weak.put(d.getSerializedName(), s.getSignal(null,p,d)); strong.put(d.getSerializedName(),s.getDirectSignal(null,p,d)); }
                    torches.add(Map.of("cell",cell(s),"weak",weak,"strong",strong));
                }
            if (b instanceof BaseRailBlock)
                for (BlockState s : b.getStateDefinition().getPossibleStates())
                    rails.add(Map.of("cell",cell(s),"connections",new RailState(null,p,s).getConnections().stream().map(q->List.of(q.getX(),q.getY(),q.getZ())).toList()));
        }
        Random random = new Random(263);
        for (int size : new int[]{1,3,5,9,27,54}) for (int sample=0; sample<64; sample++) {
            SimpleContainer c = new SimpleContainer(size); List<Object> items = new ArrayList<>();
            for (int i=0;i<size;i++) {
                if (random.nextInt(4)==0) {items.add(null); continue;}
                ItemStack s = new ItemStack(switch(random.nextInt(3)){case 0->Items.STONE;case 1->Items.SNOWBALL;default->Items.WATER_BUCKET;});
                s.setCount(1+random.nextInt(s.getMaxStackSize())); c.setItem(i,s);
                items.add(Map.of("id",BuiltInRegistries.ITEM.getKey(s.getItem()).getPath(),"count",s.getCount(),"max",s.getMaxStackSize()));
            }
            inventories.add(Map.of("size",size,"items",items,"signal",AbstractContainerMenu.getRedstoneSignalFromContainer(c)));
        }
        DispenserBlockEntity dispenser = new DispenserBlockEntity(p,Blocks.DISPENSER.defaultBlockState()); RandomSource rng=RandomSource.create(263);
        for (int i=0;i<512;i++) {
            int mask=random.nextInt(512);for(int j=0;j<9;j++)dispenser.setItem(j,(mask&(1<<j))!=0?new ItemStack(Items.STONE):ItemStack.EMPTY);
            slots.add(Map.of("mask",mask,"slot",dispenser.getRandomSlot(rng)));
        }
        Files.writeString(Path.of(args[0]),new Gson().toJson(Map.of("analog",analog,"torches",torches,"rails",rails,"inventories",inventories,"slots",slots)));
        Bootstrap.STDOUT.println("Wrote vanilla device references: "+analog.size()+" analog states, "+torches.size()+" torch states, "+rails.size()+" rail states, 384 inventories, 512 slot selections");
    }
}
