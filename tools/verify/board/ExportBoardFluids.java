import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;

/** 从同版本运行时和标签导出流体阻挡与实体接触参数。 */
public class ExportBoardFluids {
    static Set<String> tag(Path root,String name,Set<String> seen)throws Exception{
        var result=new TreeSet<String>();if(!seen.add(name))return result;
        var values=com.google.gson.JsonParser.parseString(Files.readString(root.resolve(name+".json"))).getAsJsonObject().getAsJsonArray("values");
        for(var value:values){String id=value.isJsonObject()?value.getAsJsonObject().get("id").getAsString():value.getAsString();if(id.startsWith("#"))result.addAll(tag(root,id.substring(1).replace("minecraft:",""),seen));else result.add(id.replace("minecraft:",""));}return result;
    }
    public static void main(String[] args)throws Exception{
        SharedConstants.tryDetectVersion();Bootstrap.bootStrap();Map<String,Object> data=new LinkedHashMap<>();
        for(String name:List.of("washed_away_by_fluids","blocks_fluid_flow","replaceable"))data.put(name,tag(Path.of(args[0]),name,new HashSet<>()));
        Map<String,Object> materials=new TreeMap<>();for(var block:BuiltInRegistries.BLOCK){float friction=block.getFriction(),speed=block.getSpeedFactor(),bounce=block.getBounceRestitution();if(friction!=.6F||speed!=1F||bounce!=0F)materials.put(BuiltInRegistries.BLOCK.getKey(block).getPath(),List.of(friction,speed,bounce));}
        data.put("entityMaterials",materials);
        Files.writeString(Path.of(args[1]),"'use strict';\n// 从 Java 26.3 运行时与标签导出，供流体、碰撞与接触效果使用。\n(function(root){const data="+new Gson().toJson(data)+";if(typeof module!=='undefined')module.exports=data;else root.BoardFluidData=data;})(typeof window!=='undefined'?window:globalThis);\n");
        Bootstrap.STDOUT.println("导出流体标签和 "+materials.size()+" 种特殊实体接触材质");
    }
}
