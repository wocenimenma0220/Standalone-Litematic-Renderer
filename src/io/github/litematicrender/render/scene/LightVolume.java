package io.github.litematicrender.render.scene;

import io.github.litematicrender.world.BlockShape;
import io.github.litematicrender.world.BlockState;

/** 离线计算天空光和方块光，随后采样为顶点光照；兼容旧版明亮外观和平滑光照模式。 */
public final class LightVolume implements LightSampler {
    private final int sx, sy, sz;
    private final BlockState[] cells;
    @FunctionalInterface public interface Cells {BlockState at(int x,int y,int z);}
    private final Cells source;
    private final BlockShape shapes;
    private final LightGrid sky;
    private final LightGrid block;
    private final boolean realLighting;


    private int maxEmission;

    /** 分配前为引用、光照通道、传播队列、模型和缓存预留内存。 */
    public static int checkedCellCount(long sx, long sy, long sz) {
        long count;
        try { count = Math.multiplyExact(Math.multiplyExact(sx, sy), sz); }
        catch (ArithmeticException error) { throw new IllegalArgumentException("投影区域跨度过大，无法计算光照；请缩小区域之间的距离。", error); }
        if (sx <= 0 || sy <= 0 || sz <= 0 || count > Integer.MAX_VALUE - 8)
            throw new IllegalArgumentException("投影区域跨度过大，无法计算光照；请缩小区域之间的距离。");
        Runtime runtime = Runtime.getRuntime();
        long available = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory());

        if (count > Math.max(1, available / 32))
            throw new IllegalArgumentException("投影区域跨度过大，光照所需内存不足；请拆分投影或缩小空白区域。");
        return (int)count;
    }

    public LightVolume(int sx, int sy, int sz, BlockState[] cells, BlockShape shapes) {
        this(sx, sy, sz, cells, shapes, false);
    }

    public LightVolume(int sx, int sy, int sz, BlockState[] cells, BlockShape shapes, boolean realLighting) {
        this.realLighting = realLighting;
        this.sx = sx;
        this.sy = sy;
        this.sz = sz;
        this.cells = cells;
        this.source = null;
        this.shapes = shapes;
        int count = checkedCellCount(sx, sy, sz);
        if (cells.length != count) throw new IllegalArgumentException("light volume dimensions do not match cells");
        this.sky = new LightGrid(count);
        this.block = new LightGrid(count);
    }
    /** 流式场景只保留光照和传播队列，方块状态继续压缩存储。 */
    public static int checkedCompactCellCount(long sx,long sy,long sz) {
        long count;try{count=Math.multiplyExact(Math.multiplyExact(sx,sy),sz);}catch(ArithmeticException error){throw new IllegalArgumentException("光照范围过大",error);}
        if(sx<=0||sy<=0||sz<=0||count>Integer.MAX_VALUE-8)throw new IllegalArgumentException("光照范围过大");
        Runtime runtime=Runtime.getRuntime();long needed=count*12+32L*1024*1024;
        if(needed>runtime.maxMemory()*.85)throw new IllegalArgumentException("光照网格超出内存预算");
        long available=runtime.maxMemory()-(runtime.totalMemory()-runtime.freeMemory());
        if(available<needed){System.gc();available=runtime.maxMemory()-(runtime.totalMemory()-runtime.freeMemory());}
        if(available<needed)throw new IllegalArgumentException("光照网格内存不足");return (int)count;
    }
    public LightVolume(int sx,int sy,int sz,Cells source,BlockShape shapes,boolean realLighting) {
        this.sx=sx;this.sy=sy;this.sz=sz;this.source=source;this.cells=null;this.shapes=shapes;this.realLighting=realLighting;
        int count=checkedCompactCellCount(sx,sy,sz);this.sky=new LightGrid(count);this.block=new LightGrid(count);
    }

    public long payloadBytes(){return sky.payloadBytes()+block.payloadBytes();}

    private int idx(int x, int y, int z) {
        return (y * this.sz + z) * this.sx + x;
    }

    private boolean inside(int x, int y, int z) {
        return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
    }

    private BlockState at(int x, int y, int z) {
        return source==null?this.cells[this.idx(x, y, z)]:source.at(x,y,z);
    }

    private boolean opaque(int x, int y, int z) {
        return this.shapes.occludes(this.at(x, y, z));
    }

    private boolean permeable(int x, int y, int z) {
        return this.shapes.lightPermeable(this.at(x, y, z));
    }


    public void compute() {
        if (this.realLighting) {
            seedRealLight();
            if(maxEmission==0)spreadReal(this.sky,true);else parallel(() -> spreadReal(this.sky, true), () -> spreadReal(this.block, false));
            sky.compact();block.compact();return;
        }
        this.seedSky();
        parallel(this::spreadSky, () -> { this.seedBlock();this.spreadBlock(); });
        sky.compact();block.compact();
    }

    /** 天空光和方块光使用独立网格，可以并行传播。 */
    private void parallel(Runnable first,Runnable second) {
        if(!Boolean.parseBoolean(System.getProperty("litematicrender.light.parallel","true"))||(long)sx*sy*sz<262_144||Runtime.getRuntime().availableProcessors()<2){first.run();second.run();return;}
        var failure=new java.util.concurrent.atomic.AtomicReference<Throwable>();
        Thread a=Thread.ofPlatform().name("schematic-sky-light").daemon(true).unstarted(()->{try{first.run();}catch(Throwable error){failure.compareAndSet(null,error);}});
        Thread b=Thread.ofPlatform().name("schematic-block-light").daemon(true).unstarted(()->{try{second.run();}catch(Throwable error){failure.compareAndSet(null,error);}});
        a.start();b.start();
        try{a.join();b.join();}catch(InterruptedException stopped){a.interrupt();b.interrupt();Thread.currentThread().interrupt();throw new java.util.concurrent.CancellationException("光照计算已取消");}
        Throwable error=failure.get();if(error instanceof RuntimeException runtime)throw runtime;if(error instanceof Error fatal)throw fatal;if(error!=null)throw new IllegalStateException(error);
    }


    private void seedRealLight() {
        sky.fill(15);
        byte[] columns=new byte[sx*sz];java.util.Arrays.fill(columns,(byte)15);
        // 按 Y 层连续读取压缩方块页，避免逐列扫描反复淘汰邻列需要的解压页。

        for (int y=sy-1;y>=0;y--) for (int z=0;z<sz;z++) {
            if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
            for (int x=0;x<sx;x++) {
                BlockState state=at(x,y,z);
                int opacity=skyOpacity(state,shapes);
                int column=z*sx+x,level=columns[column];
                level=Math.max(0,level-(opacity==0 && level==15?0:Math.max(1,opacity)));columns[column]=(byte)level;
                int index=idx(x,y,z);sky.set(index,shapes.lightPermeable(state)?level:0);
                int emission=realEmission(state);if(emission>0){block.set(index,emission);maxEmission=Math.max(maxEmission,emission);}
            }
        }
    }

    private static final int[][] DIRECTIONS={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};

    /** 队列中每格最多保留一项，存储量随传播前沿增长。 */
    private void spreadReal(LightGrid values, boolean skylight) {
        var queue=new IntQueue(values.length);
        var queued=new java.util.BitSet(values.length);
        for(int i=0;i<values.length;i++)if(values.get(i)>1) {
            int x=i%sx,y=i/sx/sz,z=i/sx%sz;
            if(couldIncrease(values,x,y,z,values.get(i),skylight)){queue.add(i);queued.set(i);}
        }
        while(queue.size>0) {
            if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
            int position=queue.remove();queued.clear(position);
            int x=position%sx,y=position/sx/sz,z=position/sx%sz,level=values.get(position);
            if(level<=1)continue;
            for(int d=0;d<6;d++) {
                int nx=x+DIRECTIONS[d][0],ny=y+DIRECTIONS[d][1],nz=z+DIRECTIONS[d][2];
                if(!inside(nx,ny,nz))continue;
                int destination=idx(nx,ny,nz),upper=skylight&&d==3&&level==15?15:level-1;
                if(values.get(destination)>=upper)continue;
                BlockState target=at(nx,ny,nz);
                if(!shapes.lightPermeable(target))continue;
                int opacity=skylight?skyOpacity(target,shapes):blockOpacity(target,shapes);
                int cost=skylight&&d==3&&level==15&&opacity==0?0:Math.max(1,opacity);
                int next=level-cost;
                if(next>values.get(destination)) {
                    values.set(destination,next);
                    if(next>1&&!queued.get(destination)){queue.add(destination);queued.set(destination);}
                }
            }
        }
    }
    private boolean couldIncrease(LightGrid values,int x,int y,int z,int level,boolean skylight) {
        for(int d=0;d<6;d++) {
            int nx=x+DIRECTIONS[d][0],ny=y+DIRECTIONS[d][1],nz=z+DIRECTIONS[d][2];
            if(inside(nx,ny,nz)&&values.get(idx(nx,ny,nz))<(skylight&&d==3&&level==15?15:level-1))return true;
        }
        return false;
    }
    private static final class IntQueue {
        private final int limit;
        private int[] values=new int[0];private int head,size;
        IntQueue(int limit){this.limit=limit;}
        void add(int value) {
            if(size==values.length) {
                int capacity=(int)Math.min(limit,Math.max(1024L,(long)values.length*2));
                if(capacity<=values.length)throw new IllegalStateException("light queue overflow");
                int[] grown=new int[capacity];
                for(int i=0;i<size;i++)grown[i]=values[(head+i)%values.length];
                values=grown;head=0;
            }
            values[(head+size)%values.length]=value;size++;
        }
        int remove(){int result=values[head];head=(head+1)%values.length;size--;return result;}
    }

    /** 为暴露于天空的可透光列设置初始天空光；顶部不透明时不能播种。 */
    private void seedSky() {
        for (int z = 0; z < this.sz; z++) {
            if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
            for (int x = 0; x < this.sx; x++) {
                // 保持 1.0.8 的明亮结果，包括被覆盖的可透光格。
                int y = this.sy - 1;
                while (y >= 0 && !this.permeable(x, y, z)) y--;
                for (; y >= 0; y--) if (this.permeable(x, y, z)) this.sky.set(this.idx(x, y, z),15);
            }
        }
    }

    private void spreadSky() {
        // 原版 15 级天空光向下传播时不衰减，其他方向按正常规则传播。


        int[] queue = new int[this.sky.length];
        int head=0,tail=0;
        for (int i = 0; i < this.sky.length; i++) {
            if (this.sky.get(i) > 1) queue[tail++]=i;
        }
        int[][] dirs = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        while (head<tail) {
            if((head&4095)==0&&Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
            int position=queue[head++];
            int x=position%this.sx,y=(position/this.sx)/this.sz,z=(position/this.sx)%this.sz;
            int level = this.sky.get(this.idx(x, y, z));
            if (level <= 1) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1], nz = z + d[2];
                if (!this.inside(nx, ny, nz) || !this.permeable(nx, ny, nz)) continue;
                boolean down = d[1] == -1 && level == 15;
                BlockState target = this.at(nx, ny, nz);
                int cost = down ? 0 : (target != null && target.blockId.equals("minecraft:water") ? 2 : 1);
                int next = level - cost;
                if (next > this.sky.get(this.idx(nx, ny, nz))) {
                    this.sky.set(this.idx(nx, ny, nz),next);
                    int destination=this.idx(nx,ny,nz);
                    if(next>1 && tail<queue.length) queue[tail++]=destination;
                }
            }
        }
    }


    private void seedBlock() {
        for (int i = 0; i < this.block.length; i++) {
            BlockState s = source==null?this.cells[i]:source.at(i%sx,(i/sx)/sz,(i/sx)%sz);
            if (s == null) continue;
            int emission = this.realLighting ? realEmission(s) : emission(s);
            if (emission > 0) {
                this.block.set(i,emission);
                this.maxEmission = Math.max(this.maxEmission, emission);
            }
        }
    }

    private void spreadBlock() {
        if (this.maxEmission == 0) return;
        int[] queue = new int[this.block.length];
        int head=0,tail=0;
        for (int i = 0; i < this.block.length; i++) {
            if (this.block.get(i) > 1) queue[tail++]=i;
        }
        int[][] dirs = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        while(head<tail) {
            if((head&4095)==0&&Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
            int position=queue[head++];
            int x=position%this.sx,y=(position/this.sx)/this.sz,z=(position/this.sx)%this.sz;
            int level = this.block.get(this.idx(x, y, z));
            if (level <= 1) continue;
            for (int[] d : dirs) {
                int nx = x + d[0], ny = y + d[1], nz = z + d[2];
                if (!this.inside(nx, ny, nz) || !this.permeable(nx, ny, nz)) continue;
                int next = level - 1;
                if (next > this.block.get(this.idx(nx, ny, nz))) {
                    this.block.set(this.idx(nx, ny, nz),next);
                    int destination=this.idx(nx,ny,nz);
                    if(next>1 && tail<queue.length) queue[tail++]=destination;
                }
            }
        }
    }


    /** 面片读取朝向一侧的相邻格光照，天空光和方块光分别返回。 */
    public int faceLight(int x, int y, int z, int dx, int dy, int dz) {
        int nx = x + dx, ny = y + dy, nz = z + dz;
        if (!this.inside(nx, ny, nz)) return pack(15, 0);
        int i = this.idx(nx, ny, nz);
        return pack(this.sky.get(i) & 0xFF, this.block.get(i) & 0xFF);
    }

    /** 无固定剔除面的几何读取自身位置的两个光照通道。 */
    public int cellLight(int x, int y, int z) {
        if (!this.inside(x, y, z)) return pack(15, 0);
        int i = this.idx(x, y, z);
        return pack(this.sky.get(i) & 0xFF, this.block.get(i) & 0xFF);
    }

    private static int pack(int sky, int block) {
        return ((sky & 0xFF) << 8) | (block & 0xFF);
    }
    static int emission(BlockState state) {
        return state == null ? 0 : EMISSIONS.getOrDefault(state.blockId,0);
    }

    static int skyOpacity(BlockState state, BlockShape shapes) {
        if(state==null||state.isAir())return 0;
        if(state.blockId.equals("minecraft:tinted_glass")||shapes.occludes(state))return 15;
        return state.blockId.equals("minecraft:water")||"true".equals(state.getValue("waterlogged"))||state.blockId.endsWith("_leaves")?1:0;
    }

    // 光照吸收与渲染贴图的透明度分别处理。
    static int blockOpacity(BlockState state,BlockShape shapes) { return skyOpacity(state,shapes); }


    static int realEmission(BlockState state) {
        if(state==null||"false".equals(state.getValue("lit")))return 0;
        String id=state.blockId;
        if(id.equals("minecraft:light")) {
            try{return Math.max(0,Math.min(15,Integer.parseInt(state.getValue("level"))));}catch(Exception ignored){return 15;}
        }
        if(id.equals("minecraft:redstone_lamp"))return "true".equals(state.getValue("lit"))?15:0;
        if(id.equals("minecraft:furnace")||id.equals("minecraft:smoker")||id.equals("minecraft:blast_furnace"))return "true".equals(state.getValue("lit"))?13:0;
        if(id.equals("minecraft:candle")||id.endsWith("_candle")) {
            if(!"true".equals(state.getValue("lit")))return 0;
            try{return Math.min(12,Integer.parseInt(state.getValue("candles"))*3);}catch(Exception ignored){return 3;}
        }
        return switch(id) {
            case "minecraft:fire" -> 15;
            case "minecraft:soul_fire" -> 10;
            case "minecraft:redstone_wall_torch" -> 7;
            default -> emission(state);
        };
    }

    /** 流体分别取自身格和上方格的两个光照通道最大值。 */
    public static int max(int a, int b) {
        return pack(Math.max(skyOf(a), skyOf(b)), Math.max(blockOf(a), blockOf(b)));
    }


    public static int skyOf(int packed) { return (packed >> 8) & 0xFF; }


    public static int blockOf(int packed) { return packed & 0xFF; }


    /** 使用原版亮度曲线 v/(4-3v)，其中 v=level/15。 */
    public static float curve(int level) {
        float v = Math.max(0, Math.min(15, level)) / 15f;
        return v / (4f - 3f * v);
    }

    /** 环境色下限遵循主世界设置，保留微弱可见度。 */
    private static final float AMBIENT = Math.max(1f / 255f, 10f / 255f);


    private static final float BLOCK_TINT_R = ((-10100 >> 16) & 0xFF) / 255f;
    private static final float BLOCK_TINT_G = ((-10100 >> 8) & 0xFF) / 255f;
    private static final float BLOCK_TINT_B = (-10100 & 0xFF) / 255f;

    /** 按原版 lightmap.fsh 将天空光与方块光转换为纹理的 RGB 乘数。 */
    public static void brightness(int packed, float[] out) {
        float blockLevel = blockOf(packed) / 15f;
        float skyLevel = skyOf(packed) / 15f;
        float blockBrightness = curve(blockOf(packed));
        float skyBrightness = curve(skyOf(packed));


        float r = AMBIENT + skyBrightness;
        float g = AMBIENT + skyBrightness;
        float b = AMBIENT + skyBrightness;


        float mix = 0.9f * (2f * blockLevel - 1f) * (2f * blockLevel - 1f);
        float br = BLOCK_TINT_R + (1f - BLOCK_TINT_R) * mix;
        float bg = BLOCK_TINT_G + (1f - BLOCK_TINT_G) * mix;
        float bb = BLOCK_TINT_B + (1f - BLOCK_TINT_B) * mix;
        r += br * blockBrightness;
        g += bg * blockBrightness;
        b += bb * blockBrightness;

        out[0] = Math.min(1f, r);
        out[1] = Math.min(1f, g);
        out[2] = Math.min(1f, b);
    }

    /** 按方块标识和保存状态查询原版发光强度。 */
    private static final java.util.Map<String, Integer> EMISSIONS = java.util.Map.ofEntries(
        java.util.Map.entry("minecraft:torch", 14),
        java.util.Map.entry("minecraft:soul_torch", 10),
        java.util.Map.entry("minecraft:redstone_torch", 7),
        java.util.Map.entry("minecraft:wall_torch", 14),
        java.util.Map.entry("minecraft:soul_wall_torch", 10),
        java.util.Map.entry("minecraft:lantern", 15),
        java.util.Map.entry("minecraft:soul_lantern", 10),
        java.util.Map.entry("minecraft:glowstone", 15),
        java.util.Map.entry("minecraft:sea_lantern", 15),
        java.util.Map.entry("minecraft:shroomlight", 15),
        java.util.Map.entry("minecraft:ochre_froglight", 15),
        java.util.Map.entry("minecraft:verdant_froglight", 15),
        java.util.Map.entry("minecraft:pearlescent_froglight", 15),
        java.util.Map.entry("minecraft:beacon", 15),
        java.util.Map.entry("minecraft:end_rod", 14),
        java.util.Map.entry("minecraft:campfire", 15),
        java.util.Map.entry("minecraft:soul_campfire", 10),
        java.util.Map.entry("minecraft:jack_o_lantern", 15),
        java.util.Map.entry("minecraft:lava", 15),
        java.util.Map.entry("minecraft:magma_block", 3),
        java.util.Map.entry("minecraft:glow_lichen", 7),
        java.util.Map.entry("minecraft:amethyst_cluster", 5),
        java.util.Map.entry("minecraft:crying_obsidian", 10),
        java.util.Map.entry("minecraft:light", 15),
        java.util.Map.entry("minecraft:ochre_candle", 3)
    );
}
