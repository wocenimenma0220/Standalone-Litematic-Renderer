import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

public class ExportBoardPhysics {
  static void readTag(Path tags,String name,Set<String> ids)throws Exception{var values=com.google.gson.JsonParser.parseString(Files.readString(tags.resolve(name+".json"))).getAsJsonObject().getAsJsonArray("values");for(var value:values){String id=value.isJsonObject()?value.getAsJsonObject().get("id").getAsString():value.getAsString();if(id.startsWith("#"))readTag(tags,id.substring(1).replace("minecraft:",""),ids);else ids.add(id.replace("minecraft:",""));}}
  static String key(BlockState s,List<Property<?>> ps){Map<String,String> v=new HashMap<>();s.getValues().forEach(x->v.put(x.property().getName(),x.valueName()));return String.join(",",ps.stream().map(p->v.get(p.getName())).toList());}
  public static void main(String[] args)throws Exception{
    SharedConstants.tryDetectVersion();Bootstrap.bootStrap();Map<String,Object> all=new TreeMap<>();Map<String,Object> defaults=new TreeMap<>();
    for(Block b:BuiltInRegistries.BLOCK){Map<String,String> dv=new TreeMap<>();b.defaultBlockState().getValues().forEach(v->dv.put(v.property().getName(),v.valueName()));defaults.put(BuiltInRegistries.BLOCK.getKey(b).getPath(),dv);var states=b.getStateDefinition().getPossibleStates();List<Property<?>> ps=new ArrayList<>(b.getStateDefinition().getProperties());ps.sort(Comparator.comparing(Property::getName));Map<BlockState,Object> vals=new IdentityHashMap<>();
      for(BlockState s:states){var boxes=s.getCollisionShape(EmptyBlockGetter.INSTANCE,BlockPos.ZERO).toAabbs().stream().map(a->List.of(a.minX,a.minY,a.minZ,a.maxX,a.maxY,a.maxZ)).toList();vals.put(s,List.of(s.getPistonPushReaction().name(),s.getDestroySpeed(EmptyBlockGetter.INSTANCE,BlockPos.ZERO)<0,s.hasBlockEntity(),boxes,s.getBlock().getExplosionResistance(),b instanceof ButtonBlock?s.getShape(EmptyBlockGetter.INSTANCE,BlockPos.ZERO).toAabbs().stream().map(a->List.of(a.minX,a.minY,a.minZ,a.maxX,a.maxY,a.maxZ)).toList():List.of(),s.isCollisionShapeFullBlock(EmptyBlockGetter.INSTANCE,BlockPos.ZERO)));}
      for(var p:new ArrayList<>(ps)){var rest=ps.stream().filter(x->x!=p).toList();Map<String,Object> projected=new HashMap<>();boolean relevant=false;for(var s:states){Object old=projected.putIfAbsent(key(s,rest),vals.get(s));if(old!=null&&!old.equals(vals.get(s))){relevant=true;break;}}if(!relevant)ps.remove(p);}
      if(ps.isEmpty())all.put(BuiltInRegistries.BLOCK.getKey(b).getPath(),vals.get(states.getFirst()));else{Map<String,Object> values=new TreeMap<>();for(var s:states)values.put(key(s,ps),vals.get(s));all.put(BuiltInRegistries.BLOCK.getKey(b).getPath(),Map.of("keys",ps.stream().map(Property::getName).toList(),"defaults",key(b.defaultBlockState(),ps).split(","),"values",values));}
    }
    all.put("__defaults",defaults);Set<String> logs=new TreeSet<>();readTag(Path.of(args[1]),"logs",logs);all.put("__leafLogs",logs);Files.writeString(Path.of(args[0]),"'use strict';\n// 由 Java 26.3 导出：推动反应、不可破坏、方块实体、碰撞盒、爆炸抗性、按钮形状、完整碰撞。\n(function(root){const data="+new Gson().toJson(all)+";if(typeof module!=='undefined')module.exports=data;else root.BoardPhysicsData=data;})(typeof window!=='undefined'?window:globalThis);\n");
    Bootstrap.STDOUT.println("Exported "+all.size()+" block collision / piston reaction entries");
  }
}
