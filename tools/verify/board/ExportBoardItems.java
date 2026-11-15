import com.google.gson.Gson;
import com.mojang.serialization.JsonOps;
import java.nio.file.*;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.storage.loot.providers.number.ints.ResolvableInt;
public class ExportBoardItems{
 public static void main(String[] args)throws Exception{SharedConstants.tryDetectVersion();Bootstrap.bootStrap();BuiltInRegistries.DATA_COMPONENT_INITIALIZERS.build(net.minecraft.data.registries.VanillaRegistries.createWorldLookup()).forEach(p->p.apply());Map<String,Object> data=new TreeMap<>();for(var i:BuiltInRegistries.ITEM){var c=i.components();var compost=c.get(DataComponents.COMPOSTABLE);data.put(BuiltInRegistries.ITEM.getKey(i).getPath(),List.of(c.getOrDefault(DataComponents.MAX_STACK_SIZE,1),c.getOrDefault(DataComponents.MAX_DAMAGE,0),compost==null?"":ResolvableInt.CODEC.encodeStart(JsonOps.INSTANCE,compost.layers()).getOrThrow().toString(),i instanceof net.minecraft.world.item.ProjectileItem pi?List.of(pi.createDispenseConfig().power(),pi.createDispenseConfig().uncertainty()):List.of()));}Files.writeString(Path.of(args[0]),"'use strict';\n(function(root){const data="+new Gson().toJson(data)+";if(typeof module!=='undefined')module.exports=data;else root.BoardItemData=data;})(typeof window!=='undefined'?window:globalThis);\n");Bootstrap.STDOUT.println("Exported "+data.size()+" item stack, durability and compost components");}
}
