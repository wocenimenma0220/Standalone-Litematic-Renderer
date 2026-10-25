package io.github.litematicrender.render.scene;

import java.util.ArrayList;
import java.util.List;

/** 按材质组织几何；不透明面写深度，所有混合面统一排序。 */
public final class SceneMesh {
    public SectionVisibility visibility;
    public java.util.Map<String, Object> skinReport = java.util.Map.of();
    public java.util.Map<String, Object> entityReport = java.util.Map.of();
    public enum Layer { SOLID, CUTOUT, PORTAL, FLUID, TRANSLUCENT, WATER_MASK }

    public static final class MeshQuad {
        public final float x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3;

        public final float u0, v0, u1, v1, u2, v2, u3, v3;
        public final String spriteId;
        /** 装饰效果不扩大自动取景范围，也不参与方块拾取。 */
        public boolean decorativeEffect(){return spriteId!=null&&spriteId.startsWith("litematicrender:beacon/");}
        public final int rgb;
        /** 指定独立图片时直接采样该图片，UV 范围为 0～1。 */
        public final io.github.litematicrender.render.Image image;
        public final float tintR, tintG, tintB;

        public final float shade;
        /** 每顶点 AO；平面光照或禁用 AO 时为空。 */
        public final float[] ao;
        /** 最终顶点颜色可包含平滑光照、染色、方向光和 AO。 */
        public int[] vertexColors;
        public MeshQuad colors(int[] colors) { this.vertexColors=colors; return this; }
        public final Layer layer;
        public final float cx, cy, cz;
        /** 十字植物和火把侧面等无固定朝向的面需双面绘制，不能剔除背面。 */
        public final boolean doubleSided;
        /** 面片归属格与区域不随模型越界延伸而改变。 */
        public int blockX, blockY, blockZ;
        /** 远处 LOD 也需保留薄边界几何。 */
        public boolean lodProtected;
        public String regionName;
        public int entityIndex=-1;
        public MeshQuad entityOwner(int index,String region){this.entityIndex=index;this.regionName=region;return this;}
        public MeshQuad owner(int x,int y,int z,String region) {
            this.blockX=x; this.blockY=y; this.blockZ=z; this.regionName=region; return this;
        }

        public MeshQuad(float[] xs, float[] ys, float[] zs,
                        float u0, float v0, float u1, float v1, float u2, float v2, float u3, float v3,
                        String spriteId, int rgb,
                        float tr, float tg, float tb, float shade, float[] ao, Layer layer) {
            this(xs, ys, zs, u0, v0, u1, v1, u2, v2, u3, v3, spriteId, rgb, null, tr, tg, tb, shade, ao, layer, false);
        }

        public MeshQuad(float[] xs, float[] ys, float[] zs,
                        float u0, float v0, float u1, float v1, float u2, float v2, float u3, float v3,
                        String spriteId, int rgb, io.github.litematicrender.render.Image image,
                        float tr, float tg, float tb, float shade, float[] ao, Layer layer) {
            this(xs, ys, zs, u0, v0, u1, v1, u2, v2, u3, v3, spriteId, rgb, image,
                tr, tg, tb, shade, ao, layer, false);
        }

        public MeshQuad(float[] xs, float[] ys, float[] zs,
                        float u0, float v0, float u1, float v1, float u2, float v2, float u3, float v3,
                        String spriteId, int rgb, io.github.litematicrender.render.Image image,
                        float tr, float tg, float tb, float shade, float[] ao, Layer layer,
                        boolean doubleSided) {
            this.x0 = xs[0]; this.y0 = ys[0]; this.z0 = zs[0];
            this.x1 = xs[1]; this.y1 = ys[1]; this.z1 = zs[1];
            this.x2 = xs[2]; this.y2 = ys[2]; this.z2 = zs[2];
            this.x3 = xs[3]; this.y3 = ys[3]; this.z3 = zs[3];
            this.u0 = u0; this.v0 = v0;
            this.u1 = u1; this.v1 = v1;
            this.u2 = u2; this.v2 = v2;
            this.u3 = u3; this.v3 = v3;
            this.spriteId = spriteId;
            this.rgb = rgb;
            this.image = image;
            this.tintR = tr; this.tintG = tg; this.tintB = tb;
            this.shade = shade;
            this.ao = ao;
            this.layer = layer;
            this.doubleSided = doubleSided;
            this.cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4f;
            this.cy = (ys[0] + ys[1] + ys[2] + ys[3]) / 4f;
            this.cz = (zs[0] + zs[1] + zs[2] + zs[3]) / 4f;
        }
    }

    public final List<MeshQuad> solid = new ArrayList<>();
    public final List<MeshQuad> cutout = new ArrayList<>();
    public final List<MeshQuad> portal = new ArrayList<>();
    public final List<MeshQuad> fluid = new ArrayList<>();
    public final List<MeshQuad> translucent = new ArrayList<>();
    /** 船内部遮水深度在不透明实体之后、混合层之前写入。 */
    public final List<MeshQuad> waterMask = new ArrayList<>();
    public int quadCount;
    public TranslucentBsp translucentBsp;

    /** 半透明几何只在场景构建时细分一次，每帧仅按相机重排。 */
    public final List<MeshQuad> portalSorted = new ArrayList<>();
    public final List<MeshQuad> fluidSorted = new ArrayList<>();
    public final List<MeshQuad> translucentSorted = new ArrayList<>();
}
