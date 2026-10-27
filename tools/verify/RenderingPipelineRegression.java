import io.github.litematicrender.render.*;
import io.github.litematicrender.schematic.BoardSchematic;
import io.github.litematicrender.nbt.*;
import io.github.litematicrender.nbt.io.NbtFileUtils;
import io.github.litematicrender.serve.RenderEngine;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;

/** 自有小型资源夹具让 CI 实际执行模型、光照、透明面、缓存和图片导出，无需外部游戏文件。 */
public final class RenderingPipelineRegression {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static NbtCompound entity(String id,double x){
        var at=new NbtList();for(double n:new double[]{x,0,.5})at.add(new NbtScalars.NbtDouble(n));return new NbtCompound().putString("id","minecraft:"+id).put("Pos",at);
    }
    static void resource(Path home,String relative,String text)throws Exception{
        Path file=home.resolve("assets/vanilla/assets/minecraft").resolve(relative);
        Files.createDirectories(file.getParent());Files.writeString(file,text);
    }
    static void texture(Path home,String name,int color)throws Exception{
        Path file=home.resolve("assets/vanilla/assets/minecraft/textures/block/"+name+".png");Files.createDirectories(file.getParent());
        Image image=new Image(16,16);
        for(int y=0;y<16;y++)for(int x=0;x<16;x++)image.pixels()[y*16+x]=color-((x/4+y/4)%2==0?0:0x00101010);
        image.writePng(file);
    }
    public static void main(String[] args)throws Exception{
        Path home=Path.of(args[0]).toAbsolutePath();Files.createDirectories(home);
        resource(home,"atlases/blocks.json","{\"sources\":[{\"type\":\"minecraft:directory\",\"source\":\"block\",\"prefix\":\"block/\"}]}");
        StringBuilder faces=new StringBuilder();
        for(String side:List.of("up","down","north","south","east","west")){
            if(!faces.isEmpty())faces.append(',');
            faces.append('"').append(side).append("\":{\"texture\":\"#all\",\"cullface\":\"").append(side).append("\"}");
        }
        for(String block:List.of("stone","glass","glowstone")){
            resource(home,"blockstates/"+block+".json","{\"variants\":{\"\":{\"model\":\"minecraft:block/"+block+"\"}}}");
            resource(home,"models/block/"+block+".json","{\"textures\":{\"all\":\"minecraft:block/"+block+"\"},\"elements\":[{\"from\":[0,0,0],\"to\":[16,16,16],\"faces\":{"+faces+"}}]}");
        }
        resource(home,"blockstates/air.json","{\"variants\":{}}");
        resource(home,"blockstates/water.json","{\"variants\":{\"level=0\":{}}}");
        texture(home,"stone",0xffb08460);texture(home,"glass",0x6080c0e0);texture(home,"glowstone",0xffffe090);
        texture(home,"water_still",0x904080d0);texture(home,"water_flow",0x904080d0);
        resource(home,"models/item/stone.json","{\"parent\":\"minecraft:block/stone\"}");
        Path fixture=home.resolve("pipeline.litematic");
        BoardSchematic.write(fixture,List.of(Map.of("x",0,"y",0,"z",0,"id","stone"),Map.of("x",1,"y",0,"z",0,"id","glass"),Map.of("x",0,"y",1,"z",0,"id","glowstone"),Map.of("x",0,"y",0,"z",1,"id","water")));
        var source=NbtFileUtils.readCompressed(fixture);var entities=new NbtList();
        entities.add(entity("tnt",3).put("block_state",new NbtCompound().putString("Name","minecraft:stone")).putInt("fuse",5));
        entities.add(entity("falling_block",4).put("BlockState",new NbtCompound().putString("Name","minecraft:glass")));
        entities.add(entity("item",5).put("Item",new NbtCompound().putString("id","minecraft:stone").putInt("count",1)));
        entities.add(entity("pig",128));
        source.getCompound("Regions").orElseThrow().getCompound("设计").orElseThrow().put("Entities",entities);NbtFileUtils.writeCompressed(fixture,source);
        System.setProperty("litematicrender.home",home.toString());System.setProperty("litematicrender.skins.offline","true");
        try(var engine=new RenderEngine(home)){
            engine.loadResources(engine.defaultPackRoot());engine.open(fixture);
            var exported=engine.exportScene(home.resolve("atlas.png"),home.resolve("scene.bin"));
            var report=(Map<?,?>)exported.get("entities");check(report.get("rendered").equals(3)&&report.get("unsupported").equals(1),"static entity coverage");
            check(((Number)exported.get("quads")).longValue()>12,"fixture geometry missing");
            check(Files.size(home.resolve("scene.bin"))>100,"empty GPU mesh");
            var settings=new RenderSettings(45,30,160,160);settings.transparentBackground=true;settings.realLighting=true;
            engine.render(home.resolve("lit.png"),settings,true);
            var image=ImageIO.read(home.resolve("lit.png").toFile());int visible=0,empty=0,missing=0;Set<Integer> colors=new HashSet<>();
            for(int y=0;y<image.getHeight();y++)for(int x=0;x<image.getWidth();x++){
                int pixel=image.getRGB(x,y);if(pixel>>>24==0)empty++;else{visible++;colors.add(pixel);}
                if((pixel>>16&255)>150&&(pixel&255)>150&&(pixel>>8&255)<80)missing++;
            }
            check(visible>100&&empty>100&&colors.size()>8,"PNG is blank, flat or lacks transparent background");
            check(missing==0,"PNG contains missing-texture magenta");
            settings.rotationDeg=135;engine.render(home.resolve("rotated.png"),settings,false);
            check(Files.mismatch(home.resolve("lit.png"),home.resolve("rotated.png"))>=0,"rotation did not change image");
            engine.renderAnimation(home.resolve("rotation.gif"),settings,4,5);
            try(var stream=ImageIO.createImageInputStream(home.resolve("rotation.gif").toFile())){
                var reader=ImageIO.getImageReadersByFormatName("gif").next();try{reader.setInput(stream);check(reader.getNumImages(true)==4,"GIF frame count");check(reader.read(0).getWidth()==160,"GIF size");}finally{reader.dispose();}
            }
            var cached=engine.exportCachedStreamScene(false,false,true);
            check(cached.get("entities").equals(report),"streaming lost unsupported-only section diagnostics");
            Files.copy(Path.of((String)cached.get("mesh")),home.resolve("stream-reference.bin"),StandardCopyOption.REPLACE_EXISTING);
        }
        // 新建引擎再次读取，验证落盘后的场景缓存可恢复。
        try(var engine=new RenderEngine(home)){
            engine.loadResources(engine.defaultPackRoot());engine.open(fixture);
            var cached=engine.exportCachedStreamScene(false,false,true);
            check(((Number)cached.get("meshBuildCount")).intValue()==0,"disk scene cache was not reused");
            check(Files.mismatch(home.resolve("stream-reference.bin"),Path.of((String)cached.get("mesh")))==-1,"cache changed GPU bytes");
        }
        System.out.println("PASS: geometry, TNT/falling block/item, unsupported-entity diagnostics, GPU mesh, lighting, PNG/GIF, rotation and restart cache");
    }
}
