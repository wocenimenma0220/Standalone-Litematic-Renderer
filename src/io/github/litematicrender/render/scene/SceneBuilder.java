package io.github.litematicrender.render.scene;

import io.github.litematicrender.model.ModelBaker;
import io.github.litematicrender.model.Quad;
import io.github.litematicrender.render.Colormaps;
import io.github.litematicrender.render.SpriteAtlas;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.world.BlockRegistry;
import io.github.litematicrender.world.BlockShape;
import io.github.litematicrender.world.BlockState;

import java.util.ArrayList;
import java.util.List;

/** 从投影构建场景，参考原版方块、环境光和流体渲染规则。 */
public final class SceneBuilder implements io.github.litematicrender.render.StreamMeshExporter.Source {
    private OverviewMesh overview;
    private java.util.function.Consumer<String> preparationProgress=stage->{};
    public SceneBuilder preparationProgress(java.util.function.Consumer<String> progress){this.preparationProgress=progress;return this;}
    public SceneBuilder overview(OverviewMesh value){this.overview=value;return this;}
    @Override public SceneMesh coarseSection(SectionVisibility.Position position){return overview==null?null:overview.buildSection(position);}
    /** 原版方向光权重：下 0.5、上 1.0、南北 0.8、东西 0.6。 */
    public static final float[] CARDINAL = {0.5f, 1.0f, 0.8f, 0.8f, 0.6f, 0.6f};

    private static final int[][] FACE_DELTAS = {
        {0,-1,0},{0,1,0},{0,0,-1},{0,0,1},{-1,0,0},{1,0,0}
    };


    private void faceLightColor(int x, int y, int z, int face, float[] out) {
        cachedLightColor(x,y,z,face,out);
    }
    private boolean lightCacheReady;
    private int lightX,lightY,lightZ,lightValid;
    private final float[][] faceLights=new float[7][3];
    private void cachedLightColor(int x,int y,int z,int face,float[] out) {
        if (this.light == null) { out[0] = out[1] = out[2] = 1f; return; }
        if(!lightCacheReady||x!=lightX||y!=lightY||z!=lightZ){lightCacheReady=true;lightX=x;lightY=y;lightZ=z;lightValid=0;}
        int key=face<0?6:face;
        if((lightValid&(1<<key))==0) {
            int lx=x-this.lightOrigin[0],ly=y-this.lightOrigin[1],lz=z-this.lightOrigin[2],packed;
            if(face<0)packed=activeLight().cellLight(lx,ly,lz);
            else{int[] direction=FACE_DELTAS[face];packed=activeLight().faceLight(lx,ly,lz,direction[0],direction[1],direction[2]);}
            LightVolume.brightness(packed,faceLights[key]);lightValid|=1<<key;
        }
        System.arraycopy(faceLights[key],0,out,0,3);
    }

    private final BlockRegistry registry;
    private final ModelBaker baker;
    private final Colormaps colormaps;
    private final SpriteAtlas atlas;
    private final BlockShape shapes;
    private boolean realLighting;
    private boolean lightingEnabled=true;
    public SceneBuilder lightingEnabled(boolean enabled){this.lightingEnabled=enabled;return this;}
    private SmoothLighting smoothLighting;

    public SceneBuilder realLighting(boolean enabled) { this.realLighting=enabled; return this; }


    private final List<LitematicaSchematic.Region> regions = new ArrayList<>();
    private final List<int[]> regionOffsets = new ArrayList<>();
    private final java.util.Map<BlockState,List<Quad>> redstoneSurfaces=new java.util.HashMap<>();

    public SceneBuilder(BlockRegistry registry, ModelBaker baker, Colormaps colormaps, SpriteAtlas atlas) {
        this.registry = registry;
        this.baker = baker;
        this.colormaps = colormaps;
        this.atlas = atlas;
        this.shapes = new BlockShape(baker, atlas);
    }

    public void addRegion(LitematicaSchematic.Region region, int[] worldOffset) {
        occupiedSections=null;spriteSections.clear();redstoneStates.clear();
        this.regions.add(region);
        this.regionOffsets.add(worldOffset);
        this.regionIndex=null;
    }

    /** 跨所有区域查询世界方块，投影外按空气处理。 */
    private BlockState[] sectionBlocks;
    private boolean sectionBlocksReady;
    private int sectionBlockX,sectionBlockY,sectionBlockZ;
    public BlockState blockAt(int x, int y, int z) {
        if(sectionBlocksReady){int dx=x-sectionBlockX,dy=y-sectionBlockY,dz=z-sectionBlockZ;if(dx>=0&&dy>=0&&dz>=0&&dx<18&&dy<18&&dz<18)return sectionBlocks[(dy*18+dz)*18+dx];}
        return lookupBlock(x,y,z);
    }
    private BlockState lookupBlock(int x,int y,int z) {
        if(selectionMin!=null&&!selectionContains(x,y,z))return BlockState.air();
        var candidates=this.regionIndex==null?null:this.regionIndex.get(new Section(Math.floorDiv(x,16),Math.floorDiv(y,16),Math.floorDiv(z,16)));
        if(this.regionIndex!=null && candidates==null)return BlockState.air();
        int count=candidates==null?this.regions.size():candidates.size();
        for (int candidate = 0; candidate < count; candidate++) {
            int i=candidates==null?candidate:candidates.get(candidate);
            int[] off = this.regionOffsets.get(i);
            LitematicaSchematic.Region r = this.regions.get(i);
            int lx = x - off[0], ly = y - off[1], lz = z - off[2];
            if (lx >= 0 && ly >= 0 && lz >= 0 && lx < r.blocks.sizeX && ly < r.blocks.sizeY && lz < r.blocks.sizeZ) {
                return r.blocks.get(lx, ly, lz);
            }
        }
        return BlockState.air();
    }
    /** 有界邻域缓存减少 AO、流体和邻面剔除时的重复解压。 */
    private void cacheSectionBlocks(SectionVisibility.Position key) {
        sectionBlocksReady=false;
        long x=(long)key.x()*16-1,y=(long)key.y()*16-1,z=(long)key.z()*16-1;
        if(x<Integer.MIN_VALUE||y<Integer.MIN_VALUE||z<Integer.MIN_VALUE||x>Integer.MAX_VALUE-17||y>Integer.MAX_VALUE-17||z>Integer.MAX_VALUE-17)return;
        sectionBlockX=(int)x;sectionBlockY=(int)y;sectionBlockZ=(int)z;
        if(sectionBlocks==null)sectionBlocks=new BlockState[18*18*18];
        for(int dy=0;dy<18;dy++)for(int dz=0;dz<18;dz++)for(int dx=0;dx<18;dx++)sectionBlocks[(dy*18+dz)*18+dx]=lookupBlock(sectionBlockX+dx,sectionBlockY+dy,sectionBlockZ+dz);
        sectionBlocksReady=true;
    }

    // ------------------------------------------------------------------


    /** 邻居完整遮挡，或两个方块应合并表面时，剔除共享面。 */
    private boolean shouldRenderFace(BlockState state, int face, int x, int y, int z) {
        int[] d = FACE_DELTAS[face];
        BlockState neighbor = this.blockAt(x + d[0], y + d[1], z + d[2]);
        if (neighbor.isAir()) return true;
        if (this.shapes.occludes(neighbor)) return false;
        if (MERGING.contains(state.blockId) && neighbor.blockId.equals(state.blockId)) return false;
        return true;
    }

    /** 同类玻璃、冰、黏液和蜂蜜按原版规则合并相邻表面。 */
    private static final java.util.Set<String> MERGING = java.util.Set.of(
        "minecraft:glass", "minecraft:tinted_glass", "minecraft:ice", "minecraft:frosted_ice",
        "minecraft:slime_block", "minecraft:honey_block",
        "minecraft:white_stained_glass", "minecraft:orange_stained_glass",
        "minecraft:magenta_stained_glass", "minecraft:light_blue_stained_glass",
        "minecraft:yellow_stained_glass", "minecraft:lime_stained_glass",
        "minecraft:pink_stained_glass", "minecraft:gray_stained_glass",
        "minecraft:light_gray_stained_glass", "minecraft:cyan_stained_glass",
        "minecraft:purple_stained_glass", "minecraft:blue_stained_glass",
        "minecraft:brown_stained_glass", "minecraft:green_stained_glass",
        "minecraft:red_stained_glass", "minecraft:black_stained_glass"
    );

    // ------------------------------------------------------------------


    private boolean prepared,streaming,registeringSprites;
    public SceneBuilder skinSnapshot(io.github.litematicrender.render.skin.SkinResolver snapshot){if(prepared)throw new IllegalStateException("Scene already prepared");this.skins=snapshot;return this;}
    private SectionVisibility.Position range;
    private int rangeSize=16;
    private final java.util.List<java.util.Map<SectionVisibility.Position,java.util.List<Integer>>> entitySections=new java.util.ArrayList<>();
    private void prepare() {
        if(prepared)return;
        this.generatedSprites.clear();this.redstoneSurfaces.clear();this.lightCacheReady=false;this.aoState=null;
        preparationProgress.accept("skins");this.prepareSkins();
        // 光照必须先于面片生成完成，因为每个面都需要采样光照。
        preparationProgress.accept("indexing");this.buildRegionIndex();
        if(lightingEnabled)preparationProgress.accept("lighting");this.computeLight();
        if(this.light!=null)this.smoothLighting=new SmoothLighting(this.light,this.lightOrigin,this::blockAt,this.shapes);
        for(int ri=0;ri<regions.size();ri++) {
            var region=regions.get(ri);var off=regionOffsets.get(ri);var origin=region.blockOrigin();
            var map=new java.util.HashMap<SectionVisibility.Position,java.util.List<Integer>>();
            for(int i=0;i<region.entities.size();i++) {
                var e=region.entities.get(i);
                var key=section(off[0]+region.position.x()-origin.x()+e.x(),off[1]+region.position.y()-origin.y()+e.y(),off[2]+region.position.z()-origin.z()+e.z());
                map.computeIfAbsent(key,k->new java.util.ArrayList<>()).add(i);
            }
            entitySections.add(map);
        }
        prepared=true;
    }
    private static SectionVisibility.Position section(double x,double y,double z) {
        return new SectionVisibility.Position((int)Math.floor(x/16),(int)Math.floor(y/16),(int)Math.floor(z/16));
    }
    @Override public int buildUnitSections(){return Integer.getInteger("litematicrender.mesh.buildUnit",16)>=32?2:1;}
    @Override public int sectionWorkers() {
        if(buildUnitSections()>1)return 1;
        int requested=Integer.getInteger("litematicrender.mesh.workers",Math.min(4,Math.max(1,Runtime.getRuntime().availableProcessors()-1)));
        long available=Runtime.getRuntime().maxMemory()-(Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory());
        int memoryLimit=(int)Math.max(1,(available-128L*1024*1024)/(128L*1024*1024));
        return Math.max(1,Math.min(Math.min(4,requested),memoryLimit));
    }
    @Override public SceneBuilder forkForSections() {
        if(!prepared||!streaming)throw new IllegalStateException("Complete lighting and atlas preparation before forking");
        var worker=new SceneBuilder(registry,baker.fork(),colormaps,atlas).realLighting(realLighting).lightingEnabled(lightingEnabled);
        worker.regions.addAll(regions);worker.regionOffsets.addAll(regionOffsets);worker.regionIndex=regionIndex;
        worker.entitySections.addAll(entitySections);worker.occupiedSections=occupiedSections;
        worker.skins=skins;worker.font=font;worker.generatedSprites.putAll(generatedSprites);worker.redstoneSurfaces.putAll(redstoneSurfaces);
        worker.light=light;worker.lightOrigin=lightOrigin;worker.overview=overview;
        if(light!=null)worker.smoothLighting=new SmoothLighting(light,lightOrigin,worker::blockAt,worker.shapes);
        worker.streaming=true;worker.prepared=true;return worker;
    }
    /** 只枚举占用区段，不物化面片数组。 */
    private java.util.List<SectionVisibility.Position> occupiedSections;
    private final java.util.Set<SectionVisibility.Position> spriteSections=new java.util.HashSet<>();
    private final java.util.Set<BlockState> redstoneStates=new java.util.HashSet<>();
    public java.util.List<SectionVisibility.Position> sections() {
        if(occupiedSections!=null)return occupiedSections;
        var keys=new java.util.TreeSet<SectionVisibility.Position>(java.util.Comparator.comparingInt(SectionVisibility.Position::x).thenComparingInt(SectionVisibility.Position::y).thenComparingInt(SectionVisibility.Position::z));
        for(int ri=0;ri<regions.size();ri++) {
            var region=regions.get(ri);var off=regionOffsets.get(ri);var origin=region.blockOrigin();
            SectionVisibility.Position[] last={null};
            region.blocks.forEachNonAir((x,y,z,state)->{
                int sx=Math.floorDiv(x+off[0],16),sy=Math.floorDiv(y+off[1],16),sz=Math.floorDiv(z+off[2],16);
                if(last[0]==null||last[0].x()!=sx||last[0].y()!=sy||last[0].z()!=sz){last[0]=new SectionVisibility.Position(sx,sy,sz);keys.add(last[0]);}
                if(BlockRegistry.isHead(state.blockId)||state.blockId.endsWith("_sign")||SpecialBlockGeometry.supports(state.blockId))spriteSections.add(last[0]);
                if(state.blockId.equals("minecraft:redstone_wire"))redstoneStates.add(state);
            });
            for(var e:region.entities)if(EntityGeometry.supported(e))keys.add(section(off[0]+region.position.x()-origin.x()+e.x(),off[1]+region.position.y()-origin.y()+e.y(),off[2]+region.position.z()-origin.z()+e.z()));
        }
        occupiedSections=java.util.List.copyOf(keys);return occupiedSections;
    }
    /** 写入图集 UV 前注册所有生成贴图，临时模型受内存预算限制。 */
    public void prepareStreaming() {
        streaming=true;prepare();
        preparationProgress.accept("sprites");sections();var dynamic=new java.util.HashSet<>(spriteSections);
        for(var state:redstoneStates)redstoneQuads(state,this.baker.selectVariants(state.blockId,state));
        for(var entities:entitySections)dynamic.addAll(entities.keySet());
        registeringSprites=true;
        try{for(var key:dynamic)buildSection(key);}finally{registeringSprites=false;}
        if(overview!=null){var white=new io.github.litematicrender.render.Image(1,1);white.pixels()[0]=0xffffffff;this.generatedSprites.put("litematicrender:overview",white);}
        this.atlas.replaceGeneratedSprites(this.generatedSprites);
    }
    public SceneMesh buildSection(SectionVisibility.Position key) {
        if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("模型生成已取消");
        prepare();range=key;rangeSize=16;
        try {
            cacheSectionBlocks(key);
            if(light!=null){sectionLight=light.forSection(key.x()*16-lightOrigin[0],key.y()*16-lightOrigin[1],key.z()*16-lightOrigin[2]);if(smoothLighting!=null)smoothLighting.bind(sectionLight);}
            lightCacheReady=false;return assemble();
        }finally{range=null;rangeSize=16;sectionBlocksReady=false;sectionLight=null;if(smoothLighting!=null)smoothLighting.bind(light);}
    }
    @Override public java.util.Map<SectionVisibility.Position,SceneMesh> buildSections(java.util.List<SectionVisibility.Position> positions) {
        if(positions.size()<2||buildUnitSections()<2)return io.github.litematicrender.render.StreamMeshExporter.Source.super.buildSections(positions);
        int bx=Math.floorDiv(positions.getFirst().x(),2)*2,by=Math.floorDiv(positions.getFirst().y(),2)*2,bz=Math.floorDiv(positions.getFirst().z(),2)*2;
        for(var p:positions)if(Math.floorDiv(p.x(),2)*2!=bx||Math.floorDiv(p.y(),2)*2!=by||Math.floorDiv(p.z(),2)*2!=bz)throw new IllegalArgumentException("32 格构建批次跨越边界");
        prepare();range=new SectionVisibility.Position(bx,by,bz);rangeSize=32;sectionLight=null;lightCacheReady=false;if(smoothLighting!=null)smoothLighting.bind(light);
        try {
            SceneMesh combined=assemble(false);combined.visibility.compile();
            var result=new java.util.LinkedHashMap<SectionVisibility.Position,SceneMesh>();for(var p:positions){var mesh=new SceneMesh();mesh.visibility=combined.visibility;mesh.skinReport=combined.skinReport;result.put(p,mesh);}
            partition(combined.solid,result);partition(combined.cutout,result);partition(combined.portal,result);partition(combined.fluid,result);partition(combined.translucent,result);partition(combined.waterMask,result);
            boolean report=true;for(var mesh:result.values()){mesh.entityReport=report?combined.entityReport:java.util.Map.of();report=false;finish(mesh,false);}
            return result;
        } finally {range=null;rangeSize=16;sectionLight=null;if(smoothLighting!=null)smoothLighting.bind(light);}
    }
    private static void partition(java.util.List<SceneMesh.MeshQuad> source,java.util.Map<SectionVisibility.Position,SceneMesh> targets) {
        for(var quad:source){var key=new SectionVisibility.Position(Math.floorDiv(quad.blockX,16),Math.floorDiv(quad.blockY,16),Math.floorDiv(quad.blockZ,16));var mesh=targets.get(key);if(mesh==null)throw new IllegalStateException("几何所有权超出 32 格构建批次："+key);switch(quad.layer){case SOLID->mesh.solid.add(quad);case CUTOUT->mesh.cutout.add(quad);case PORTAL->mesh.portal.add(quad);case FLUID->mesh.fluid.add(quad);case TRANSLUCENT->mesh.translucent.add(quad);case WATER_MASK->mesh.waterMask.add(quad);}}
    }
    private java.util.Map<LitematicaSchematic.Region,List<int[]>> editingCells;
    /** 只烘焙改动格及其邻域，不枚举全部区段，也不计算全局光照。 */
    public SceneMesh buildEditing(List<io.github.litematicrender.world.Vec3i> cells,SceneBuilder base,double[] minimum,double[] maximum){
        this.editingCells=new java.util.LinkedHashMap<>();
        for(var p:cells)for(int i=regions.size()-1;i>=0;i--){var r=regions.get(i);var off=regionOffsets.get(i);int x=p.x()-off[0],y=p.y()-off[1],z=p.z()-off[2];if(x<0||y<0||z<0||x>=r.blocks.sizeX||y>=r.blocks.sizeY||z>=r.blocks.sizeZ)continue;editingCells.computeIfAbsent(r,key->new ArrayList<>()).add(new int[]{x,y,z});break;}
        if(base!=null){this.skins=base.skins;this.font=base.font;this.generatedSprites.putAll(base.generatedSprites);this.light=base.light;this.lightOrigin=base.lightOrigin;this.realLighting=base.realLighting;this.lightingEnabled=base.lightingEnabled;}
        if(this.skins==null)this.skins=new io.github.litematicrender.render.skin.SkinResolver(java.nio.file.Path.of(System.getProperty("litematicrender.home",".")));
        if(minimum!=null){selectionMin=new int[]{(int)minimum[0],(int)minimum[1],(int)minimum[2]};selectionMax=new int[]{(int)maximum[0],(int)maximum[1],(int)maximum[2]};}
        if(light!=null)this.smoothLighting=new SmoothLighting(light,lightOrigin,this::blockAt,shapes);
        this.prepared=true;return assemble();
    }
    public SceneMesh build() {prepare();range=null;preparationProgress.accept("geometry");return assemble();}
    private int[] selectionMin,selectionMax;
    private boolean selectionContains(int x,int y,int z){return x>=selectionMin[0]&&y>=selectionMin[1]&&z>=selectionMin[2]&&x<selectionMax[0]&&y<selectionMax[1]&&z<selectionMax[2];}
    /** 选区外的邻居按空气处理，为切口重新构建真实表面。 */
    public SceneMesh buildSelection(double[] minimum,double[] maximum){
        if(minimum==null||maximum==null||minimum.length!=3||maximum.length!=3)throw new IllegalArgumentException("无效的选择范围");
        int[] min=new int[3],max=new int[3];for(int i=0;i<3;i++){
            if(!Double.isFinite(minimum[i])||!Double.isFinite(maximum[i])||minimum[i]>=maximum[i]||Math.abs(minimum[i])>30000001||Math.abs(maximum[i])>30000001)throw new IllegalArgumentException("无效的选择范围");
            min[i]=(int)Math.floor(minimum[i]);max[i]=(int)Math.ceil(maximum[i]);
        }
        prepare();var previousRange=range;int previousSize=rangeSize;boolean previousStreaming=streaming;
        var previousLight=light;var previousSectionLight=sectionLight;var previousOrigin=lightOrigin;var previousSmooth=smoothLighting;
        selectionMin=min;selectionMax=max;range=null;streaming=true;sectionLight=null;lightCacheReady=false;aoState=null;
        try{computeLight();smoothLighting=light==null?null:new SmoothLighting(light,lightOrigin,this::blockAt,shapes);return assemble();}
        finally{selectionMin=null;selectionMax=null;range=previousRange;rangeSize=previousSize;streaming=previousStreaming;light=previousLight;sectionLight=previousSectionLight;lightOrigin=previousOrigin;smoothLighting=previousSmooth;lightCacheReady=false;aoState=null;}
    }
    private void forEachBlock(LitematicaSchematic.Region region,int[] off,LitematicaSchematic.BlockContainer.NonAirConsumer consumer) {
        if(editingCells!=null){for(var p:editingCells.getOrDefault(region,List.of())){int x=p[0],y=p[1],z=p[2];if(selectionMin!=null&&!selectionContains(x+off[0],y+off[1],z+off[2]))continue;var state=region.blocks.get(x,y,z);if(!state.isAir())consumer.accept(x,y,z,state);}return;}
        if(range==null&&selectionMin==null){region.blocks.forEachNonAir(consumer);return;}
        int[] min=selectionMin!=null?selectionMin:new int[]{range.x()*16,range.y()*16,range.z()*16};
        int[] max=selectionMax!=null?selectionMax:new int[]{min[0]+rangeSize,min[1]+rangeSize,min[2]+rangeSize};
        int x0=Math.max(0,min[0]-off[0]),y0=Math.max(0,min[1]-off[1]),z0=Math.max(0,min[2]-off[2]);
        int x1=Math.min(region.blocks.sizeX,max[0]-off[0]),y1=Math.min(region.blocks.sizeY,max[1]-off[1]),z1=Math.min(region.blocks.sizeZ,max[2]-off[2]);
        boolean cached=sectionBlocksReady&&regions.size()==1;
        for(int y=y0;y<y1;y++)for(int z=z0;z<z1;z++)for(int x=x0;x<x1;x++){var state=cached?blockAt(x+off[0],y+off[1],z+off[2]):region.blocks.get(x,y,z);if(!state.isAir())consumer.accept(x,y,z,state);}
    }
    private SceneMesh assemble() {return assemble(true);}
    private SceneMesh assemble(boolean finishGeometry) {
        SceneMesh mesh = new SceneMesh();
        mesh.visibility=new SectionVisibility();
        var entityGeometry=new EntityGeometry(this.baker,this.registry,this.generatedSprites).lightingEnabled(lightingEnabled);
        var entityIdentities=new java.util.HashSet<String>();
        int savedEntities=0,renderedEntities=0,invisibleEntities=0,unsupportedEntities=0,duplicateEntities=0;
        for (int ri = 0; ri < this.regions.size(); ri++) {
            LitematicaSchematic.Region region = this.regions.get(ri);
            this.currentRegionName = region.name;
            int[] off = this.regionOffsets.get(ri);
            if(!registeringSprites)forEachBlock(region,off,(lx, ly, lz, state) -> {
                int x = off[0] + lx, y = off[1] + ly, z = off[2] + lz;
                if(this.shapes.occludes(state))mesh.visibility.setSolid(x,y,z);
                emitOwned(mesh,x,y,z,() -> this.emitBlock(mesh, state, x, y, z));
            });


            this.emitBlockEntities(mesh, region, off, entityGeometry);
            if(editingCells!=null)continue;
            java.util.List<Integer> indices=null;if(range!=null){indices=new java.util.ArrayList<>();for(var entry:entitySections.get(ri).entrySet()){var p=entry.getKey();if(p.x()>=range.x()&&p.y()>=range.y()&&p.z()>=range.z()&&p.x()*16<range.x()*16+rangeSize&&p.y()*16<range.y()*16+rangeSize&&p.z()*16<range.z()*16+rangeSize)indices.addAll(entry.getValue());}}
            for(int ei=0;ei<(indices==null?region.entities.size():indices.size());ei++) {
                int index=indices==null?ei:indices.get(ei);
                var entity=region.entities.get(index);savedEntities++;
                String identity=io.github.litematicrender.schematic.SchematicEntity.identity(entity.data());
                if(!identity.isEmpty()&&!entityIdentities.add(identity)){duplicateEntities++;continue;}
                if(!EntityGeometry.supported(entity)){unsupportedEntities++;continue;}
                if(entity.data().getBooleanOrDefault("Invisible",false)&&!EntityGeometry.frame(entity)){invisibleEntities++;continue;}
                var blockOrigin=region.blockOrigin();
                double x=off[0]+region.position.x()-blockOrigin.x()+entity.x(),y=off[1]+region.position.y()-blockOrigin.y()+entity.y(),z=off[2]+region.position.z()-blockOrigin.z()+entity.z();
                if(selectionMin!=null&&!selectionContains((int)Math.floor(x),(int)Math.floor(y),(int)Math.floor(z)))continue;
                float[] rgb={1,1,1};
                if(this.light!=null)LightVolume.brightness(activeLight().cellLight((int)Math.floor(x)-this.lightOrigin[0],(int)Math.floor(y+1)-this.lightOrigin[1],(int)Math.floor(z)-this.lightOrigin[2]),rgb);
                int solid=mesh.solid.size(),cutout=mesh.cutout.size(),portal=mesh.portal.size(),fluid=mesh.fluid.size(),translucent=mesh.translucent.size();
                int mask=mesh.waterMask.size();
                int waterX=(int)Math.floor(x),waterY=(int)Math.floor(y+.5625),waterZ=(int)Math.floor(z);
                var waterState=blockAt(waterX,waterY,waterZ);
                boolean submerged="minecraft:water".equals(fluidKeyOrNull(waterState))&&ownHeight(waterState,waterX,waterY,waterZ)>y+.5625-waterY;
                if (EntityGeometry.minecart(entity)) {
                    var pose=MinecartPose.resolve(entity,x,y,z,this::blockAt);
                    entityGeometry.emit(mesh,entity,pose.x(),pose.y(),pose.z(),rgb,submerged,pose.yaw(),pose.pitch());
                } else entityGeometry.emit(mesh,entity,x,y,z,rgb,submerged);
                ownEntity(mesh.solid,solid,index,x,y,z);ownEntity(mesh.cutout,cutout,index,x,y,z);ownEntity(mesh.portal,portal,index,x,y,z);ownEntity(mesh.fluid,fluid,index,x,y,z);ownEntity(mesh.translucent,translucent,index,x,y,z);
                ownEntity(mesh.waterMask,mask,index,x,y,z);
                renderedEntities++;
            }
        }
        if(registeringSprites)return mesh;
        if(!streaming){preparationProgress.accept("atlas");this.atlas.replaceGeneratedSprites(this.generatedSprites);}
        mesh.skinReport = this.skins.summary();
        mesh.entityReport=java.util.Map.of("saved",savedEntities,"rendered",renderedEntities,"invisible",invisibleEntities,"unsupported",unsupportedEntities,"duplicates",duplicateEntities);
        if(finishGeometry){if(!streaming)preparationProgress.accept("optimizing");finish(mesh);}
        return mesh;
    }
    private static void finish(SceneMesh mesh) { finish(mesh,true); }
    private static void finish(SceneMesh mesh,boolean compileVisibility) {
        mesh.quadCount = mesh.solid.size() + mesh.cutout.size() + mesh.portal.size()
            + mesh.fluid.size() + mesh.translucent.size()+mesh.waterMask.size();
        // BSP 负责相交分割，仅在双线性光照、UV 或弯曲面需要时保留旧式细分。

        prepareBlended(mesh.portal, mesh.portalSorted);
        prepareBlended(mesh.fluid, mesh.fluidSorted);
        prepareBlended(mesh.translucent, mesh.translucentSorted);
        var blended=new java.util.ArrayList<SceneMesh.MeshQuad>(mesh.portalSorted);
        blended.addAll(mesh.fluidSorted);blended.addAll(mesh.translucentSorted);
        if(!blended.isEmpty())mesh.translucentBsp=TranslucentBsp.build(blended);
        if(compileVisibility)mesh.visibility.compile();
    }

    // ------------------------------------------------------------------


    /** 光照范围使用所有区域的紧包围盒，外部查询返回完整天空光。 */
    private void computeLight() {
        if(!lightingEnabled){this.light=null;return;}
        int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE, maxY = Integer.MIN_VALUE, maxZ = Integer.MIN_VALUE;
        for (int[] off : this.regionOffsets) {
            minX = Math.min(minX, off[0]); minY = Math.min(minY, off[1]); minZ = Math.min(minZ, off[2]);
        }
        for (int i = 0; i < this.regions.size(); i++) {
            var r = this.regions.get(i);
            int[] off = this.regionOffsets.get(i);
            try {
                maxX = Math.max(maxX, Math.addExact(off[0], r.blocks.sizeX - 1));
                maxY = Math.max(maxY, Math.addExact(off[1], r.blocks.sizeY - 1));
                maxZ = Math.max(maxZ, Math.addExact(off[2], r.blocks.sizeZ - 1));
            } catch(ArithmeticException error) {
                throw new IllegalArgumentException("投影坐标超出支持范围，请减小区域坐标。",error);
            }
        }
        if(selectionMin!=null){minX=Math.max(minX,selectionMin[0]);minY=Math.max(minY,selectionMin[1]);minZ=Math.max(minZ,selectionMin[2]);maxX=Math.min(maxX,selectionMax[0]-1);maxY=Math.min(maxY,selectionMax[1]-1);maxZ=Math.min(maxZ,selectionMax[2]-1);}
        if (minX > maxX||minY>maxY||minZ>maxZ) { this.light = null; return; }
        final int fMinX = minX, fMinY = minY, fMinZ = minZ;
        long spanX = (long)maxX - minX + 1, spanY = (long)maxY - minY + 1, spanZ = (long)maxZ - minZ + 1;
        if(spanX>Integer.MAX_VALUE||spanY>Integer.MAX_VALUE||spanZ>Integer.MAX_VALUE)
            throw new IllegalArgumentException("投影坐标跨度超出支持范围，请缩小区域坐标。");
        this.lightOrigin=new int[]{minX,minY,minZ};
        boolean sparse=Boolean.getBoolean("litematicrender.light.sparse");
        // 大堆不能使巨大压缩投影进入全体积扫描；密集路径同时受固定工作量限制。

        if(streaming&&(double)spanX*spanY*spanZ>16L*1024*1024)sparse=true;
        double regionCells=0;for(var region:this.regions)regionCells+=(double)region.blocks.sizeX*region.blocks.sizeY*region.blocks.sizeZ;
        if((double)spanX*spanY*spanZ>regionCells*4)sparse=true;
        try{if(streaming)LightVolume.checkedCompactCellCount(spanX,spanY,spanZ);else LightVolume.checkedCellCount(spanX,spanY,spanZ);}catch(IllegalArgumentException large){sparse=true;}
        if(sparse) {
            var volume=new SparseLightVolume((int)spanX,(int)spanY,(int)spanZ,this.shapes,this.realLighting,streaming?(x,y,z)->lightBlockAt(x+fMinX,y+fMinY,z+fMinZ):null);
            for(int i=0;i<this.regions.size();i++) {
                var region=this.regions.get(i);var offset=this.regionOffsets.get(i);
                region.blocks.forEachNonAir((x,y,z,state)->volume.put(offset[0]+x-fMinX,offset[1]+y-fMinY,offset[2]+z-fMinZ,state));
            }
            volume.compute();this.light=volume;return;
        }
        if(streaming) {
            this.light=new LightVolume((int)spanX,(int)spanY,(int)spanZ,(x,y,z)->lightBlockAt(x+fMinX,y+fMinY,z+fMinZ),this.shapes,this.realLighting);
            this.light.compute();return;
        }
        int count = LightVolume.checkedCellCount(spanX,spanY,spanZ);
        int sx = (int)spanX, sy = (int)spanY, sz = (int)spanZ;
        BlockState[] cells = new BlockState[count];
        java.util.Arrays.fill(cells, BlockState.air());
        for (int i = 0; i < this.regions.size(); i++) {
            var r = this.regions.get(i);
            int[] off = this.regionOffsets.get(i);
            r.blocks.forEachNonAir((lx, ly, lz, s) -> {
                int gx = off[0] + lx - fMinX, gy = off[1] + ly - fMinY, gz = off[2] + lz - fMinZ;
                cells[(gy * sz + gz) * sx + gx] = s;
            });
        }
        this.lightOrigin = new int[]{minX, minY, minZ};

        this.light = new LightVolume(sx, sy, sz, cells, this.shapes, this.realLighting);
        this.light.compute();
    }


    private LightSampler light,sectionLight;
    private LightSampler activeLight(){return sectionLight==null?light:sectionLight;}
    private BlockState lightBlockAt(int x,int y,int z) {
        if(selectionMin!=null&&!selectionContains(x,y,z))return BlockState.air();
        if(regions.size()==1)return blockAt(x,y,z);
        var candidates=regionIndex==null?null:regionIndex.get(new Section(Math.floorDiv(x,16),Math.floorDiv(y,16),Math.floorDiv(z,16)));
        if(regionIndex!=null&&candidates==null)return BlockState.air();
        for(int candidate=(candidates==null?regions.size():candidates.size())-1;candidate>=0;candidate--) {
            int i=candidates==null?candidate:candidates.get(candidate);var off=regionOffsets.get(i);var r=regions.get(i);
            var state=r.blocks.get(x-off[0],y-off[1],z-off[2]);if(!state.isAir())return state;
        }
        return BlockState.air();
    }
    private int[] lightOrigin;
    private record Section(int x,int y,int z) {}
    private java.util.Map<Section,java.util.List<Integer>> regionIndex;
    private void buildRegionIndex() {
        if(this.regions.size()<=1){this.regionIndex=null;return;}
        this.regionIndex=new java.util.HashMap<>();
        for(int i=0;i<this.regions.size();i++) {
            var region=this.regions.get(i);var off=this.regionOffsets.get(i);
            int x0=Math.floorDiv(off[0],16),y0=Math.floorDiv(off[1],16),z0=Math.floorDiv(off[2],16);
            int x1=Math.floorDiv(Math.addExact(off[0],region.blocks.sizeX-1),16);
            int y1=Math.floorDiv(Math.addExact(off[1],region.blocks.sizeY-1),16);
            int z1=Math.floorDiv(Math.addExact(off[2],region.blocks.sizeZ-1),16);
            for(int x=x0;x<=x1;x++)for(int y=y0;y<=y1;y++)for(int z=z0;z<=z1;z++)
                this.regionIndex.computeIfAbsent(new Section(x,y,z),key->new java.util.ArrayList<>()).add(i);
        }
    }

    // ------------------------------------------------------------------


    private io.github.litematicrender.render.FontRenderer font;
    private io.github.litematicrender.render.skin.SkinResolver skins;
    private String currentRegionName;
    private final java.util.Map<String, io.github.litematicrender.render.Image> generatedSprites = new java.util.LinkedHashMap<>();

    private void prepareSkins() {
        if(this.skins!=null)return;
        String configured = System.getProperty("litematicrender.home");
        java.nio.file.Path home = configured == null ? this.baker.resources().vanillaRoot().toAbsolutePath().getParent().getParent()
            : java.nio.file.Path.of(configured);
        this.skins = new io.github.litematicrender.render.skin.SkinResolver(home);
        java.util.List<io.github.litematicrender.nbt.NbtCompound> profiles = new java.util.ArrayList<>();
        for (var region : this.regions) {
            boolean players=java.util.Arrays.stream(region.blocks.palette).anyMatch(s->s!=null&&(s.blockId.equals("minecraft:player_head")||s.blockId.equals("minecraft:player_wall_head")));
            if(!players)continue;
            region.blocks.forEachNonAir((x,y,z,state) -> {
            if (state.blockId.equals("minecraft:player_head") || state.blockId.equals("minecraft:player_wall_head")) {
                profiles.add(region.blockEntities.get(LitematicaSchematic.pack(x,y,z)));
            }
            });
        }
        this.skins.prepare(profiles);
    }

    private void emitBlockEntities(SceneMesh mesh, LitematicaSchematic.Region region, int[] off, EntityGeometry geometry) {
        int top=Integer.MIN_VALUE;for(int ri=0;ri<this.regions.size();ri++)top=Math.max(top,this.regionOffsets.get(ri)[1]+this.regions.get(ri).blocks.sizeY);
        var special=new SpecialBlockGeometry(geometry,this.generatedSprites,this::blockAt,this.shapes::occludes,top);
        forEachBlock(region,off,(lx, ly, lz, state) -> {
            String id = state.blockId;
            boolean head = BlockRegistry.isHead(id);
            boolean sign = id.endsWith("_sign");
            boolean pot = id.equals("minecraft:decorated_pot");
            if (!head && !sign && !pot && !SpecialBlockGeometry.supports(id)) return;
            int x = off[0] + lx, y = off[1] + ly, z = off[2] + lz;
            float[] rgb = {1, 1, 1};
            if (this.light != null) LightVolume.brightness(activeLight().cellLight(
                x - this.lightOrigin[0], y - this.lightOrigin[1], z - this.lightOrigin[2]), rgb);
            emitOwned(mesh,x,y,z,() -> {
            if (pot) {
                var nbt = region.blockEntities.get(LitematicaSchematic.pack(lx,ly,lz));
                int rotation = switch (String.valueOf(state.getValue("facing"))) {
                    case "east" -> 90; case "south" -> 180; case "west" -> 270; default -> 0;
                };
                this.emitModel(mesh,this.baker.bake("minecraft:block/litematicrender_ebe_decorated_pot_base",0,rotation,0,false),state,x,y,z);
                String[] sides = {"north","west","east","south"};
                var patterns = BlockEntityData.potPatterns(nbt);
                for (int i=0;i<4;i++) this.emitModel(mesh,this.baker.bake("minecraft:block/litematicrender_pot_"+sides[i]+"_"+patterns.get(i),0,rotation,0,false),state,x,y,z);
            } else if (head) {
                var nbt = region.blockEntities.get(LitematicaSchematic.pack(lx,ly,lz));
                var skin = state.blockId.equals("minecraft:player_head") || state.blockId.equals("minecraft:player_wall_head")
                    ? this.skins.resolved(nbt) : null;
                if (skin != null) this.generatedSprites.put(skin.spriteId(),skin.image());
                if(id.equals("minecraft:player_head")||id.equals("minecraft:player_wall_head"))
                    HeadGeometry.emit(mesh, this.baker, state, x, y, z, rgb, skin,lightingEnabled);
                else MobHeadGeometry.emit(geometry,mesh,state,x,y,z,rgb,this.generatedSprites);
            } else if (SpecialBlockGeometry.supports(id)) {
                special.emit(mesh,state,region.blockEntities.get(LitematicaSchematic.pack(lx,ly,lz)),x,y,z,rgb);
            } else {
                var nbt = region.blockEntities.get(LitematicaSchematic.pack(lx, ly, lz));
                if (nbt == null) return;
                var text = BlockEntityData.readSign(nbt);
                if (!text.hasText()) return;
                if (this.font == null) this.font = this.baker.fontRenderer();
                SignGeometry.emit(mesh, state, text, this.font, x, y, z, rgb, this.generatedSprites);
            }
            });
        });
    }

    private void emitOwned(SceneMesh mesh,int x,int y,int z,Runnable emit) {
        int solid=mesh.solid.size(),cutout=mesh.cutout.size(),portal=mesh.portal.size(),fluid=mesh.fluid.size(),translucent=mesh.translucent.size();
        emit.run();
        own(mesh.solid,solid,x,y,z); own(mesh.cutout,cutout,x,y,z); own(mesh.portal,portal,x,y,z);
        own(mesh.fluid,fluid,x,y,z); own(mesh.translucent,translucent,x,y,z);
    }
    private void own(java.util.List<SceneMesh.MeshQuad> quads,int start,int x,int y,int z) {
        for(int i=start;i<quads.size();i++) quads.get(i).owner(x,y,z,this.currentRegionName);
    }
    private void ownEntity(java.util.List<SceneMesh.MeshQuad> quads,int start,int index,double x,double y,double z){for(int i=start;i<quads.size();i++)quads.get(i).owner((int)Math.floor(x),(int)Math.floor(y),(int)Math.floor(z),this.currentRegionName).entityOwner(index,this.currentRegionName);}

    /** 半透明面适当细分，使穿插表面能够正确排序。 */
    public static void subdivideInto(List<SceneMesh.MeshQuad> in, List<SceneMesh.MeshQuad> out) {
        for (SceneMesh.MeshQuad q : in) subdivideQuad(q, out);    }

    private static void prepareBlended(List<SceneMesh.MeshQuad> in,List<SceneMesh.MeshQuad> out) {
        for(var q:in) {
            if(q.vertexColors!=null||TranslucentBsp.affine(q))out.add(q);
            else subdivideQuad(q,out);
        }
    }

    private static void subdivideQuad(SceneMesh.MeshQuad q, List<SceneMesh.MeshQuad> out) {
        float ex = Math.abs(q.x1 - q.x0) + Math.abs(q.x2 - q.x1);
        float ey = Math.abs(q.y1 - q.y0) + Math.abs(q.y2 - q.y1);
        float ez = Math.abs(q.z1 - q.z0) + Math.abs(q.z2 - q.z1);
        float extent = Math.max(ex, Math.max(ey, ez));
        int n = extent > 1.5f ? 4 : (extent > 0.75f ? 2 : 1);
        if (n == 1) {
            out.add(q);
            return;
        }
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                float u0 = i / (float) n, u1 = (i + 1) / (float) n;
                float v0 = j / (float) n, v1 = (j + 1) / (float) n;
                float[] xs = new float[4], ys = new float[4], zs = new float[4];
                float[] pu = new float[4], pv = new float[4];
                float[][] uv = {{u0, v0}, {u1, v0}, {u1, v1}, {u0, v1}};
                for (int k = 0; k < 4; k++) {
                    float a = uv[k][0], b = uv[k][1];
                    xs[k] = bilerp(q.x0, q.x1, q.x2, q.x3, a, b);
                    ys[k] = bilerp(q.y0, q.y1, q.y2, q.y3, a, b);
                    zs[k] = bilerp(q.z0, q.z1, q.z2, q.z3, a, b);
                    pu[k] = bilerp(q.u0, q.u1, q.u2, q.u3, a, b);
                    pv[k] = bilerp(q.v0, q.v1, q.v2, q.v3, a, b);
                }
                out.add(new SceneMesh.MeshQuad(xs, ys, zs,
                    pu[0], pv[0], pu[1], pv[1], pu[2], pv[2], pu[3], pv[3],
                    q.spriteId, q.rgb, q.image, q.tintR, q.tintG, q.tintB, q.shade,
                    aoAt(q.ao, u0, v0, u1, v1), q.layer, q.doubleSided).owner(q.blockX,q.blockY,q.blockZ,q.regionName).entityOwner(q.entityIndex,q.regionName));
            }
        }
    }


    private static float[] aoAt(float[] ao, float u0, float v0, float u1, float v1) {
        if (ao == null) return null;
        float[][] uv = {{u0, v0}, {u1, v0}, {u1, v1}, {u0, v1}};
        float[] out = new float[4];
        for (int k = 0; k < 4; k++) {
            float a = uv[k][0], b = uv[k][1];
            float top = ao[0] + (ao[1] - ao[0]) * a;
            float bottom = ao[3] + (ao[2] - ao[3]) * a;
            out[k] = top + (bottom - top) * b;
        }
        return out;
    }

    private static float bilerp(float a, float b, float c, float d, float u, float v) {

        float top = a + (b - a) * u;
        float bottom = d + (c - d) * u;
        return top + (bottom - top) * v;
    }

    private void emitBlock(SceneMesh mesh, BlockState state, int x, int y, int z) {
        String id = state.blockId;
        if (BlockRegistry.isHead(id)) return;

        // 先查询每个方块所含流体，含水方块同样需要绘制流体层。


        if (FLUIDS.contains(id)) {
            this.emitFluid(mesh, state, x, y, z);
            return;
        }
        if (isWaterlogged(state)) {
            // 含水方块同时绘制自身模型和完整静水，不能只绘制其中一层。


            this.emitFluid(mesh, state, x, y, z);
        }
        if (id.equals("minecraft:decorated_pot")||id.equals("minecraft:conduit")||SpecialBlockGeometry.banner(id)||BlockRegistry.isCopperGolemStatue(id)) return;

        // multipart 方块需要输出所有匹配模型，不能只选择一个。

        List<ModelBaker.Variant> variants = this.baker.selectVariants(id, state);
        if (variants.isEmpty()) {
            ModelBaker.Variant dv = this.baker.selectVariant(id, this.registry.getOrMissing(id).defaultState);
            if (dv != null) variants = List.of(dv);
        }
        if (variants.isEmpty()) {
            io.github.litematicrender.render.RenderDiagnostics.note("no model for blockstate", id + state.propertyString());
            this.emitModel(mesh, this.baker.bake("minecraft:block/missingno", 0, 0, 0, false), state, x, y, z);
            return;
        }
        if(id.equals("minecraft:redstone_wire")) {
            var cached=redstoneQuads(state,variants);
            if(cached!=null){for(var q:cached)this.emitQuad(mesh,q,-1,x,y,z,state,false);return;}
        }
        for (ModelBaker.Variant v : variants) {
            this.emitModel(mesh, this.baker.bake(v), state, x, y, z);
        }
    }

    private List<Quad> redstoneQuads(BlockState state,List<ModelBaker.Variant> variants) {
        if(this.redstoneSurfaces.containsKey(state))return this.redstoneSurfaces.get(state);
        var quads=new ArrayList<Quad>();boolean unculled=!variants.isEmpty();
        for(var variant:variants){var model=this.baker.bake(variant);quads.addAll(model.unculled);for(int face=0;face<6;face++)unculled&=model.quadsForFace(face).isEmpty();}
        var result=unculled?RedstoneSurfaces.compose(quads,state,this.atlas,this.generatedSprites):null;
        this.redstoneSurfaces.put(state,result);return result;
    }

    private void emitModel(SceneMesh mesh, ModelBaker.BakedModel model, BlockState state, int x, int y, int z) {
        if (model == null) return;
        boolean ao = model.useAmbientOcclusion;
        for (int face = 0; face < 6; face++) {
            for (Quad q : model.quadsForFace(face)) {
                if (!this.shouldRenderFace(state, face, x, y, z)) continue;
                int[] delta=FACE_DELTAS[face];
                if(this.shapes.faceOccluded(q,face,this.blockAt(x+delta[0],y+delta[1],z+delta[2])))continue;
                this.emitQuad(mesh, q, face, x, y, z, state, ao);
            }
        }
        for (Quad q : model.unculled) {
            this.emitQuad(mesh, q, -1, x, y, z, state, ao);
        }
    }

    private void emitQuad(SceneMesh mesh, Quad q, int faceDir, int x, int y, int z, BlockState state, boolean ao) {
        int emission=this.realLighting?Math.max(q.lightEmission,LightVolume.realEmission(state)):q.lightEmission;
        int effectiveFace = faceDir >= 0 ? faceDir : (q.face >= 0 ? q.face : Quad.UP);
        float shade = q.shadeFaceOverride >= 0 ? CARDINAL[q.shadeFaceOverride] : CARDINAL[effectiveFace];

        if(!lightingEnabled)shade=1f;
        float[] xs = {q.x0 + x, q.x1 + x, q.x2 + x, q.x3 + x};
        float[] ys = {q.y0 + y, q.y1 + y, q.y2 + y, q.y3 + y};
        float[] zs = {q.z0 + z, q.z1 + z, q.z2 + z, q.z3 + z};


        // 原版发光方块关闭 AO，无剔除方向的面采用平面光照。
        float[] aoV = null;
        if (lightingEnabled && ao && faceDir >= 0 && emission == 0) {
            aoV = this.ambientOcclusion(x, y, z, effectiveFace, q, xs, ys, zs, state);
        }

        // 染色依据 tintindex 和注册的颜色来源，而非贴图名称。

        float tr = 1, tg = 1, tb = 1;
        if (q.tintIndex >= 0) {
            int tint = io.github.litematicrender.render.BlockTints.colorFor(state, q.spriteId, q.tintIndex);
            if (tint >= 0) {
                tr = ((tint >> 16) & 0xFF) / 255f;
                tg = ((tint >> 8) & 0xFF) / 255f;
                tb = (tint & 0xFF) / 255f;
            }
        }

        // 纹理依次乘以染色、方向光、AO 和光照图，静态乘数可提前合并。


        float[] light = new float[3];
        // 内凹或无剔除方向的几何读取自身格，不读取上方不透明邻居。
        float facePlane = switch (effectiveFace) {
            case Quad.DOWN, Quad.UP -> (q.y0 + q.y1 + q.y2 + q.y3) / 4f;
            case Quad.NORTH, Quad.SOUTH -> (q.z0 + q.z1 + q.z2 + q.z3) / 4f;
            default -> (q.x0 + q.x1 + q.x2 + q.x3) / 4f;
        };
        boolean boundary = effectiveFace == Quad.DOWN || effectiveFace == Quad.NORTH || effectiveFace == Quad.WEST
            ? facePlane <= 0.0001f : facePlane >= 0.9999f;
        if (this.light != null && (faceDir < 0 || !boundary)) {
            this.cachedLightColor(x,y,z,-1,light);
            if(this.realLighting && faceDir>=0) {
                float[] outer=new float[3];this.faceLightColor(x,y,z,effectiveFace,outer);
                float weight=clamp01((effectiveFace&1)==0?1f-facePlane:facePlane);
                for(int i=0;i<3;i++)light[i]=light[i]*(1f-weight)+outer[i]*weight;
            }
        } else {
            this.faceLightColor(x, y, z, effectiveFace, light);
        }
        if (emission > 0) {
            float[] emitted = new float[3];
            LightVolume.brightness(Math.min(15, emission), emitted);
            for (int i = 0; i < 3; i++) light[i] = Math.max(light[i], emitted[i]);
        }
        if(!lightingEnabled)shade=1f;
        float baseR=tr,baseG=tg,baseB=tb;
        tr *= light[0]; tg *= light[1]; tb *= light[2];

        SceneMesh.Layer layer = this.layerOf(state.blockId, q);
        SceneMesh.MeshQuad mq = new SceneMesh.MeshQuad(xs, ys, zs,
            q.u0, q.v0, q.u1, q.v1, q.u2, q.v2, q.u3, q.v3,
            q.spriteId, 0xFFFFFFFF, null, tr, tg, tb, shade, aoV, layer, q.face == Quad.NO_FACE);
        if(this.lightingEnabled&&this.realLighting&&this.smoothLighting!=null&&q.face>=0)mq.colors(this.smoothLighting.colors(x,y,z,q,mq,baseR,baseG,baseB,emission));
        mq.lodProtected=state.blockId.endsWith("_trapdoor")||state.blockId.endsWith("_wall")||state.blockId.endsWith("_fence")||state.blockId.endsWith("_fence_gate");
        switch (layer) {
            case SOLID -> mesh.solid.add(mq);
            case CUTOUT -> mesh.cutout.add(mq);
            case PORTAL -> mesh.portal.add(mq);
            case FLUID -> mesh.fluid.add(mq);
            case TRANSLUCENT -> mesh.translucent.add(mq);
        }
    }

    // ------------------------------------------------------------------


    /** 每个面角采样两侧、对角和中心的 AO；遮光条件满足时跳过对角。 */
    private float[] ambientOcclusion(int x, int y, int z, int face, Quad q,
                                     float[] xs, float[] ys, float[] zs, BlockState state) {
        if(this.realLighting)return realAmbientOcclusion(x,y,z,face,xs,ys,zs,state);
        int[] n = FACE_DELTAS[face];
        int[][] axes = faceAxes(face);
        int[] u = axes[0], v = axes[1];

        // 位于方块外边界的面采样邻格，内凹表面采样自身周围，避免台阶等模型被错误压暗。


        boolean faceCubic = isFaceCubic(q, face, state);
        int fx = faceCubic ? x + n[0] : x;
        int fy = faceCubic ? y + n[1] : y;
        int fz = faceCubic ? z + n[2] : z;


        float center = faceCubic
            ? this.shades(this.blockAt(fx, fy, fz))
            : this.shades(state);

        float[] out = new float[4];
        for (int i = 0; i < 4; i++) {

            int su = (i == 1 || i == 2) ? 1 : -1;
            int sv = (i >= 2) ? 1 : -1;
            int s1x = fx + u[0] * su, s1y = fy + u[1] * su, s1z = fz + u[2] * su;
            int s2x = fx + v[0] * sv, s2y = fy + v[1] * sv, s2z = fz + v[2] * sv;

            BlockState b1 = this.blockAt(s1x, s1y, s1z);
            BlockState b2 = this.blockAt(s2x, s2y, s2z);
            float side1 = this.shades(b1);
            float side2 = this.shades(b2);
            boolean p1 = this.permits(b1);
            boolean p2 = this.permits(b2);

            float diagonal;
            if (!p2 && !p1) {
                diagonal = side1;
            } else {
                diagonal = this.shades(this.blockAt(s1x + v[0] * sv, s1y + v[1] * sv, s1z + v[2] * sv));
            }
            out[i] = Math.min(1f, (side1 + side2 + diagonal + center) * 0.25f);
        }
        return remapToVertices(out, face, xs, ys, zs);
    }

    private int aoX,aoY,aoZ;
    private BlockState aoState;
    private final float[][] aoFaces=new float[12][];
    private float[] realAmbientOcclusion(int x,int y,int z,int face,float[] xs,float[] ys,float[] zs,BlockState state) {
        if(x!=aoX||y!=aoY||z!=aoZ||state!=aoState){aoX=x;aoY=y;aoZ=z;aoState=state;java.util.Arrays.fill(aoFaces,null);}
        float[] inner=aoFace(x,y,z,face,false,state),outer=aoFace(x,y,z,face,true,state),result=new float[4];
        int[][] axes=faceAxes(face);int[] u=axes[0],v=axes[1];
        for(int i=0;i<4;i++) {
            float px=xs[i]-x,py=ys[i]-y,pz=zs[i]-z;
            float a=clamp01(px*u[0]+py*u[1]+pz*u[2]),b=clamp01(px*v[0]+py*v[1]+pz*v[2]);
            float depth=face<2?py:face<4?pz:px,weight=clamp01((face&1)==0?1f-depth:depth);
            result[i]=blendCorners(inner,a,b)*(1f-weight)+blendCorners(outer,a,b)*weight;
        }
        return result;
    }
    private float[] aoFace(int x,int y,int z,int face,boolean outer,BlockState state) {
        int key=face+(outer?6:0);if(aoFaces[key]!=null)return aoFaces[key];
        int[] n=FACE_DELTAS[face];int[][] axes=faceAxes(face);int[] u=axes[0],v=axes[1];
        int fx=x+(outer?n[0]:0),fy=y+(outer?n[1]:0),fz=z+(outer?n[2]:0);
        float center=shades(outer?blockAt(fx,fy,fz):state);float[] result=new float[4];
        for(int i=0;i<4;i++) {
            int su=i==1||i==2?1:-1,sv=i>=2?1:-1;
            BlockState b1=blockAt(fx+u[0]*su,fy+u[1]*su,fz+u[2]*su),b2=blockAt(fx+v[0]*sv,fy+v[1]*sv,fz+v[2]*sv);
            float diagonal=!permits(b1)&&!permits(b2)?shades(b1):shades(blockAt(fx+u[0]*su+v[0]*sv,fy+u[1]*su+v[1]*sv,fz+u[2]*su+v[2]*sv));
            result[i]=Math.min(1f,(shades(b1)+shades(b2)+diagonal+center)*.25f);
        }
        return aoFaces[key]=result;
    }
    private static float clamp01(float value){return Math.min(1f,Math.max(0f,value));}
    private static float blendCorners(float[] c,float u,float v){return c[0]*(1f-u)*(1f-v)+c[1]*u*(1f-v)+c[2]*u*v+c[3]*(1f-u)*v;}

    /** 判断面是否平贴方块外边界，遵循原版 faceCubic 条件。 */
    private boolean isFaceCubic(Quad q, int face, BlockState state) {
        boolean flat = switch (face) {
            case Quad.DOWN -> allEqual(q.y0, q.y1, q.y2, q.y3);
            case Quad.UP -> allEqual(q.y0, q.y1, q.y2, q.y3);
            case Quad.NORTH, Quad.SOUTH -> allEqual(q.z0, q.z1, q.z2, q.z3);
            default -> allEqual(q.x0, q.x1, q.x2, q.x3);
        };
        if (!flat) return false;
        boolean atOuterPlane = switch (face) {
            case Quad.DOWN -> min4(q.y0, q.y1, q.y2, q.y3) < 1e-4f;
            case Quad.UP -> max4(q.y0, q.y1, q.y2, q.y3) > 0.9999f;
            case Quad.NORTH -> min4(q.z0, q.z1, q.z2, q.z3) < 1e-4f;
            case Quad.SOUTH -> max4(q.z0, q.z1, q.z2, q.z3) > 0.9999f;
            case Quad.WEST -> min4(q.x0, q.x1, q.x2, q.x3) < 1e-4f;
            default -> max4(q.x0, q.x1, q.x2, q.x3) > 0.9999f;
        };
        return atOuterPlane || this.shapes.isShapeFullBlock(state);
    }

    private static boolean allEqual(float a, float b, float c, float d) {
        return Math.abs(a - b) < 1e-4f && Math.abs(b - c) < 1e-4f && Math.abs(c - d) < 1e-4f;
    }

    private static float min4(float a, float b, float c, float d) { return Math.min(Math.min(a, b), Math.min(c, d)); }
    private static float max4(float a, float b, float c, float d) { return Math.max(Math.max(a, b), Math.max(c, d)); }


    private static int[][] faceAxes(int face) {
        return switch (face) {
            case Quad.DOWN, Quad.UP -> new int[][]{{1, 0, 0}, {0, 0, 1}};
            case Quad.NORTH, Quad.SOUTH -> new int[][]{{1, 0, 0}, {0, 1, 0}};
            default -> new int[][]{{0, 0, 1}, {0, 1, 0}};
        };
    }

    /** AO 在面内角点空间计算，再按实际顶点位置重新映射，兼容翻转绕序。 */
    private float[] remapToVertices(float[] c, int face, float[] xs, float[] ys, float[] zs) {
        int[][] axes = faceAxes(face);
        int[] u = axes[0], v = axes[1];

        float ox = (xs[0] + xs[1] + xs[2] + xs[3]) * 0.25f;
        float oy = (ys[0] + ys[1] + ys[2] + ys[3]) * 0.25f;
        float oz = (zs[0] + zs[1] + zs[2] + zs[3]) * 0.25f;

        float[] out = new float[4];
        for (int i = 0; i < 4; i++) {
            float du = (xs[i] - ox) * u[0] + (ys[i] - oy) * u[1] + (zs[i] - oz) * u[2];
            float dv = (xs[i] - ox) * v[0] + (ys[i] - oy) * v[1] + (zs[i] - oz) * v[2];
            boolean hi = du > 0f, hv = dv > 0f;
            out[i] = c[hv ? (hi ? 2 : 3) : (hi ? 1 : 0)];
        }
        return out;
    }

    private float shades(BlockState s) { return this.shapes.shadeBrightness(s); }


    private boolean permits(BlockState s) {
        return this.shapes.lightPermeable(s);
    }

    // ------------------------------------------------------------------


    private static final java.util.Set<String> FLUIDS = java.util.Set.of(
        "minecraft:water", "minecraft:lava", "minecraft:bubble_column");

    /** 含水状态与流体方块都进入流体渲染，避免树叶或楼梯内部的水丢失。 */
    private static boolean isWaterlogged(BlockState s) {
        String v = s.getValue("waterlogged");
        return v != null && Boolean.parseBoolean(v);
    }

    /** 原版非下落流体的最大高度。 */
    private static final float MAX_FLUID_HEIGHT = 0.8888889f;

    private void emitFluid(SceneMesh mesh, BlockState state, int x, int y, int z) {
        boolean lava = state.blockId.equals("minecraft:lava");
        String self = fluidKeyOrNull(state);
        BlockState above = this.blockAt(x, y + 1, z);


        boolean renderUp = !isSameFluid(x, y + 1, z, self);

        boolean renderDown = shouldRenderFluidFace(x, y, z, Quad.DOWN, self)
            && !isFluidFaceOccludedBy(Direction.DOWN, MAX_FLUID_HEIGHT, this.blockAt(x, y - 1, z));
        // 先检查自身遮挡形状，邻居遮挡需在绘制时结合真实液面高度判断。


        boolean renderNorth = shouldRenderFluidFace(x, y, z, Quad.NORTH, self);
        boolean renderSouth = shouldRenderFluidFace(x, y, z, Quad.SOUTH, self);
        boolean renderWest = shouldRenderFluidFace(x, y, z, Quad.WEST, self);
        boolean renderEast = shouldRenderFluidFace(x, y, z, Quad.EAST, self);

        if (!(renderUp || renderDown || renderEast || renderWest || renderNorth || renderSouth)) return;

        float tr = 1, tg = 1, tb = 1;
        if (!lava) {
            int tint = this.colormaps.waterColor();
            tr = ((tint >> 16) & 0xFF) / 255f;
            tg = ((tint >> 8) & 0xFF) / 255f;
            tb = (tint & 0xFF) / 255f;
        }

        float heightSelf = this.fluidHeight(x, y, z, self);
        float heightNorthEast, heightNorthWest, heightSouthEast, heightSouthWest;
        if (heightSelf >= 1f) {
            heightNorthEast = heightNorthWest = heightSouthEast = heightSouthWest = 1f;
        } else {
            // 角点高度仅采样流体实际可到达的邻格，参考 Sodium 的 improvedFluidShaping。


            // 面可见性与流体可达性不能混用：同种流体无共享面，但液面仍连续。


            boolean northExposed = this.isFluidSideExposed(x, y, z - 1, self, 1f);
            boolean southExposed = this.isFluidSideExposed(x, y, z + 1, self, 1f);
            boolean westExposed = this.isFluidSideExposed(x - 1, y, z, self, 1f);
            boolean eastExposed = this.isFluidSideExposed(x + 1, y, z, self, 1f);

            float heightNorth = this.fluidHeight(x, y, z - 1, self);
            float heightSouth = this.fluidHeight(x, y, z + 1, self);
            float heightEast = this.fluidHeight(x + 1, y, z, self);
            float heightWest = this.fluidHeight(x - 1, y, z, self);

            heightNorthEast = avgHeight(self, heightSelf, heightNorth, heightEast,
                x + 1, y, z - 1, northExposed, eastExposed);
            heightNorthWest = avgHeight(self, heightSelf, heightNorth, heightWest,
                x - 1, y, z - 1, northExposed, westExposed);
            heightSouthEast = avgHeight(self, heightSelf, heightSouth, heightEast,
                x + 1, y, z + 1, southExposed, eastExposed);
            heightSouthWest = avgHeight(self, heightSelf, heightSouth, heightWest,
                x - 1, y, z + 1, southExposed, westExposed);
        }

        float fx = x, fy = y, fz = z;
        float offs = 0.001f;
        float bottomOffs = renderDown ? 0.001f : 0f;

        String stillSprite = lava ? "minecraft:block/lava_still" : "minecraft:block/water_still";
        String flowSprite = lava ? "minecraft:block/lava_flow" : "minecraft:block/water_flow";


        if (renderUp && !isFluidFaceOccludedBy(Direction.UP,
                Math.min(Math.min(heightNorthWest, heightSouthWest), Math.min(heightSouthEast, heightNorthEast)),
                above)) {
            heightNorthWest -= 0.001f;
            heightSouthWest -= 0.001f;
            heightSouthEast -= 0.001f;
            heightNorthEast -= 0.001f;

            // 流动纹理按流向旋转，静止纹理保持轴对齐。

            double[] flow = this.fluidFlow(x, y, z, self);
            float u00, v00, u01, v01, u10, v10, u11, v11;
            if (flow[0] == 0.0 && flow[1] == 0.0) {

                u00 = 0f; v00 = 0f;
                u01 = 0f; v01 = 1f;
                u10 = 1f; v10 = 1f;
                u11 = 1f; v11 = 0f;
            } else {
                float angle = (float) Math.atan2(flow[1], flow[0]) - (float) (Math.PI / 2);
                float s = (float) Math.sin(angle) * 0.25f;
                float c = (float) Math.cos(angle) * 0.25f;
                u00 = 0.5f + (-c - s);
                v00 = 0.5f + (-c + s);
                u01 = 0.5f + (-c + s);
                v01 = 0.5f + (c + s);
                u10 = 0.5f + (c + s);
                v10 = 0.5f + (c - s);
                u11 = 0.5f + (c - s);
                v11 = 0.5f + (-c - s);
            }
            float[] xs = {fx, fx, fx + 1, fx + 1};
            float[] ys = {fy + heightNorthWest, fy + heightSouthWest, fy + heightSouthEast, fy + heightNorthEast};
            float[] zs = {fz, fz + 1, fz + 1, fz};
            float[] topLight = new float[3];
            this.fluidLightColor(x, y, z, topLight);
            this.addFluidQuad(mesh, xs, ys, zs, u00, v00, u01, v01, u10, v10, u11, v11,
                flow[0] == 0.0 && flow[1] == 0.0 ? stillSprite : flowSprite,
                tr, tg, tb, CARDINAL[Quad.UP], topLight, true,x,y,z,Quad.UP,lava?15:0);
        }


        if (renderDown) {
            float[] xs = {fx, fx + 1, fx + 1, fx};
            float[] ys = {fy + bottomOffs, fy + bottomOffs, fy + bottomOffs, fy + bottomOffs};
            float[] zs = {fz, fz, fz + 1, fz + 1};
            float[] downLight = new float[3];
            this.fluidLightColor(x, y, z, downLight);
            this.addFluidQuad(mesh, xs, ys, zs, 0f, 0f, 1f, 0f, 1f, 1f, 0f, 1f,
                stillSprite, tr, tg, tb, CARDINAL[Quad.DOWN], downLight, false,x,y,z,Quad.DOWN,lava?15:0);
        }


        // 侧面仅采样流动纹理的下半部分，V 随液面高度变化，不拉伸整帧。


        for (int faceDir = 0; faceDir < 6; faceDir++) {
            float hh0, hh1, x0, z0, x1, z1;
            boolean renderCondition;
            BlockState faceState;
            switch (faceDir) {
                case Quad.NORTH -> {
                    hh0 = heightNorthWest; hh1 = heightNorthEast;
                    x0 = fx; x1 = fx + 1; z0 = fz + offs; z1 = fz + offs;
                    renderCondition = renderNorth; faceState = this.blockAt(x, y, z - 1);
                }
                case Quad.SOUTH -> {
                    hh0 = heightSouthEast; hh1 = heightSouthWest;
                    x0 = fx + 1; x1 = fx; z0 = fz + 1 - offs; z1 = fz + 1 - offs;
                    renderCondition = renderSouth; faceState = this.blockAt(x, y, z + 1);
                }
                case Quad.WEST -> {
                    hh0 = heightSouthWest; hh1 = heightNorthWest;
                    x0 = fx + offs; x1 = fx + offs; z0 = fz + 1; z1 = fz;
                    renderCondition = renderWest; faceState = this.blockAt(x - 1, y, z);
                }
                case Quad.EAST -> {
                    hh0 = heightNorthEast; hh1 = heightSouthEast;
                    x0 = fx + 1 - offs; x1 = fx + 1 - offs; z0 = fz; z1 = fz + 1;
                    renderCondition = renderEast; faceState = this.blockAt(x + 1, y, z);
                }
                default -> { continue; }
            }
            if (!renderCondition) continue;
            if (isFluidFaceOccludedBy(faceDir, Math.max(hh0, hh1), faceState)) continue;

            float u0 = 0f, u1 = 0.5f;
            float v01 = (1f - hh0) * 0.5f;
            float v02 = (1f - hh1) * 0.5f;
            float v1 = 0.5f;
            boolean alongZ = (faceDir == Quad.NORTH || faceDir == Quad.SOUTH);
            float shadeSide = alongZ ? CARDINAL[Quad.NORTH] : CARDINAL[Quad.WEST];
            float faceShade = CARDINAL[Quad.UP] * shadeSide;

            float[] xs = {x0, x1, x1, x0};
            float[] ys = {fy + hh0, fy + hh1, fy + bottomOffs, fy + bottomOffs};
            float[] zs = {z0, z1, z1, z0};
            float[] sideLight = new float[3];
            this.fluidLightColor(x, y, z, sideLight);
            boolean overlay = !lava && (MERGING.contains(faceState.blockId)
                || faceState.blockId.endsWith("_leaves"));
            this.addFluidQuad(mesh, xs, ys, zs, u0, v01, u1, v02, u1, v1, u0, v1,
                overlay ? "minecraft:block/water_overlay" : flowSprite,
                tr, tg, tb, faceShade, sideLight, !overlay,x,y,z,faceDir,lava?15:0);
        }
    }

    /** 明确列出六方向，与原版 Direction 序号一致。 */
    private static final class Direction {
        static final int DOWN = Quad.DOWN, UP = Quad.UP, NORTH = Quad.NORTH;
        static final int SOUTH = Quad.SOUTH, WEST = Quad.WEST, EAST = Quad.EAST;
    }

    private void addFluidQuad(SceneMesh mesh, float[] xs, float[] ys, float[] zs,
                              float u0, float v0, float u1, float v1,
                              float u2, float v2, float u3, float v3,
                              String sprite, float tr, float tg, float tb, float shade, float[] light,
                              boolean addBackFace,int x,int y,int z,int face,int emission) {
        if(!lightingEnabled)shade=1f;
        float baseR=tr,baseG=tg,baseB=tb;
        tr *= light[0]; tg *= light[1]; tb *= light[2];
        // 水和玻璃共用按相机排序的混合通道。
        SceneMesh.MeshQuad mq = new SceneMesh.MeshQuad(xs, ys, zs,
            u0, v0, u1, v1, u2, v2, u3, v3,
            sprite, 0xFFFFFFFF, null, tr, tg, tb, shade, null, SceneMesh.Layer.TRANSLUCENT, false);
        if(lightingEnabled&&realLighting&&smoothLighting!=null) {
            float[] localX=new float[4],localY=new float[4],localZ=new float[4];
            for(int i=0;i<4;i++){localX[i]=xs[i]-x;localY[i]=ys[i]-y;localZ[i]=zs[i]-z;}
            var quad=new Quad(localX,localY,localZ,new float[4],new float[4],face,sprite,-1,face,emission);
            mq.colors(smoothLighting.colors(x,y,z,quad,mq,baseR,baseG,baseB));
        }
        mesh.translucent.add(mq);
        if (!addBackFace) return;
        // 通过反向绕序保证从任一方向只看到一面。
        SceneMesh.MeshQuad back = new SceneMesh.MeshQuad(
            new float[]{xs[0], xs[3], xs[2], xs[1]},
            new float[]{ys[0], ys[3], ys[2], ys[1]},
            new float[]{zs[0], zs[3], zs[2], zs[1]},
            u0, v0, u3, v3, u2, v2, u1, v1,
            sprite, 0xFFFFFFFF, null, tr, tg, tb, shade, null, SceneMesh.Layer.TRANSLUCENT, false);
        if(mq.vertexColors!=null)back.colors(new int[]{mq.vertexColors[0],mq.vertexColors[3],mq.vertexColors[2],mq.vertexColors[1]});
        mesh.translucent.add(back);
    }

    /** 流体读取自身和上方格的光照最大值，避免瀑布错误变暗。 */
    private void fluidLightColor(int x, int y, int z, float[] out) {
        if (this.light == null) { out[0] = out[1] = out[2] = 1f; return; }
        int ox = x - this.lightOrigin[0], oy = y - this.lightOrigin[1], oz = z - this.lightOrigin[2];
        int packed = LightVolume.max(activeLight().cellLight(ox, oy, oz),
            activeLight().cellLight(ox, oy + 1, oz));
        LightVolume.brightness(packed, out);
    }

    private static String fluidKey(BlockState s) {
        return s.blockId.equals("minecraft:bubble_column") ? "minecraft:water" : s.blockId;
    }

    /** 方块可以自身为流体，也可以通过 waterlogged 状态包含静水。 */
    private static String fluidKeyOrNull(BlockState s) {
        if (FLUIDS.contains(s.blockId)) return fluidKey(s);


        if (isWaterlogged(s)) return "minecraft:water";
        return null;
    }

    private boolean isSameFluid(int x, int y, int z, String self) {
        String k = fluidKeyOrNull(this.blockAt(x, y, z));
        return k != null && k.equals(self);
    }

    /** 上方为同种流体时高度为 1；实心邻居返回 -1，可透光空格返回 0。 */
    private float fluidHeight(int x, int y, int z, String self) {
        BlockState s = this.blockAt(x, y, z);
        String k = fluidKeyOrNull(s);
        if (k != null && k.equals(self)) {
            if (isSameFluid(x, y + 1, z, self)) return 1f;
            return ownHeight(s, x, y, z);
        }
        return this.shapes.isShapeFullBlock(s) ? -1f : 0f;
    }


    /** 水源高度为 8/9，流动水量为 8-level；level 表示离水源的衰减距离。 */
    private float ownHeight(BlockState s, int x, int y, int z) {
        String level = s.getValue("level");
        if (level == null) return 8f / 9f;
        try {
            int l = Integer.parseInt(level);
            int amount = (l == 0 || l >= 8) ? 8 : (8 - l);
            return amount / 9f;
        } catch (NumberFormatException e) {
            return 8f / 9f;
        }
    }

    /** 高度不小于 0.8 的样本权重为十，其余权重为一；实心邻居不参与平均。 */
    private float avgHeight(String self, float hSelf, float h1, float h2,
                            int cornerX, int cornerY, int cornerZ,
                            boolean exposed1, boolean exposed2) {
        if (h1 >= 1f || h2 >= 1f) return 1f;
        float sum = 0, weight = 0;
        // 只有存在绕过角点的可达路径时，才采样对角格。
        boolean cornerReachable = exposed1 && exposed2;
        if ((exposed1 || exposed2) && (h1 > 0f || h2 > 0f)) {
            float hCorner = this.fluidHeight(cornerX, cornerY, cornerZ, self);
            if (hCorner >= 1f) return 1f;
            if (cornerReachable || hCorner < 0.8f) {
                if (hCorner >= 0.8f) { sum += hCorner * 10f; weight += 10f; }
                else if (hCorner >= 0f) { sum += hCorner; weight += 1f; }
            }
        }
        if (exposed1 && h1 >= 0f) {
            if (h1 >= 0.8f) { sum += h1 * 10f; weight += 10f; } else { sum += h1; weight += 1f; }
        }
        if (exposed2 && h2 >= 0f) {
            if (h2 >= 0.8f) { sum += h2 * 10f; weight += 10f; } else { sum += h2; weight += 1f; }
        }
        if (hSelf >= 0.8f) { sum += hSelf * 10f; weight += 10f; } else if (hSelf >= 0f) { sum += hSelf; weight += 1f; }
        return weight == 0f ? 0f : sum / weight;
    }

    /** 按 Sodium 的流体侧向暴露规则判断连通性：透明形状保持开放，部分形状与液体实际高度比较。 */
    private boolean isFluidSideExposed(int nx, int ny, int nz, String self, float height) {
        if (height <= 0f) return false;
        BlockState neighbor = this.blockAt(nx, ny, nz);
        if (neighbor == null || neighbor.isAir()) return true;
        // 同种流体之间不隔离，表面连续。
        String k = fluidKeyOrNull(neighbor);
        if (k != null && k.equals(self)) return true;
        if (!this.shapes.occludes(neighbor)) return true;

        return !this.shapes.isShapeFullBlock(neighbor);
    }

    /** 按原版流体高差计算流向，空邻居和含同种流体的邻居均参与计算。 */
    private double[] fluidFlow(int x, int y, int z, String self) {
        double flowX = 0, flowZ = 0;
        float selfHeight = ownHeight(this.blockAt(x, y, z), x, y, z);
        int[][] dirs = {{0, 0, -1}, {0, 0, 1}, {-1, 0, 0}, {1, 0, 0}};
        for (int[] d : dirs) {
            int nx = x + d[0], nz = z + d[2];
            BlockState ns = this.blockAt(nx, y, nz);


            String nk = fluidKeyOrNull(ns);
            boolean sameFluid = nk != null && nk.equals(self);
            if (!ns.isAir() && !sameFluid) continue;

            float neighborHeight = sameFluid ? ownHeight(ns, nx, y, nz) : 0f;
            float distance = 0f;
            if (neighborHeight == 0f) {
                BlockState belowNeighbor = this.blockAt(nx, y - 1, nz);
                String bk = fluidKeyOrNull(belowNeighbor);
                if (bk != null && bk.equals(self)) {
                    neighborHeight = ownHeight(belowNeighbor, nx, y - 1, nz);
                    if (neighborHeight > 0f) {
                        distance = selfHeight - (neighborHeight - MAX_FLUID_HEIGHT);
                    }
                }
            } else {
                distance = selfHeight - neighborHeight;
            }
            if (distance != 0f) {
                flowX += d[0] * distance;
                flowZ += d[2] * distance;
            }
        }

        // 下落水被拉向存在实心侧面的方向，体现溢出来源。

        if (isFalling(this.blockAt(x, y, z))) {
            for (int[] d : dirs) {
                int nx = x + d[0], nz = z + d[2];
                if (isSolidFace(nx, y, nz, self) || isSolidFace(nx, y + 1, nz, self)) {
                    double len = Math.sqrt(flowX * flowX + flowZ * flowZ);
                    if (len > 1e-6) {
                        flowX /= len;
                        flowZ /= len;
                    }
                    flowZ -= 6.0;
                    break;
                }
            }
        }
        double len = Math.sqrt(flowX * flowX + flowZ * flowZ);
        if (len > 1e-6) {
            flowX /= len;
            flowZ /= len;
        }
        return new double[]{flowX, flowZ};
    }

    /** 判断流体是否显式下落，或下方已没有相同流体。 */
    private boolean isFalling(BlockState s) {
        String f = s.getValue("falling");
        if (f != null) return Boolean.parseBoolean(f);
        return false;
    }

    /** 流体实心侧面要求邻居不是同种流体，且对应遮挡面填满方块。 */
    private boolean isSolidFace(int x, int y, int z, String self) {
        BlockState s = this.blockAt(x, y, z);
        String k = fluidKeyOrNull(s);
        if (k != null && k.equals(self)) return false;
        if (s.isAir()) return false;
        return this.shapes.occludes(s);
    }

    /** 面可见性只检查自身遮挡形状，邻居测试留到绘制时按液面真实高度执行。 */
    private boolean shouldRenderFluidFace(int x, int y, int z, int face, String self) {
        int[] d = FACE_DELTAS[face];
        return !isSameFluid(x + d[0], y + d[1], z + d[2], self)
            && !this.shapes.occludes(this.blockAt(x, y, z));
    }

    /** 透明空形状不遮挡，完整形状完全遮挡，部分形状与流体高度盒比较。 */
    private boolean isFluidFaceOccludedBy(int face, float height, BlockState neighbor) {
        if (neighbor == null || neighbor.isAir()) return false;
        if (!this.shapes.occludes(neighbor)) return false;
        boolean fullBlock = height == 1.0f;
        return face != Quad.UP || fullBlock;
    }

    // ------------------------------------------------------------------


    /** 按实际 UV 区域分类材质，水和玻璃共同进入混合通道。 */
    private SceneMesh.Layer layerOf(String blockId, Quad q) {
        if (blockId.equals("minecraft:nether_portal")) return SceneMesh.Layer.PORTAL;
        if (FLUIDS.contains(blockId)) return SceneMesh.Layer.TRANSLUCENT;
        if (TRANSLUCENT_IDS.contains(blockId)) return SceneMesh.Layer.TRANSLUCENT;
        io.github.litematicrender.render.Transparency t = this.atlas.transparencyOf(q.spriteId,
            q.u0, q.v0, q.u1, q.v1, q.u2, q.v2, q.u3, q.v3, q.forceTranslucent);
        if (t.hasTranslucent()) return SceneMesh.Layer.TRANSLUCENT;
        if (t.hasTransparent()) return SceneMesh.Layer.CUTOUT;
        return SceneMesh.Layer.SOLID;
    }


    private static final java.util.Set<String> TRANSLUCENT_IDS = java.util.Set.of(
        "minecraft:ice", "minecraft:frosted_ice", "minecraft:slime_block", "minecraft:honey_block"
    );
}
