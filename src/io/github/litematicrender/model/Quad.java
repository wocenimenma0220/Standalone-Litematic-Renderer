package io.github.litematicrender.model;

/** 烘焙后的面片数据，对应原版 BakedQuad 的数据部分。 */
public final class Quad {
    public final float x0, y0, z0;
    public final float x1, y1, z1;
    public final float x2, y2, z2;
    public final float x3, y3, z3;
    /** 单张贴图内部归一化的 UV 坐标，范围为 0～1。 */
    public final float u0, v0, u1, v1, u2, v2, u3, v3;
    /** 方向索引依次为下、上、北、南、西、东；-1 表示不进行面剔除。 */
    public final int face;
    public final String spriteId;
    public final int tintIndex;        // -1 表示不染色。
    public final int shadeFaceOverride;
    public final int lightEmission;
    /** 贴图槽位要求强制半透明时，此面始终进入混合通道，典型用途为红石粉。 */
    public final boolean forceTranslucent;

    public static final int DOWN = 0, UP = 1, NORTH = 2, SOUTH = 3, WEST = 4, EAST = 5, NO_FACE = -1;

    public Quad(float[] px, float[] py, float[] pz,
                float[] pu, float[] pv,
                int face, String spriteId, int tintIndex, int shadeFaceOverride, int lightEmission) {
        this(px, py, pz, pu, pv, face, spriteId, tintIndex, shadeFaceOverride, lightEmission, false);
    }

    public Quad(float[] px, float[] py, float[] pz,
                float[] pu, float[] pv,
                int face, String spriteId, int tintIndex, int shadeFaceOverride, int lightEmission,
                boolean forceTranslucent) {
        this.x0 = px[0]; this.y0 = py[0]; this.z0 = pz[0];
        this.x1 = px[1]; this.y1 = py[1]; this.z1 = pz[1];
        this.x2 = px[2]; this.y2 = py[2]; this.z2 = pz[2];
        this.x3 = px[3]; this.y3 = py[3]; this.z3 = pz[3];
        this.u0 = pu[0]; this.v0 = pv[0];
        this.u1 = pu[1]; this.v1 = pv[1];
        this.u2 = pu[2]; this.v2 = pv[2];
        this.u3 = pu[3]; this.v3 = pv[3];
        this.face = face;
        this.spriteId = spriteId;
        this.tintIndex = tintIndex;
        this.shadeFaceOverride = shadeFaceOverride;
        this.lightEmission = lightEmission;
        this.forceTranslucent = forceTranslucent;
    }


    public float nx() { return this.face == WEST ? -1 : this.face == EAST ? 1 : 0; }
    public float ny() { return this.face == DOWN ? -1 : this.face == UP ? 1 : 0; }
    public float nz() { return this.face == NORTH ? -1 : this.face == SOUTH ? 1 : 0; }
}
