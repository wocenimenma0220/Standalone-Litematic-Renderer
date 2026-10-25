package io.github.litematicrender.render.raster;

/** 视角旋转与正交投影；矩阵顺序与 WikiRenderer 和 quickcraft 的相机逻辑一致。 */
public final class Camera {
    public float rotationDeg = 45f;
    public float slantDeg = 30f;
    public float zoom = 1.0f;
    public float offsetX = 0, offsetY = 0;
    /** 映射到屏幕中心的世界坐标。 */
    public double centerX = 0, centerY = 0, centerZ = 0;

    private final double[] rot = new double[9];

    public void update() {
        double yaw = Math.toRadians(this.rotationDeg);
        double pitch = Math.toRadians(this.slantDeg);
        double cy = Math.cos(yaw), sy = Math.sin(yaw);
        double cp = Math.cos(pitch), sp = Math.sin(pitch);

        // 世界向上先保持为视图向上，再由光栅化阶段转换为屏幕坐标。

        double m00 = cy,       m01 = 0,  m02 = sy;
        double m10 = sp * sy,  m11 = cp, m12 = -sp * cy;
        double m20 = -cp * sy, m21 = sp, m22 = cp * cy;
        this.rot[0] = m00; this.rot[1] = m01; this.rot[2] = m02;
        this.rot[3] = m10; this.rot[4] = m11; this.rot[5] = m12;
        this.rot[6] = m20; this.rot[7] = m21; this.rot[8] = m22;
    }


    public void toView(double x, double y, double z, double[] out) {
        double wx = x - this.centerX, wy = y - this.centerY, wz = z - this.centerZ;
        out[0] = this.rot[0] * wx + this.rot[1] * wy + this.rot[2] * wz;
        out[1] = this.rot[3] * wx + this.rot[4] * wy + this.rot[5] * wz;
        out[2] = this.rot[6] * wx + this.rot[7] * wy + this.rot[8] * wz;
    }

    /** 视图空间深度越大，越靠近观察者。 */
    public double viewDepth(double x, double y, double z) {
        double wx = x - this.centerX, wy = y - this.centerY, wz = z - this.centerZ;
        return this.rot[6] * wx + this.rot[7] * wy + this.rot[8] * wz;
    }


    public void presetIsometric() {
        this.slantDeg = 35.264f;
        this.rotationDeg = 45f;
    }

    public void presetDimetric() {
        this.slantDeg = 30f;
        this.rotationDeg = 45f;
    }
}
