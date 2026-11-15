import io.github.litematicrender.serve.RenderEngine;
import io.github.litematicrender.schematic.BoardSchematic;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.*;

public class EditPreviewBudgetRegression {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static Map<String,Object> edit(int index,String id){return Map.of("position",List.of(index%20*4,0,index/20*4),"id",id,"states",Map.of());}
    public static void main(String[] args)throws Exception{
        Path home=Path.of(args[0]),out=home.resolve("tools/verify/edit-preview-output");Files.createDirectories(out);
        var blocks=new ArrayList<Object>();for(int i=0;i<340;i++)blocks.add(Map.of("x",i%20*4,"y",0,"z",i/20*4,"id","stone"));
        Path source=out.resolve("source.litematic");BoardSchematic.write(source,blocks);byte[] original=Files.readAllBytes(source);
        try(var engine=new RenderEngine(home)){
            engine.loadResources(engine.defaultPackRoot());engine.open(source);engine.editBlock(edit(0,"glass"));
            var first=engine.editPatch(out.resolve("patch"),null,null);Path image=Path.of((String)first.get("atlas"));
            Files.setLastModifiedTime(image,FileTime.fromMillis(123000));engine.editPatch(out.resolve("patch"),null,null);
            check(Files.getLastModifiedTime(image).toMillis()==123000,"图集不变时不得重复编码 PNG");
            engine.commitEdits();check(((List<?>)engine.editPatch(out.resolve("patch"),null,null).get("cells")).size()==27,"后台导出提交不能清理当前画面的覆盖范围");
            engine.editBlock(edit(1,"glass"));engine.commitEdits(true);
            check(((List<?>)engine.editPatch(out.resolve("patch"),null,null).get("cells")).isEmpty(),"基础模型重建后应清理累计范围");
            engine.editBlock(Map.of("action","undo"));check(((List<?>)engine.editPatch(out.resolve("patch"),null,null).get("cells")).size()==27,"重建后撤销应恢复局部覆盖");
            for(int i=2;i<310;i++)engine.editBlock(edit(i,"glass"));
            var limited=engine.editPatch(out.resolve("patch"),null,null);check(Boolean.TRUE.equals(limited.get("rebuildRequired")),"累计预览必须有固定上限");
            engine.commitEdits(true);engine.editBlock(Map.of("action","undo"));
            check(((List<?>)engine.editPatch(out.resolve("patch"),null,null).get("cells")).size()==27,"预算重建后应保留正确的撤销坐标");
            check(Arrays.equals(original,Files.readAllBytes(source)),"原投影不得被覆盖");
        }
        System.out.println("PASS: 预览上限、重建后的撤销、导出快照范围保留、未变化图集复用及原文件保护");
    }
}
