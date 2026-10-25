package io.github.litematicrender.world;

import io.github.litematicrender.model.ModelBaker;
import io.github.litematicrender.model.Quad;
import io.github.litematicrender.render.SpriteAtlas;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 几何分类分别判断模型是否填满方块，以及能否遮挡邻面，不能把透明完整立方体当成遮挡体。 */
public final class BlockShape {
    /** 原版完整碰撞立方体的 AO 亮度为 0.2。 */
    public static final float SHADE_FULL_BLOCK = 0.2f;

    public static final float SHADE_OPEN = 1.0f;

    private final ModelBaker baker;
    private final SpriteAtlas atlas;
    /** 只判断几何是否为完整立方体，不考虑透明度。 */
    private final Map<BlockState, Boolean> fullCubeCache = new ConcurrentHashMap<>();
    /** 同时满足完整立方体和完全不透明时才能遮挡邻面。 */
    private final Map<BlockState, Boolean> occluderCache = new ConcurrentHashMap<>();
    private final Map<BlockState,long[][]> faceMasks=new ConcurrentHashMap<>();
    private final Map<Quad,long[]> quadMasks=new java.util.IdentityHashMap<>();

    /** 保守使用 16×16 边界覆盖，裁剪和半透明区域不作为完整遮挡。 */
    public boolean faceOccluded(Quad source,int face,BlockState neighbor) {
        if(neighbor==null||neighbor.isAir()||BlockRegistry.isHead(neighbor.blockId))return false;
        long[] required=quadMasks.computeIfAbsent(source,q->quadMask(q,face,false));
        if(required==null)return false;
        long[] coverage=faceMasks.computeIfAbsent(neighbor,this::buildMasks)[face^1];
        boolean any=false;
        for(int i=0;i<4;i++){any|=required[i]!=0;if((required[i]&~coverage[i])!=0)return false;}
        return any;
    }
    private long[][] buildMasks(BlockState state) {
        long[][] result=new long[6][4];
        for(var variant:this.baker.selectVariants(state.blockId,state)) {
            var model=this.baker.bake(variant);if(model==null)continue;
            for(int face=0;face<6;face++)for(Quad quad:model.quadsForFace(face)) {
                var transparency=this.atlas.transparencyOf(quad.spriteId,quad.u0,quad.v0,quad.u1,quad.v1,quad.u2,quad.v2,quad.u3,quad.v3,quad.forceTranslucent);
                if(transparency.hasTransparent()||transparency.hasTranslucent())continue;
                long[] mask=quadMask(quad,face,true);if(mask!=null)for(int word=0;word<4;word++)result[face][word]|=mask[word];
            }
        }
        return result;
    }
    private static long[] quadMask(Quad q,int face,boolean inward) {
        float[] x={q.x0,q.x1,q.x2,q.x3},y={q.y0,q.y1,q.y2,q.y3},z={q.z0,q.z1,q.z2,q.z3};
        float[] normal=face<2?y:face<4?z:x,a=face<4?x:z,b=face<2?z:y;
        if(!allEqual(normal,(face&1)==0?0:1))return null;
        float loA=min(a),hiA=max(a),loB=min(b),hiB=max(b);
        if(loA<0||hiA>1||loB<0||hiB>1)return null;
        int corners=0;for(int i=0;i<4;i++){if(!(near(a[i],loA)||near(a[i],hiA))||!(near(b[i],loB)||near(b[i],hiB)))return null;corners|=1<<((near(a[i],hiA)?1:0)|(near(b[i],hiB)?2:0));}
        if(corners!=15)return null;
        int a0=inward?(int)Math.ceil(loA*16-1e-5):(int)Math.floor(loA*16+1e-5),a1=inward?(int)Math.floor(hiA*16+1e-5):(int)Math.ceil(hiA*16-1e-5);
        int b0=inward?(int)Math.ceil(loB*16-1e-5):(int)Math.floor(loB*16+1e-5),b1=inward?(int)Math.floor(hiB*16+1e-5):(int)Math.ceil(hiB*16-1e-5);
        long[] result=new long[4];for(int row=b0;row<b1;row++)for(int col=a0;col<a1;col++){int bit=row*16+col;result[bit>>6]|=1L<<(bit&63);}return result;
    }

    public BlockShape(ModelBaker baker, SpriteAtlas atlas) {
        this.baker = baker;
        this.atlas = atlas;
    }


    public boolean occludes(BlockState state) {
        if (state == null || state.isAir() || BlockRegistry.isHead(state.blockId)) return false;
        return this.occluderCache.computeIfAbsent(state, s -> {
            if (!isFullCubeModel(s)) return false;
            ModelBaker.BakedModel m = bakeSingle(s);
            return m != null && isOpaque(m);
        });
    }


    public boolean isShapeFullBlock(BlockState state) {
        if (state == null || state.isAir() || BlockRegistry.isHead(state.blockId)) return false;
        return isFullCubeModel(state);
    }

    /** 完整碰撞立方体通常降低 AO，但透明方块和 noOcclusion 类型仍保持明亮。 */
    public float shadeBrightness(BlockState state) {
        if (state == null || state.isAir()) return SHADE_OPEN;
        if (!this.occludes(state)) return SHADE_OPEN;
        return isShapeFullBlock(state) ? SHADE_FULL_BLOCK : SHADE_OPEN;
    }

    /** 透光条件独立判断，供 AO 对角采样使用。 */
    public boolean lightPermeable(BlockState state) {
        return state == null || state.isAir() || !occludes(state);
    }

    private boolean isFullCubeModel(BlockState state) {
        return this.fullCubeCache.computeIfAbsent(state, s -> isFullCube(bakeSingle(s)));
    }


    private ModelBaker.BakedModel bakeSingle(BlockState state) {
        try {
            List<ModelBaker.Variant> variants = this.baker.selectVariants(state.blockId, state);
            if (variants.size() != 1) return null;
            return this.baker.bake(variants.get(0));
        } catch (RuntimeException e) {
            return null;
        }
    }


    private static boolean isFullCube(ModelBaker.BakedModel model) {
        if (model == null || !model.unculled.isEmpty()) return false;
        for (int face = 0; face < 6; face++) {
            List<Quad> quads = model.quadsForFace(face);
            if (quads.size() != 1) return false;
            if (!spansWholeFace(quads.get(0), face)) return false;
        }
        return true;
    }

    /** 判断面是否位于外平面且覆盖完整 16×16 区域，烘焙后几何单位为方块。 */
    private static boolean spansWholeFace(Quad q, int face) {
        float[] xs = {q.x0, q.x1, q.x2, q.x3};
        float[] ys = {q.y0, q.y1, q.y2, q.y3};
        float[] zs = {q.z0, q.z1, q.z2, q.z3};

        float plane, minA, maxA, minB, maxB;
        switch (face) {
            case Quad.DOWN -> { plane = 0f; minA = min(xs); maxA = max(xs); minB = min(zs); maxB = max(zs); if (!allEqual(ys, 0f)) return false; }
            case Quad.UP -> { plane = 1f; minA = min(xs); maxA = max(xs); minB = min(zs); maxB = max(zs); if (!allEqual(ys, 1f)) return false; }
            case Quad.NORTH -> { plane = 0f; minA = min(xs); maxA = max(xs); minB = min(ys); maxB = max(ys); if (!allEqual(zs, 0f)) return false; }
            case Quad.SOUTH -> { plane = 1f; minA = min(xs); maxA = max(xs); minB = min(ys); maxB = max(ys); if (!allEqual(zs, 1f)) return false; }
            case Quad.WEST -> { plane = 0f; minA = min(zs); maxA = max(zs); minB = min(ys); maxB = max(ys); if (!allEqual(xs, 0f)) return false; }
            case Quad.EAST -> { plane = 1f; minA = min(zs); maxA = max(zs); minB = min(ys); maxB = max(ys); if (!allEqual(xs, 1f)) return false; }
            default -> { return false; }
        }
        return near(minA, 0f) && near(maxA, 1f) && near(minB, 0f) && near(maxB, 1f);
    }


    private boolean isOpaque(ModelBaker.BakedModel model) {
        for (Quad q : model.all) {
            if (q.spriteId == null) continue;
            // 透明度按实际 UV 矩形判断，不能因纹理其他位置透明而否定当前面的遮挡。


            var t = this.atlas.transparencyOf(q.spriteId,
                q.u0, q.v0, q.u1, q.v1, q.u2, q.v2, q.u3, q.v3, q.forceTranslucent);
            if (t.hasTransparent() || t.hasTranslucent()) return false;
        }
        return true;
    }

    private static float min(float[] v) { return Math.min(Math.min(v[0], v[1]), Math.min(v[2], v[3])); }
    private static float max(float[] v) { return Math.max(Math.max(v[0], v[1]), Math.max(v[2], v[3])); }
    private static boolean allEqual(float[] v, float t) {
        return near(v[0], t) && near(v[1], t) && near(v[2], t) && near(v[3], t);
    }
    private static boolean near(float a, float b) { return Math.abs(a - b) < 1e-4f; }
}
