import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.server.Bootstrap;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.world.level.*;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.material.*;
import net.minecraft.world.phys.*;
import net.minecraft.world.phys.shapes.CollisionContext;

/** 调用本地 26.3 原版运行时；暴露度采样循环按原版方法复述，不构造完整服务器。 */
public class TntFluidReference {
    static class Grid implements BlockGetter {
        Map<BlockPos,BlockState> cells=new HashMap<>();
        void put(int x,int y,int z,BlockState state){cells.put(new BlockPos(x,y,z),state);}
        public BlockState getBlockState(BlockPos p){return cells.getOrDefault(p,Blocks.AIR.defaultBlockState());}
        public FluidState getFluidState(BlockPos p){return getBlockState(p).getFluidState();}
        public BlockEntity getBlockEntity(BlockPos p){return null;}
        public int getHeight(){return 384;}
        public int getMinY(){return -64;}
    }
    static List<Double> vector(Vec3 v){return List.of(v.x,v.y,v.z);}
    static float exposure(Grid grid,AABB box,Vec3 center){
        double xs=1/((box.maxX-box.minX)*2+1),ys=1/((box.maxY-box.minY)*2+1),zs=1/((box.maxZ-box.minZ)*2+1);
        double xo=(1-Math.floor(1/xs)*xs)/2,zo=(1-Math.floor(1/zs)*zs)/2;
        int seen=0,total=0;
        for(double x=0;x<=1;x+=xs)for(double y=0;y<=1;y+=ys)for(double z=0;z<=1;z+=zs){
            Vec3 point=new Vec3(box.minX+(box.maxX-box.minX)*x+xo,box.minY+(box.maxY-box.minY)*y,box.minZ+(box.maxZ-box.minZ)*z+zo);
            if(grid.clip(new ClipContext(point,center,ClipContext.Block.COLLIDER,ClipContext.Fluid.NONE,CollisionContext.empty())).getType()==HitResult.Type.MISS)seen++;
            total++;
        }
        return (float)seen/total;
    }
    static Map<String,Object> rayReference(Grid grid,Vec3 center)throws Exception{
        RandomSource random=RandomSource.create(263);Set<BlockPos> hit=new HashSet<>();var calculator=new ExplosionDamageCalculator();
        for(int xx=0;xx<16;xx++)for(int yy=0;yy<16;yy++)for(int zz=0;zz<16;zz++)if(xx==0||xx==15||yy==0||yy==15||zz==0||zz==15){
            double dx=xx/15.0F*2.0F-1.0F,dy=yy/15.0F*2.0F-1.0F,dz=zz/15.0F*2.0F-1.0F,length=Math.sqrt(dx*dx+dy*dy+dz*dz);dx/=length;dy/=length;dz/=length;
            float energy=4.0F*(.7F+random.nextFloat()*.6F);double x=center.x,y=center.y,z=center.z;
            while(energy>0){BlockPos p=BlockPos.containing(x,y,z);var resistance=calculator.getBlockExplosionResistance(null,grid,p,grid.getBlockState(p),grid.getFluidState(p));if(resistance.isPresent())energy-=(resistance.get()+.3F)*.3F;if(energy>0)hit.add(p);x+=dx*.3F;y+=dy*.3F;z+=dz*.3F;energy-=.22500001F;}
        }
        List<String> keys=new ArrayList<>();for(BlockPos p:hit)keys.add(p.getX()+","+p.getY()+","+p.getZ());
        net.minecraft.util.Util.shuffle(keys,random);String payload=String.join(";",keys);String hash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        return Map.of("affectedCount",hit.size(),"orderSha256",hash,"randomAfterShuffle",random.nextInt(1000000),"first",keys.subList(0,Math.min(10,keys.size())));
    }
    public static void main(String[] args)throws Exception{
        SharedConstants.tryDetectVersion();Bootstrap.bootStrap();Map<String,Object> result=new LinkedHashMap<>();
        var dimensions=EntityTypes.TNT.getDimensions();result.put("dimensions",List.of(dimensions.width(),dimensions.height()));
        var random=RandomSource.create(263);List<Integer> fuses=new ArrayList<>();for(int i=0;i<64;i++)fuses.add(PrimedTnt.getRandomShortFuse(80,random));
        result.put("shortFuses",fuses);
        Grid stream=new Grid();stream.put(0,0,0,Blocks.WATER.defaultBlockState());stream.put(-1,0,0,Blocks.STONE.defaultBlockState());
        stream.put(1,0,0,Fluids.FLOWING_WATER.getFlowing(4,false).createLegacyBlock());
        result.put("sourceOwnHeight",stream.getFluidState(BlockPos.ZERO).getOwnHeight());
        result.put("eastCurrent",vector(stream.getFluidState(BlockPos.ZERO).getFlow(stream,BlockPos.ZERO)));
        stream.put(0,1,0,Blocks.WATER.defaultBlockState());result.put("sourceHeightWithWaterAbove",stream.getFluidState(BlockPos.ZERO).getHeight(stream,BlockPos.ZERO));
        Grid falling=new Grid();falling.put(0,0,0,Fluids.FLOWING_WATER.getFlowing(8,true).createLegacyBlock());falling.put(-1,0,0,Blocks.STONE.defaultBlockState());
        result.put("fallingCurrentByWall",vector(falling.getFluidState(BlockPos.ZERO).getFlow(falling,BlockPos.ZERO)));
        var slab=Blocks.OAK_SLAB.defaultBlockState().setValue(BlockStateProperties.WATERLOGGED,true);
        result.put("wetSlabResistance",new ExplosionDamageCalculator().getBlockExplosionResistance(null,stream,BlockPos.ZERO,slab,slab.getFluidState()).orElse(0f));
        Vec3 center=new Vec3(.5,.98F*.0625,.5);AABB target=new AABB(2.01,0,.01,2.99,.98,.99);
        Map<String,Float> seen=new LinkedHashMap<>();
        for(String wall:List.of("air","stone","water","bottom_slab")){
            Grid grid=new Grid();grid.put(1,0,0,switch(wall){case "stone"->Blocks.STONE.defaultBlockState();case "water"->Blocks.WATER.defaultBlockState();case "bottom_slab"->Blocks.OAK_SLAB.defaultBlockState();default->Blocks.AIR.defaultBlockState();});
            seen.put(wall,exposure(grid,target,center));
        }
        result.put("exposureWithNativeVoxelRaycasts",seen);result.put("explosionCenterYAtGround",center.y);
        Grid dry=new Grid();dry.put(1,0,0,Blocks.STONE.defaultBlockState());dry.put(-1,0,0,Blocks.OBSIDIAN.defaultBlockState());dry.put(0,0,1,Blocks.OAK_SLAB.defaultBlockState());
        result.put("dryRayReference",rayReference(dry,center));dry.put(0,0,1,slab);result.put("wetRayReference",rayReference(dry,center));
        Files.writeString(Path.of(args[0]),new Gson().toJson(result));Bootstrap.STDOUT.println(new Gson().toJson(result));
    }
}
