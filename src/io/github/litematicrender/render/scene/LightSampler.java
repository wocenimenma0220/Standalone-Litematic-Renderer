package io.github.litematicrender.render.scene;

/** 密集与稀疏光照共用的采样接口。 */
public interface LightSampler {
    void compute();
    int cellLight(int x,int y,int z);
    /** 光照计算完成后绑定区段，可缓存只读邻域。 */
    default LightSampler forSection(int x,int y,int z){return this;}
    default int faceLight(int x,int y,int z,int dx,int dy,int dz){return cellLight(x+dx,y+dy,z+dz);}
}
