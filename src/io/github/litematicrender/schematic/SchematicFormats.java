package io.github.litematicrender.schematic;

import io.github.litematicrender.nbt.*;
import io.github.litematicrender.nbt.io.NbtFileUtils;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;

/** 将 Java 结构和 Sponge 2/3 转成统一区域数据；编辑与预览共用同一转换，原文件保持不变。 */
public final class SchematicFormats {
    private static final int MAX_VOLUME=16_000_000,MAX_PALETTE=65_536;
    private static final Set<String> AIR=Set.of("minecraft:air","minecraft:cave_air","minecraft:void_air");
    private SchematicFormats(){}
    public static NbtCompound read(Path file)throws IOException{
        NbtCompound root=NbtFileUtils.readSchematic(file);
        if(root.contains("Regions"))return root;
        if(root.contains("size")&&root.contains("blocks"))return vanilla(root,file.getFileName().toString());
        NbtCompound sponge=root.getCompound("Schematic").orElse(root);
        if(sponge.contains("Width")&&sponge.contains("Height")&&sponge.contains("Length"))return sponge(sponge,root,file.getFileName().toString());
        throw new IOException("不支持的结构内容；请选择 Litematica、Java 结构 NBT 或 Sponge v2/v3 .schem");
    }
    private static NbtCompound pos(int x,int y,int z){return new NbtCompound().putInt("x",x).putInt("y",y).putInt("z",z);}
    private static int volume(int[] size)throws IOException{
        long count=1;for(int axis:size){if(axis<1||axis>16384)throw new IOException("结构尺寸须为 1–16384");count*=axis;}
        if(count>MAX_VOLUME)throw new IOException("导入结构超过 1600 万格");return (int)count;
    }
    private static int[] coordinates(NbtCompound tag,String key)throws IOException{
        var array=tag.getIntArray(key).orElse(null);
        if(array!=null){if(array.value.length!=3)throw new IOException("无效坐标："+key);for(int n:array.value)if(Math.abs((long)n)>16_777_216)throw new IOException("坐标超出导入范围："+key);return array.value.clone();}
        var list=tag.getList(key).orElse(null);
        if(list==null||list.size()!=3)throw new IOException("缺少三维整数坐标："+key);
        int[] out=new int[3];for(int i=0;i<3;i++){
            double n=SchematicEntity.number(list.get(i),Double.NaN);
            if(!Double.isFinite(n)||n!=Math.rint(n)||Math.abs(n)>16_777_216)throw new IOException("无效坐标："+key);
            out[i]=(int)n;
        }return out;
    }
    private static int index(int[] at,int[] size)throws IOException{
        for(int i=0;i<3;i++)if(at[i]<0||at[i]>=size[i])throw new IOException("方块坐标超出结构尺寸");
        return (at[1]*size[2]+at[2])*size[0]+at[0];
    }
    private static NbtCompound state(UnresolvedBlockState raw)throws IOException{
        if(!raw.blockId().matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))throw new IOException("无效方块 ID："+raw.blockId());
        var properties=new NbtCompound();for(var entry:raw.properties().entrySet()){
            if(!entry.getKey().matches("[a-z0-9_]+")||!entry.getValue().matches("[a-z0-9_-]+"))throw new IOException("无效方块属性");
            properties.putString(entry.getKey(),entry.getValue());
        }
        return new NbtCompound().putString("Name",raw.blockId()).put("Properties",properties);
    }
    private static NbtList palette(){var list=new NbtList();list.add(new NbtCompound().putString("Name","minecraft:air"));return list;}
    private static NbtCompound vanilla(NbtCompound source,String name)throws IOException{
        int[] size=coordinates(source,"size");int[] cells=new int[volume(size)];
        NbtList input=source.getList("palette").orElse(null);
        boolean variants=false;
        if(input==null){var palettes=source.getList("palettes").orElseThrow(()->new IOException("缺少结构调色板"));input=palettes.getListAt(0).orElseThrow(()->new IOException("结构调色板为空"));variants=palettes.size()>1;}
        if(input.isEmpty()||input.size()>MAX_PALETTE)throw new IOException("结构调色板大小无效");
        var palette=palette();for(var entry:input.getCompounds()){
            if(!entry.contains("Name",NbtTypes.TAG_STRING))throw new IOException("结构调色板条目缺少 Name");
            palette.add(state(LitematicaSchematic.readBlockState(entry)));
        }
        if(palette.size()!=input.size()+1)throw new IOException("无效结构调色板条目");
        var blockEntities=new NbtList();var occupied=new BitSet(cells.length);
        for(var entry:source.getList("blocks").orElseThrow(()->new IOException("缺少方块列表")).getCompounds()){
            int[] at=coordinates(entry,"pos");int slot=index(at,size),id=entry.getIntOrDefault("state",-1);
            if(id<0||id>=input.size()||occupied.get(slot))throw new IOException("重复方块或无效调色板索引");
            occupied.set(slot);cells[slot]=id+1;
            var nbt=entry.getCompound("nbt").orElse(null);if(nbt!=null){var data=(NbtCompound)nbt.copy();data.putInt("x",at[0]).putInt("y",at[1]).putInt("z",at[2]);blockEntities.add(data);}
        }
        var entities=new NbtList();for(var entry:source.getList("entities").orElse(new NbtList()).getCompounds()){
            var nbt=entry.getCompound("nbt").orElse(null);if(nbt==null)continue;
            var location=entry.getList("pos").orElse(null);if(location==null||SchematicEntity.vector(location,3)==null)throw new IOException("无效结构实体坐标");
            var data=(NbtCompound)nbt.copy();data.put("Pos",location);entities.add(data);
        }
        return result(source,name,"Java 结构 NBT",source.getIntOrDefault("DataVersion",0),size,new int[3],palette,cells,blockEntities,entities,variants?"多套调色板结构使用第一套；导出为 .litematic。":"导出为 .litematic；原始结构数据保留在 ImportedSource 中。");
    }
    private static NbtCompound sponge(NbtCompound source,NbtCompound original,String name)throws IOException{
        int version=source.getIntOrDefault("Version",-1);if(version!=2&&version!=3)throw new IOException("仅支持 Sponge v2/v3；旧数字 ID .schematic 尚未接入");
        int[] size={source.getShortOrDefault("Width",(short)0)&65535,source.getShortOrDefault("Height",(short)0)&65535,source.getShortOrDefault("Length",(short)0)&65535};
        int[] cells=new int[volume(size)],offset=source.contains("Offset")?coordinates(source,"Offset"):new int[3];
        NbtCompound blocks=version==3?source.getCompound("Blocks").orElseThrow(()->new IOException("缺少 Blocks")):source;
        NbtCompound input=blocks.getCompound("Palette").orElseThrow(()->new IOException("缺少 Sponge 调色板"));
        if(input.isEmpty()||input.size()>MAX_PALETTE)throw new IOException("Sponge 调色板大小无效");
        var palette=palette();var remap=new HashMap<Integer,Integer>();
        for(String key:input.getKeys()){
            if(!key.matches("[a-z0-9_.-]+(?::[a-z0-9_./-]+)?(?:\\[[a-z0-9_=,-]+\\])?"))throw new IOException("无效 Sponge 方块状态："+key);
            int id=input.getIntOrDefault(key,-1);if(id<0||remap.putIfAbsent(id,palette.size())!=null)throw new IOException("Sponge 调色板索引重复或无效");
            palette.add(state(LitematicaSchematic.readBlockState(new NbtCompound().putString("blockstate",key))));
        }
        byte[] bytes=blocks.getByteArray(version==3?"Data":"BlockData").orElseThrow(()->new IOException("缺少 Sponge 方块数据")).value;
        int cursor=0;
        for(int i=0;i<cells.length;i++){
            int id=0,shift=0,b;
            do{if(cursor>=bytes.length||shift>=35)throw new IOException("Sponge 方块 VarInt 截断或过长");b=bytes[cursor++]&255;if(shift==28&&(b&0xf8)!=0)throw new IOException("Sponge 方块索引溢出");id|=(b&127)<<shift;shift+=7;}while((b&128)!=0);
            Integer mapped=remap.get(id);if(mapped==null)throw new IOException("Sponge 方块引用不存在的调色板项");cells[i]=mapped;
        }
        if(cursor!=bytes.length)throw new IOException("Sponge 方块数据长度与结构尺寸不符");
        var blockEntities=new NbtList();for(var entry:blocks.getList("BlockEntities").orElse(new NbtList()).getCompounds()){
            int[] at=coordinates(entry,"Pos");index(at,size);
            var data=(NbtCompound)(version==3?entry.getCompound("Data").orElse(new NbtCompound()):entry).copy();
            data.putString("id",entry.getStringOrDefault("Id",data.getStringOrDefault("id",""))).putInt("x",at[0]).putInt("y",at[1]).putInt("z",at[2]);blockEntities.add(data);
        }
        var entities=new NbtList();for(var entry:source.getList("Entities").orElse(new NbtList()).getCompounds()){
            double[] at=SchematicEntity.vector(entry.get("Pos").orElse(null),3);if(at==null)throw new IOException("无效 Sponge 实体坐标");
            if(version==2)for(int i=0;i<3;i++)at[i]-=offset[i];
            var location=new NbtList();for(double n:at)location.add(new NbtScalars.NbtDouble(n));
            var data=(NbtCompound)(version==3?entry.getCompound("Data").orElse(new NbtCompound()):entry).copy();
            data.putString("id",entry.getStringOrDefault("Id",data.getStringOrDefault("id",""))).put("Pos",location);entities.add(data);
        }
        return result(original,name,"Sponge v"+version,source.getIntOrDefault("DataVersion",0),size,offset,palette,cells,blockEntities,entities,"导出为 .litematic；旧版方块名称和实体 NBT 不执行游戏 DataFixer 迁移。");
    }
    private static NbtCompound result(NbtCompound original,String name,String format,int dataVersion,int[] size,int[] offset,NbtList palette,int[] cells,NbtList blockEntities,NbtList entities,String note){
        int bits=Math.max(2,32-Integer.numberOfLeadingZeros(palette.size()-1)),count=0;
        long[] words=new long[(int)(((long)cells.length*bits+63)/64)];
        for(int i=0;i<cells.length;i++){
            long id=cells[i],bit=(long)i*bits;int word=(int)(bit>>>6),shift=(int)(bit&63);
            words[word]|=id<<shift;if(shift+bits>64)words[word+1]|=id>>>(64-shift);
            String block=((NbtCompound)palette.get((int)id)).getStringOrDefault("Name","");if(!AIR.contains(block))count++;
        }
        var dimensions=pos(size[0],size[1],size[2]);
        var region=new NbtCompound().put("Position",pos(offset[0],offset[1],offset[2])).put("Size",dimensions).put("BlockStatePalette",palette).putLongArray("BlockStates",words).put("TileEntities",blockEntities).put("Entities",entities);
        var metadata=new NbtCompound().putString("Name",name).putString("Author",original.getStringOrDefault("author","?")).putString("Description",note).putInt("RegionCount",1).putInt("TotalBlocks",count).putInt("TotalVolume",cells.length).put("EnclosingSize",dimensions);
        return new NbtCompound().putInt("Version",6).putInt("MinecraftDataVersion",dataVersion).putString("SourceFormat",format).put("ImportedSource",original).put("Metadata",metadata).put("Regions",new NbtCompound().put("导入结构",region));
    }
}
