import io.github.litematicrender.schematic.*;
import io.github.litematicrender.nbt.*;
import java.nio.file.*;
import java.util.*;

public class PreviewCheckpointRegression {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static NbtCompound stone(){return new NbtCompound().putString("Name","minecraft:stone");}
    public static void main(String[] args)throws Exception{
        Path directory=Files.createTempDirectory(Path.of(args[0]),"preview-checkpoint-");
        try{
            Path source=directory.resolve("source.litematic");BoardSchematic.write(source,List.of(Map.of("x",0,"y",0,"z",0,"id","stone")));
            var edits=new ProjectionEdits(source);var before=edits.checkpoint();
            edits.set(new int[]{10,0,0},stone());edits.set(new int[]{20,0,0},stone());edits.squash(before,true);
            check(edits.previewCells().size()==54,"联动批次应包含两个邻域");
            edits.clearPreview();check(edits.previewCells().isEmpty(),"重建后清理补丁范围");
            check(edits.undo(),"保留撤销历史");check(edits.previewCells().size()==54,"撤销重新标记整个联动批次");
            edits.clearPreview();check(edits.redo(),"保留重做历史");check(edits.previewCells().size()==54,"重做重新标记整个联动批次");
            edits.clearPreview();var checkpoint=edits.checkpoint();edits.set(new int[]{30,0,0},stone());edits.restore(checkpoint);
            check(edits.previewCells().isEmpty(),"失败回滚不能遗留补丁范围");
            edits.set(new int[]{40,0,0},stone());check(edits.previewCells().size()==27,"新一轮预览仅包含新位置");
            System.out.println("PASS: 补丁范围重置、联动撤销重做、失败回滚及新位置隔离");
        }finally{try(var files=Files.walk(directory)){for(var file:files.sorted(Comparator.reverseOrder()).toList())Files.delete(file);}}
    }
}
