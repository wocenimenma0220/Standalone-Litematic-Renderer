package io.github.litematicrender.render;

import io.github.litematicrender.resource.ResourceManager;

import java.util.Arrays;
import java.util.Optional;

/** 草和树叶色图的加载与采样，对应原版颜色工具的数据逻辑。 */
public final class Colormaps {
    public static final int GRASS_DEFAULT = 0x91BD59;
    public static final int FOLIAGE_DEFAULT = 0x48B518;
    public static final int DRY_FOLIAGE_DEFAULT = 0xA8A833;
    public static final int WATER_DEFAULT = 0x3F76E4;

    private int[] grass = filled(GRASS_DEFAULT);
    private int[] foliage = filled(FOLIAGE_DEFAULT);
    private int[] dryFoliage = filled(DRY_FOLIAGE_DEFAULT);

    private static int[] filled(int def) {
        int[] out = new int[256 * 256];
        Arrays.fill(out, def);
        return out;
    }

    public void load(ResourceManager resources) {
        this.grass = loadMap(resources, "textures/colormap/grass.png", GRASS_DEFAULT);
        this.foliage = loadMap(resources, "textures/colormap/foliage.png", FOLIAGE_DEFAULT);
        this.dryFoliage = loadMap(resources, "textures/colormap/dry_foliage.png", DRY_FOLIAGE_DEFAULT);
    }
    void writeCache(java.io.DataOutput out)throws java.io.IOException{
        for(int[] map:new int[][]{grass,foliage,dryFoliage})for(int value:map)out.writeInt(value);
    }
    static Colormaps readCache(java.io.DataInput in)throws java.io.IOException{
        var result=new Colormaps();
        for(int[] map:new int[][]{result.grass,result.foliage,result.dryFoliage})for(int i=0;i<map.length;i++)map[i]=in.readInt();
        return result;
    }

    private static int[] loadMap(ResourceManager resources, String path, int def) {
        Optional<byte[]> data = resources.getResource(path);
        if (data.isEmpty()) return filled(def);
        try {
            Image img = Image.read(data.get());
            int[] out = filled(def);
            for (int y = 0; y < 256 && y < img.height; y++) {
                for (int x = 0; x < 256 && x < img.width; x++) {
                    out[y * 256 + x] = img.pixel(x, y) & 0xFFFFFF;
                }
            }
            return out;
        } catch (Exception e) {
            return filled(def);
        }
    }

    /** 按温度和降雨量映射色图坐标。 */
    private static int get(double temp, double rain, int[] map, int def) {
        int i = (int) ((1.0 - temp) * 255.0);
        int j = (int) ((1.0 - rain * temp) * 255.0);
        int k = j << 8 | i;
        return k >= map.length ? def : map[k];
    }

    /** 使用接近平原的温度 0.8、降雨量 0.4。 */
    public int grassColor() {
        return get(0.8, 0.4, this.grass, GRASS_DEFAULT);
    }

    public int foliageColor() {
        return get(0.8, 0.4, this.foliage, FOLIAGE_DEFAULT);
    }

    public int dryFoliageColor() {
        return get(0.8, 0.4, this.dryFoliage, DRY_FOLIAGE_DEFAULT);
    }

    public int waterColor() {
        return WATER_DEFAULT;
    }
}
