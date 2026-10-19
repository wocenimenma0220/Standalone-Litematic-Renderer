import io.github.litematicrender.model.*;
import io.github.litematicrender.nbt.*;
import io.github.litematicrender.render.*;
import io.github.litematicrender.render.raster.Camera;
import io.github.litematicrender.render.scene.*;
import io.github.litematicrender.schematic.SchematicEntity;
import io.github.litematicrender.world.*;
import io.github.litematicrender.render.CliRenderer;
import java.nio.file.*;
import java.util.*;
/** Reuse the already supported 3D entity geometry as orthographic 2D sprites. */
public class ExportBoardEntities {
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]),out=root.resolve("webapp/renderer/board-entities");Files.createDirectories(out);
  try(var resources=CliRenderer.openResources(root.resolve("assets/vanilla"),root)){
   var registry=BlockRegistry.load(resources);var baker=new ModelBaker(resources,registry);var atlas=SpriteAtlas.load(resources,"blocks");
   List<String> ids=new ArrayList<>(List.of("minecart","chest_minecart","furnace_minecart","hopper_minecart","tnt_minecart","command_block_minecart","spawner_minecart","snow_golem","iron_golem","piglin","piglin_baby"));
   for(String wood:EntityGeometry.WOODS){ids.add(wood+ (wood.equals("bamboo")?"_raft":"_boat"));ids.add(wood+(wood.equals("bamboo")?"_chest_raft":"_chest_boat"));}
   for(String id:ids)for(int facing=0;facing<4;facing++){
    var tag=new NbtCompound();if(id.equals("piglin_baby"))tag.put("IsBaby",new NbtScalars.NbtByte((byte)1));
    var e=new SchematicEntity("minecraft:"+(id.equals("piglin_baby")?"piglin":id),tag,0,0,0,facing*90,0,false);var generated=new LinkedHashMap<String,Image>();var mesh=new SceneMesh();new EntityGeometry(baker,registry,generated).lightingEnabled(false).emit(mesh,e,0,0,0,new float[]{1,1,1},false);atlas.replaceGeneratedSprites(generated);
    for(String view:List.of("side","top")){var settings=new RenderSettings(0,view.equals("top")?90:0,128,128);settings.lightingEnabled=false;var cam=new Camera();cam.rotationDeg=0;cam.slantDeg=settings.slantDeg;cam.zoom=32;cam.centerY=view.equals("side")?1:0;cam.update();SchematicRenderer.renderWithCamera(mesh,atlas,settings,cam).writePng(out.resolve(id+"-"+facing+"-"+view+".png"));}
   }
   System.out.println("Exported "+ids.size()+" entity forms, four directions, side/top views");
  }
 }
}
