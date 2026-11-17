package io.github.litematicrender.schematic;

import io.github.litematicrender.nbt.*;
import io.github.litematicrender.nbt.io.NbtFileUtils;
import java.nio.file.*;
import java.util.*;

/** NBT 采用写时复制，保留未知状态、实体和未修改区域数据。 */
public final class ProjectionEdits {
    private NbtCompound root;
    private final LinkedHashSet<io.github.litematicrender.world.Vec3i> touched=new LinkedHashSet<>();
    private boolean bulkPreview;
    public NbtCompound data(){return root;}
    public boolean requiresRebuild(){return bulkPreview||touched.size()>2048;}
    public List<io.github.litematicrender.world.Vec3i> previewCells(){if(bulkPreview)return List.of();var cells=new LinkedHashSet<io.github.litematicrender.world.Vec3i>();for(var p:touched)for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++)cells.add(new io.github.litematicrender.world.Vec3i(p.x()+x,p.y()+y,p.z()+z));return List.copyOf(cells);}
    public void clearPreview(){touched.clear();bulkPreview=false;}
    // 每条历史记录同时保存受影响坐标，重建清空预览后，撤销仍能正确补画联动位置。
    public void squash(Checkpoint before,boolean changed){
        if(!changed)return;var positions=new LinkedHashSet<io.github.litematicrender.world.Vec3i>();boolean bulk=false;
        for(var frame:undo){bulk|=frame.bulk();if(!bulk)positions.addAll(frame.positions());if(frame.root()==before.root())break;}
        undo.clear();undo.addAll(before.undo());undo.push(new Frame(before.root(),bulk?Set.of():Set.copyOf(positions),bulk));if(undo.size()>40)undo.removeLast();redo.clear();
    }

    public record Frame(NbtCompound root,Set<io.github.litematicrender.world.Vec3i> positions,boolean bulk){
        public Frame(NbtCompound root,Set<io.github.litematicrender.world.Vec3i> positions){this(root,positions,false);}
    }
    private final ArrayDeque<Frame> undo=new ArrayDeque<>(),redo=new ArrayDeque<>();
    public final Path source;
    public record Checkpoint(NbtCompound root,ArrayDeque<Frame> undo,ArrayDeque<Frame> redo,Set<io.github.litematicrender.world.Vec3i> touched,boolean bulkPreview){}
    public Checkpoint checkpoint(){return new Checkpoint(root,new ArrayDeque<>(undo),new ArrayDeque<>(redo),Set.copyOf(touched),bulkPreview);}
    public void restore(Checkpoint saved){root=saved.root();undo.clear();undo.addAll(saved.undo());redo.clear();redo.addAll(saved.redo());touched.clear();touched.addAll(saved.touched());bulkPreview=saved.bulkPreview();}
    public ProjectionEdits(Path source)throws Exception{this.source=source;root=SchematicFormats.read(source);}
    private static NbtCompound copy(NbtCompound value){return (NbtCompound)value.copy();}
    private static NbtList listCopy(NbtList list){var out=new NbtList();for(int i=0;i<list.size();i++)out.add(list.get(i));return out;}
    private static NbtCompound pos(int x,int y,int z){return new NbtCompound().putInt("x",x).putInt("y",y).putInt("z",z);}
    private static PackedLongArray storage(NbtCompound region){var tag=region.get("BlockStates").orElseThrow();return tag instanceof NbtPackedLongArray p?p.value:PackedLongArray.wrap(((NbtScalars.NbtLongArray)tag).value);}
    private static int bits(int count){return Math.max(2,32-Integer.numberOfLeadingZeros(Math.max(1,count-1)));}
    private static int[] local(NbtCompound region,int[] xyz){
        var p=SubRegion.readBlockPos(region,"Position");var s=SubRegion.readBlockPos(region,"Size");int[] size={Math.abs(s.x()),Math.abs(s.y()),Math.abs(s.z())};
        int[] at={xyz[0]-p.x()-Math.min(0,s.x()+1),xyz[1]-p.y()-Math.min(0,s.y()+1),xyz[2]-p.z()-Math.min(0,s.z()+1)};
        for(int i=0;i<3;i++)if(at[i]<0||at[i]>=size[i])return null;return at;
    }
    public NbtCompound state(int[] xyz){
        var regions=root.getCompound("Regions").orElseThrow();NbtCompound found=null;
        for(String key:regions.getKeys()){var region=regions.getCompound(key).orElse(null);if(region==null)continue;int[] p=local(region,xyz);if(p==null)continue;var s=SubRegion.readBlockPos(region,"Size");var palette=region.getList("BlockStatePalette").orElseThrow();long index=((long)p[1]*Math.abs(s.z())+p[2])*Math.abs(s.x())+p[0];int id=LitematicaSchematic.getAt(storage(region),bits(palette.size()),index);if(id<palette.size())found=(NbtCompound)palette.get(id);}
        return found==null?new NbtCompound().putString("Name","minecraft:air"):found;
    }
    private static void setWords(Map<Integer,Long> changes,PackedLongArray words,int bits,long index,long value){
        long offset=index*bits;int word=(int)(offset>>>6),shift=(int)(offset&63);long mask=(1L<<bits)-1;
        changes.put(word,(changes.getOrDefault(word,words.get(word))&~(mask<<shift))|(value<<shift));
        if(shift+bits>64){int carry=64-shift;changes.put(word+1,(changes.getOrDefault(word+1,words.get(word+1))&~(mask>>>carry))|(value>>>carry));}
    }
    private static boolean air(NbtCompound state){String id=LitematicaSchematic.readBlockState(state).blockId();return Set.of("minecraft:air","minecraft:cave_air","minecraft:void_air").contains(id);}
    private static NbtCompound updateRegion(NbtCompound input,int[] xyz,NbtCompound value){
        var region=copy(input);var palette=listCopy(input.getList("BlockStatePalette").orElseThrow());var old=storage(input);int oldBits=bits(palette.size()),id=-1;
        var raw=LitematicaSchematic.readBlockState(value);for(int i=0;i<palette.size();i++)if(LitematicaSchematic.readBlockState((NbtCompound)palette.get(i)).equals(raw)){id=i;break;}
        if(id<0){id=palette.size();palette.add(value);}int newBits=bits(palette.size());var size=SubRegion.readBlockPos(input,"Size");int[] at=local(input,xyz);long volume=(long)Math.abs(size.x())*Math.abs(size.y())*Math.abs(size.z()),index=((long)at[1]*Math.abs(size.z())+at[2])*Math.abs(size.x())+at[0];
        int previous=LitematicaSchematic.getAt(old,oldBits,index);var previousState=LitematicaSchematic.readBlockState((NbtCompound)palette.get(previous));
        PackedLongArray words=old;
        if(oldBits!=newBits){long length=(volume*newBits+63)/64;if(length>Integer.MAX_VALUE)throw new IllegalArgumentException("区域过大，无法扩展方块调色板");long[] repacked=new long[(int)length];for(long i=0;i<volume;i++){long v=LitematicaSchematic.getAt(old,oldBits,i),offset=i*newBits;int w=(int)(offset>>>6),b=(int)(offset&63);repacked[w]|=v<<b;if(b+newBits>64)repacked[w+1]|=v>>>(64-b);}words=PackedLongArray.wrap(repacked);}
        var changes=new HashMap<Integer,Long>();setWords(changes,words,newBits,index,id);region.put("BlockStates",new NbtPackedLongArray(words.withWords(changes))).put("BlockStatePalette",palette);
        // 同类型状态修改保留容器内容，替换或删除则清理旧数据。
        if(!previousState.blockId().equals(raw.blockId()))for(String key:List.of("TileEntities","PendingBlockTicks","PendingFluidTicks")){
            var list=input.getList(key).orElse(null);if(list==null)continue;var filtered=new NbtList();for(int i=0;i<list.size();i++){var item=list.get(i);if(item instanceof NbtCompound c&&c.getIntOrDefault("x",Integer.MIN_VALUE)==at[0]&&c.getIntOrDefault("y",Integer.MIN_VALUE)==at[1]&&c.getIntOrDefault("z",Integer.MIN_VALUE)==at[2])continue;filtered.add(item);}region.put(key,filtered);
        }
        if(!previousState.blockId().equals(raw.blockId())){
            String blockId=raw.blockId(),kind=blockId.substring(blockId.indexOf(':')+1);boolean inventory=Set.of("chest","trapped_chest","barrel","hopper","dispenser","dropper","furnace","blast_furnace","smoker","brewing_stand","crafter").contains(kind)||kind.endsWith("shulker_box");
            if(inventory){var list=listCopy(region.getList("TileEntities").orElse(new NbtList()));String entityId=blockId.equals("minecraft:trapped_chest")?"minecraft:chest":kind.endsWith("shulker_box")?"minecraft:shulker_box":blockId;list.add(new NbtCompound().putInt("x",at[0]).putInt("y",at[1]).putInt("z",at[2]).putString("id",entityId).put("Items",new NbtList()));region.put("TileEntities",list);}
        }
        return region;
    }
    public boolean set(int[] xyz,NbtCompound value){
        var before=state(xyz);if(LitematicaSchematic.readBlockState(before).equals(LitematicaSchematic.readBlockState(value)))return false;
        var next=copy(root);var regions=copy(root.getCompound("Regions").orElseThrow());var targets=new ArrayList<String>();
        for(String key:regions.getKeys()){var region=regions.getCompound(key).orElse(null);if(region!=null&&local(region,xyz)!=null)targets.add(key);}
        if(targets.isEmpty()){
            int x=xyz[0],y=xyz[1],z=xyz[2];String name="LiteKinda 编辑 "+x+","+y+","+z;while(regions.contains(name))name+="_";
            var palette=new NbtList();palette.add(new NbtCompound().putString("Name","minecraft:air"));regions.put(name,new NbtCompound().put("Position",pos(x,y,z)).put("Size",pos(1,1,1)).put("BlockStatePalette",palette).putLongArray("BlockStates",new long[1]).put("Entities",new NbtList()).put("TileEntities",new NbtList()));targets.add(name);
        }
        long delta=0;
        for(int i=0;i<targets.size();i++){String key=targets.get(i);var region=regions.getCompound(key).orElseThrow();var p=local(region,xyz);var size=SubRegion.readBlockPos(region,"Size");var palette=region.getList("BlockStatePalette").orElseThrow();long index=((long)p[1]*Math.abs(size.z())+p[2])*Math.abs(size.x())+p[0];var prev=(NbtCompound)palette.get(LitematicaSchematic.getAt(storage(region),bits(palette.size()),index));var replacement=i==targets.size()-1?value:new NbtCompound().putString("Name","minecraft:air");delta+=(air(replacement)?0:1)-(air(prev)?0:1);regions.put(key,updateRegion(region,xyz,replacement));}
        next.put("Regions",regions);var metadata=copy(root.getCompoundOrDefault("Metadata",new NbtCompound()));metadata.putInt("TotalBlocks",(int)Math.max(0,metadata.getIntOrDefault("TotalBlocks",0)+delta)).putString("Author","LiteKinda").putLong("TimeModified",System.currentTimeMillis()).putInt("RegionCount",regions.size());
        int[] lo={Integer.MAX_VALUE,Integer.MAX_VALUE,Integer.MAX_VALUE},hi={Integer.MIN_VALUE,Integer.MIN_VALUE,Integer.MIN_VALUE};long volume=0;
        for(String key:regions.getKeys()){var r=regions.getCompound(key).orElse(null);if(r==null)continue;var p=SubRegion.readBlockPos(r,"Position");var s=SubRegion.readBlockPos(r,"Size");int[] a={p.x(),p.y(),p.z()},b={p.x()+s.x()-Integer.signum(s.x()),p.y()+s.y()-Integer.signum(s.y()),p.z()+s.z()-Integer.signum(s.z())};for(int j=0;j<3;j++){lo[j]=Math.min(lo[j],Math.min(a[j],b[j]));hi[j]=Math.max(hi[j],Math.max(a[j],b[j]));}volume+=(long)Math.abs(s.x())*Math.abs(s.y())*Math.abs(s.z());}
        metadata.put("EnclosingSize",pos(hi[0]-lo[0]+1,hi[1]-lo[1]+1,hi[2]-lo[2]+1)).putInt("TotalVolume",(int)Math.min(Integer.MAX_VALUE,volume));next.put("Metadata",metadata);var position=new io.github.litematicrender.world.Vec3i(xyz[0],xyz[1],xyz[2]);undo.push(new Frame(root,Set.of(position)));if(undo.size()>40)undo.removeLast();redo.clear();root=next;touched.add(position);return true;
    }
    private static boolean isInventoryBlock(String blockId){
        String kind=blockId.substring(blockId.indexOf(':')+1);
        return Set.of("chest","trapped_chest","barrel","hopper","dispenser","dropper","furnace","blast_furnace","smoker","brewing_stand","crafter").contains(kind)||kind.endsWith("shulker_box");
    }
    private static String containerEntityId(String blockId){
        String kind=blockId.substring(blockId.indexOf(':')+1);
        return blockId.equals("minecraft:trapped_chest")?"minecraft:chest":kind.endsWith("shulker_box")?"minecraft:shulker_box":blockId;
    }
    private static int ensurePaletteId(NbtList palette,NbtCompound value,UnresolvedBlockState parsed){
        for(int i=0;i<palette.size();i++)if(LitematicaSchematic.readBlockState((NbtCompound)palette.get(i)).equals(parsed))return i;
        int id=palette.size();palette.add(value);return id;
    }
    private static List<int[]> subtractBox(List<int[]> boxes,int[] cutter){
        List<int[]> next=new ArrayList<>(boxes.size());
        for(int[] b:boxes){
            if(cutter[0]>=b[3]||cutter[3]<=b[0]||cutter[1]>=b[4]||cutter[4]<=b[1]||cutter[2]>=b[5]||cutter[5]<=b[2]){next.add(b);continue;}
            if(b[0]<cutter[0])next.add(new int[]{b[0],b[1],b[2],cutter[0],b[4],b[5]});
            if(cutter[3]<b[3])next.add(new int[]{cutter[3],b[1],b[2],b[3],b[4],b[5]});
            int x0=Math.max(b[0],cutter[0]),x1=Math.min(b[3],cutter[3]);
            if(b[1]<cutter[1])next.add(new int[]{x0,b[1],b[2],x1,cutter[1],b[5]});
            if(cutter[4]<b[4])next.add(new int[]{x0,cutter[4],b[2],x1,b[4],b[5]});
            int y0=Math.max(b[1],cutter[1]),y1=Math.min(b[4],cutter[4]);
            if(b[2]<cutter[2])next.add(new int[]{x0,y0,b[2],x1,y1,cutter[2]});
            if(cutter[5]<b[5])next.add(new int[]{x0,y0,cutter[5],x1,y1,b[5]});
        }
        return next;
    }
    private static void repackIfNeeded(NbtCompound region,NbtCompound input,PackedLongArray words,NbtList palette,Map<Integer,Long> changes,Set<io.github.litematicrender.world.Vec3i> clearedTiles,List<io.github.litematicrender.world.Vec3i> addedTiles,String entityId){
        region.put("BlockStates",new NbtPackedLongArray(words.withWords(changes))).put("BlockStatePalette",palette);
        if(!clearedTiles.isEmpty())for(String listKey:List.of("TileEntities","PendingBlockTicks","PendingFluidTicks")){
            var list=input.getList(listKey).orElse(null);if(list==null)continue;var filtered=new NbtList();
            for(int i=0;i<list.size();i++){var item=list.get(i);if(item instanceof NbtCompound c&&clearedTiles.contains(new io.github.litematicrender.world.Vec3i(c.getIntOrDefault("x",Integer.MIN_VALUE),c.getIntOrDefault("y",Integer.MIN_VALUE),c.getIntOrDefault("z",Integer.MIN_VALUE))))continue;filtered.add(item);}
            region.put(listKey,filtered);
        }
        if(!addedTiles.isEmpty()){
            var list=listCopy(region.getList("TileEntities").orElse(new NbtList()));
            for(var lp:addedTiles)list.add(new NbtCompound().putInt("x",lp.x()).putInt("y",lp.y()).putInt("z",lp.z()).putString("id",entityId).put("Items",new NbtList()));
            region.put("TileEntities",list);
        }
    }
    /** 批量填充或替换三维半开区间 [min, max)，单次记入撤销历史栈。 */
    public int fillRegion(int[] min,int[] max,NbtCompound value,java.util.function.Predicate<String> matchBlockId){
        for(int a=0;a<3;a++)if(min[a]>=max[a]||Math.abs(min[a])>30000001||Math.abs(max[a])>30000001)throw new IllegalArgumentException("无效的选区坐标范围");
        var next=copy(root);var regions=copy(root.getCompound("Regions").orElseThrow());
        var regionKeys=new ArrayList<>(regions.getKeys());var boxes=new ArrayList<int[]>();
        for(String key:regionKeys){
            var r=regions.getCompound(key).orElse(null);if(r==null){boxes.add(null);continue;}
            var p=SubRegion.readBlockPos(r,"Position");var s=SubRegion.readBlockPos(r,"Size");
            int rx0=p.x()+Math.min(0,s.x()+1),ry0=p.y()+Math.min(0,s.y()+1),rz0=p.z()+Math.min(0,s.z()+1);
            boxes.add(new int[]{rx0,ry0,rz0,rx0+Math.abs(s.x()),ry0+Math.abs(s.y()),rz0+Math.abs(s.z())});
        }
        var targetParsed=LitematicaSchematic.readBlockState(value);
        boolean targetAir=air(value),targetInv=!targetAir&&isInventoryBlock(targetParsed.blockId());
        var rawAir=new NbtCompound().putString("Name","minecraft:air");var airParsed=LitematicaSchematic.readBlockState(rawAir);
        int changed=0;long delta=0;boolean bulk=false;
        var previewPositions=new LinkedHashSet<io.github.litematicrender.world.Vec3i>();

        for(int ri=0;ri<regionKeys.size();ri++){
            int[] rb=boxes.get(ri);if(rb==null)continue;
            int ix0=Math.max(min[0],rb[0]),iy0=Math.max(min[1],rb[1]),iz0=Math.max(min[2],rb[2]);
            int ix1=Math.min(max[0],rb[3]),iy1=Math.min(max[1],rb[4]),iz1=Math.min(max[2],rb[5]);
            if(ix0>=ix1||iy0>=iy1||iz0>=iz1)continue;
            if((long)(ix1-ix0)*(iy1-iy0)*(iz1-iz0)>4_000_000L)throw new IllegalArgumentException("选区范围过大（单次编辑上限 4,000,000 格）");
            String key=regionKeys.get(ri);var input=regions.getCompound(key).orElseThrow();
            var region=copy(input);var palette=listCopy(input.getList("BlockStatePalette").orElseThrow());
            var old=storage(input);int oldBits=bits(palette.size());
            int sx=rb[3]-rb[0],sy=rb[4]-rb[1],sz=rb[5]-rb[2];long volume=(long)sx*sy*sz;
            var oldParsed=new UnresolvedBlockState[palette.size()];
            for(int i=0;i<palette.size();i++)oldParsed[i]=LitematicaSchematic.readBlockState((NbtCompound)palette.get(i));
            var laterBoxes=new ArrayList<int[]>();
            if(matchBlockId==null)for(int rj=ri+1;rj<boxes.size();rj++){int[] b2=boxes.get(rj);if(b2!=null&&b2[0]<ix1&&b2[3]>ix0&&b2[1]<iy1&&b2[4]>iy0&&b2[2]<iz1&&b2[5]>iz0)laterBoxes.add(b2);}
            int targetId=-1,airId=-1;
            for(int y=iy0;y<iy1;y++)for(int z=iz0;z<iz1;z++)for(int x=ix0;x<ix1;x++){
                var prev=oldParsed[LitematicaSchematic.getAt(old,oldBits,((long)(y-rb[1])*sz+(z-rb[2]))*sx+(x-rb[0]))];
                if(matchBlockId!=null&&!matchBlockId.test(prev.blockId()))continue;
                boolean shadowed=false;for(int[] b2:laterBoxes)if(x>=b2[0]&&x<b2[3]&&y>=b2[1]&&y<b2[4]&&z>=b2[2]&&z<b2[5]){shadowed=true;break;}
                if(prev.equals(shadowed?airParsed:targetParsed))continue;
                if(shadowed){if(airId<0)airId=ensurePaletteId(palette,rawAir,airParsed);}else if(targetId<0)targetId=ensurePaletteId(palette,value,targetParsed);
            }
            if(targetId<0&&airId<0)continue;
            int newBits=bits(palette.size());PackedLongArray words=old;
            if(oldBits!=newBits){long length=(volume*newBits+63)/64;if(length>Integer.MAX_VALUE)throw new IllegalArgumentException("区域过大，无法扩展方块调色板");long[] repacked=new long[(int)length];for(long i=0;i<volume;i++){long v=LitematicaSchematic.getAt(old,oldBits,i),offset=i*newBits;int w=(int)(offset>>>6),b=(int)(offset&63);repacked[w]|=v<<b;if(b+newBits>64)repacked[w+1]|=v>>>(64-b);}words=PackedLongArray.wrap(repacked);}
            var wordChanges=new HashMap<Integer,Long>();var clearedTiles=new HashSet<io.github.litematicrender.world.Vec3i>();var addedTiles=new ArrayList<io.github.litematicrender.world.Vec3i>();
            for(int y=iy0;y<iy1;y++)for(int z=iz0;z<iz1;z++)for(int x=ix0;x<ix1;x++){
                int lx=x-rb[0],ly=y-rb[1],lz=z-rb[2];long idx=((long)ly*sz+lz)*sx+lx;
                var prev=oldParsed[LitematicaSchematic.getAt(old,oldBits,idx)];
                if(matchBlockId!=null&&!matchBlockId.test(prev.blockId()))continue;
                boolean shadowed=false;for(int[] b2:laterBoxes)if(x>=b2[0]&&x<b2[3]&&y>=b2[1]&&y<b2[4]&&z>=b2[2]&&z<b2[5]){shadowed=true;break;}
                var want=shadowed?airParsed:targetParsed;if(prev.equals(want))continue;
                setWords(wordChanges,words,newBits,idx,shadowed?airId:targetId);
                boolean prevAir=Set.of("minecraft:air","minecraft:cave_air","minecraft:void_air").contains(prev.blockId());
                delta+=((shadowed||targetAir)?0:1)-(prevAir?0:1);changed++;
                if(!prev.blockId().equals(want.blockId())){var lp=new io.github.litematicrender.world.Vec3i(lx,ly,lz);clearedTiles.add(lp);if(!shadowed&&targetInv)addedTiles.add(lp);}
                if(!bulk){if(changed<=1024)previewPositions.add(new io.github.litematicrender.world.Vec3i(x,y,z));else{bulk=true;previewPositions.clear();}}
            }
            if(!wordChanges.isEmpty()||oldBits!=newBits){
                repackIfNeeded(region,input,words,palette,wordChanges,clearedTiles,addedTiles,containerEntityId(targetParsed.blockId()));
                regions.put(key,region);
            }
        }
        if(matchBlockId==null&&!targetAir){
            List<int[]> uncovered=new ArrayList<>();uncovered.add(new int[]{min[0],min[1],min[2],max[0],max[1],max[2]});
            for(int[] rb:boxes)if(rb!=null&&!uncovered.isEmpty())uncovered=subtractBox(uncovered,rb);
            long uncoveredVol=0;for(int[] b:uncovered)uncoveredVol+=(long)(b[3]-b[0])*(b[4]-b[1])*(b[5]-b[2]);
            if(uncoveredVol>500_000L)throw new IllegalArgumentException("选区超出已有投影区域过多（新增空白区域上限 500,000 格）");
            for(int[] b:uncovered){
                int sx=b[3]-b[0],sy=b[4]-b[1],sz=b[5]-b[2];long vol=(long)sx*sy*sz;if(vol<=0)continue;
                String name="LiteKinda 批量 "+b[0]+","+b[1]+","+b[2];while(regions.contains(name))name+="_";
                var pal=new NbtList();pal.add(copy(rawAir));pal.add(copy(value));
                long[] packed=new long[(int)((vol*2+63)/64)];Arrays.fill(packed,0x5555555555555555L);
                int excess=(int)(vol*2%64);if(excess!=0)packed[packed.length-1]&=((1L<<excess)-1);
                var tiles=new NbtList();
                if(targetInv){String entityId=containerEntityId(targetParsed.blockId());for(int ly=0;ly<sy;ly++)for(int lz=0;lz<sz;lz++)for(int lx=0;lx<sx;lx++)tiles.add(new NbtCompound().putInt("x",lx).putInt("y",ly).putInt("z",lz).putString("id",entityId).put("Items",new NbtList()));}
                regions.put(name,new NbtCompound().put("Position",pos(b[0],b[1],b[2])).put("Size",pos(sx,sy,sz)).put("BlockStatePalette",pal).putLongArray("BlockStates",packed).put("Entities",new NbtList()).put("TileEntities",tiles));
                delta+=vol;changed+=(int)vol;
                if(!bulk){if(changed<=1024){for(int z=b[2];z<b[5];z++)for(int y=b[1];y<b[4];y++)for(int x=b[0];x<b[3];x++)previewPositions.add(new io.github.litematicrender.world.Vec3i(x,y,z));}else{bulk=true;previewPositions.clear();}}
            }
        }
        if(changed==0)return 0;
        next.put("Regions",regions);var metadata=copy(root.getCompoundOrDefault("Metadata",new NbtCompound()));metadata.putInt("TotalBlocks",(int)Math.max(0,metadata.getIntOrDefault("TotalBlocks",0)+delta)).putString("Author","LiteKinda").putLong("TimeModified",System.currentTimeMillis()).putInt("RegionCount",regions.size());
        int[] lo={Integer.MAX_VALUE,Integer.MAX_VALUE,Integer.MAX_VALUE},hi={Integer.MIN_VALUE,Integer.MIN_VALUE,Integer.MIN_VALUE};long totalVol=0;
        for(String key:regions.getKeys()){var r=regions.getCompound(key).orElse(null);if(r==null)continue;var p=SubRegion.readBlockPos(r,"Position");var s=SubRegion.readBlockPos(r,"Size");int[] a={p.x(),p.y(),p.z()},b={p.x()+s.x()-Integer.signum(s.x()),p.y()+s.y()-Integer.signum(s.y()),p.z()+s.z()-Integer.signum(s.z())};for(int j=0;j<3;j++){lo[j]=Math.min(lo[j],Math.min(a[j],b[j]));hi[j]=Math.max(hi[j],Math.max(a[j],b[j]));}totalVol+=(long)Math.abs(s.x())*Math.abs(s.y())*Math.abs(s.z());}
        metadata.put("EnclosingSize",pos(hi[0]-lo[0]+1,hi[1]-lo[1]+1,hi[2]-lo[2]+1)).putInt("TotalVolume",(int)Math.min(Integer.MAX_VALUE,totalVol));next.put("Metadata",metadata);
        undo.push(new Frame(root,bulk?Set.of():Set.copyOf(previewPositions),bulk));if(undo.size()>40)undo.removeLast();redo.clear();root=next;
        if(bulk)bulkPreview=true;else touched.addAll(previewPositions);
        return changed;
    }
    public boolean undo(){if(undo.isEmpty())return false;var frame=undo.pop();redo.push(new Frame(root,frame.positions(),frame.bulk()));root=frame.root();if(frame.bulk())bulkPreview=true;else touched.addAll(frame.positions());return true;}
    public boolean redo(){if(redo.isEmpty())return false;var frame=redo.pop();undo.push(new Frame(root,frame.positions(),frame.bulk()));root=frame.root();if(frame.bulk())bulkPreview=true;else touched.addAll(frame.positions());return true;}
    public Map<String,Object> status(){return Map.of("undo",undo.size(),"redo",redo.size(),"source",source.toAbsolutePath().toString());}
    public void write(Path target)throws Exception{
        var output=copy(root);var metadata=copy(root.getCompoundOrDefault("Metadata",new NbtCompound()));metadata.putString("Author","LiteKinda").putLong("TimeModified",System.currentTimeMillis());output.put("Metadata",metadata);
        target=target.toAbsolutePath();Files.createDirectories(target.getParent());Path temp=Files.createTempFile(target.getParent(),"projection-edit-",".tmp");try{NbtFileUtils.writeCompressed(temp,output);try{Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);}}finally{Files.deleteIfExists(temp);}
    }
}
