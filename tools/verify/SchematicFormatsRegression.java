import io.github.litematicrender.schematic.*;
import io.github.litematicrender.nbt.*;
import io.github.litematicrender.nbt.io.NbtFileUtils;
import java.nio.file.*;
import java.util.*;

public class SchematicFormatsRegression {
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    static NbtList ints(int... values){var out=new NbtList();for(int n:values)out.add(new NbtScalars.NbtInt(n));return out;}
    static NbtList doubles(double... values){var out=new NbtList();for(double n:values)out.add(new NbtScalars.NbtDouble(n));return out;}
    static NbtList list(NbtElement... values){var out=new NbtList();for(var value:values)out.add(value);return out;}
    static NbtCompound state(String name){return new NbtCompound().putString("Name","minecraft:"+name);}
    static void rejects(Path file,NbtCompound root)throws Exception{
        NbtFileUtils.writeCompressed(file,root);try{SchematicFormats.read(file);throw new AssertionError("accepted malformed input");}catch(java.io.IOException expected){}
    }
    public static void main(String[] args)throws Exception{
        Path out=Path.of(args[0]).resolve("formats");Files.createDirectories(out);Path file=out.resolve("structure.nbt");
        var block=new NbtCompound().put("pos",ints(1,0,1)).putInt("state",0).put("nbt",new NbtCompound().putString("id","minecraft:chest").putString("CustomName","kept"));
        var stone=new NbtCompound().put("pos",ints(0,0,1)).putInt("state",2);
        var root=new NbtCompound().put("size",ints(2,1,2)).putInt("DataVersion",5023).put("palette",list(state("chest"),state("air"),state("stone"))).put("blocks",list(block,stone)).put("entities",list(new NbtCompound().put("pos",doubles(.5,1,.5)).put("nbt",new NbtCompound().putString("id","minecraft:item_frame"))));
        NbtFileUtils.writeRaw(file,root);byte[] original=Files.readAllBytes(file);
        Files.copy(file,out.resolve("valid-structure.nbt"),StandardCopyOption.REPLACE_EXISTING);
        var normalized=SchematicFormats.read(file);check(normalized.contains("ImportedSource"),"source metadata lost");
        var edits=new ProjectionEdits(file);check(edits.state(new int[]{1,0,1}).getStringOrDefault("Name","").equals("minecraft:chest"),"x/z layout or nonair index zero");
        check(edits.state(new int[]{0,0,0}).getStringOrDefault("Name","").equals("minecraft:air"),"sparse absent positions should be air");
        var schematic=LitematicaSchematic.load(file);var region=schematic.regions().values().iterator().next();check(region.entities.size()==1,"vanilla entity import");check(region.blockEntities.size()==1,"vanilla container NBT import");
        edits.set(new int[]{0,0,0},state("stone"));Path saved=out.resolve("edited.litematic");edits.write(saved);check(LitematicaSchematic.load(saved).metadata().totalBlocks==3,"imported edit/export");check(Arrays.equals(original,Files.readAllBytes(file)),"original overwritten");
        root.remove("palette");root.put("palettes",list(list(state("chest"),state("air"),state("stone")),list(state("stone"),state("air"),state("stone"))));NbtFileUtils.writeCompressed(file,root);check(SchematicFormats.read(file).getCompound("Metadata").orElseThrow().getStringOrDefault("Description","").contains("第一套"),"palette variation not disclosed");
        root.put("size",ints(Integer.MAX_VALUE,1,1));rejects(file,root);
        root.put("size",ints(2,1,2));root.put("blocks",list(block,block));rejects(file,root);
        for(int version:List.of(2,3)){
            var palette=new NbtCompound().putInt("minecraft:stone",0).putInt("minecraft:chest[facing=east,waterlogged=true,type=single]",130);
            var data=new NbtCompound().put("Palette",palette).put(version==3?"Data":"BlockData",new NbtScalars.NbtByteArray(new byte[]{0,(byte)130,1}));
            var container=new NbtCompound().putString("Id","minecraft:chest").putIntArray("Pos",new int[]{1,0,0});
            if(version==3)container.put("Data",new NbtCompound().putString("CustomName","Sponge chest"));else container.putString("CustomName","Sponge chest");
            data.put("BlockEntities",list(container));
            var sponge=new NbtCompound().putInt("Version",version).putInt("Width",2).putInt("Height",1).putInt("Length",1).putIntArray("Offset",new int[]{-3,2,5});
            var entity=new NbtCompound().putString("Id","minecraft:item_frame").put("Pos",version==3?doubles(.5,1,.5):doubles(-2.5,3,5.5));
            if(version==3)entity.put("Data",new NbtCompound().putString("CustomName","frame"));sponge.put("Entities",list(entity));
            if(version==3)sponge.put("Blocks",data);else sponge.combine(data);
            var wrapped=version==3?new NbtCompound().put("Schematic",sponge):sponge;
            file=out.resolve("sponge-"+version+".schem");NbtFileUtils.writeCompressed(file,wrapped);
            Files.copy(file,out.resolve("valid-sponge-"+version+".schem"),StandardCopyOption.REPLACE_EXISTING);
            edits=new ProjectionEdits(file);check(edits.state(new int[]{-2,2,5}).getStringOrDefault("Name","").equals("minecraft:chest"),"Sponge offsets or sparse VarInt palette");
            region=LitematicaSchematic.load(file).regions().values().iterator().next();check(region.entities.size()==1&&region.entities.get(0).x()==.5,"Sponge entity position");check(region.blockEntities.values().iterator().next().getStringOrDefault("CustomName","").equals("Sponge chest"),"Sponge block entity data");
            data.put(version==3?"Data":"BlockData",new NbtScalars.NbtByteArray(new byte[]{(byte)128}));if(version==2)sponge.combine(data);rejects(file,wrapped);
            data.put(version==3?"Data":"BlockData",new NbtScalars.NbtByteArray(new byte[]{0,0,0}));if(version==2)sponge.combine(data);rejects(file,wrapped);
        }
        System.out.println("PASS: raw/gzip Java NBT, palette variants, sparse blocks, Sponge 2/3, offsets, VarInt, containers/entities, edit roundtrip and corrupt-data rejection");
    }
}
