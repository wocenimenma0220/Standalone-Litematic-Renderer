package io.github.litematicrender.render;

/** 渲染参数集合，包含相机、输出和光照设置。 */
public final class RenderSettings {
    public static final int DEFAULT_ANIMATION_FRAMES = 480;
    public static final int DEFAULT_ANIMATION_DELAY_CS = 2;
    public static final int MAX_ANIMATION_FRAMES = 3600;
    public float rotationDeg = 45f;
    public float slantDeg = 30f;
    public int width = 1024;
    public int height = 1024;
    public boolean transparentBackground = true;
    public int backgroundColor = 0x00000000;
    public String backgroundMode = "color";
    public Image backgroundImage;
    public int checkerSize = 20;
    public float ambientShadeScale = 1.0f;
    public boolean lightingEnabled = true;
    public boolean realLighting = false;
    public float previewZoom = 1f;
    public double[] selectionMin,selectionMax;
    public io.github.litematicrender.render.scene.SceneMesh selectionMesh;

    /** 动态贴图使用的游戏刻；静态 PNG 选择该刻的一帧，交互预览可连续推进。 */
    public int animationTick = 0;

    /** 拖动时限制图像长边，0 表示原尺寸；停止拖动后恢复完整分辨率。 */
    public int interactiveMaxEdge = 0;

    public RenderSettings() {}

    public RenderSettings(float rotationDeg, float slantDeg, int width, int height) {
        this.rotationDeg = rotationDeg;
        this.slantDeg = slantDeg;
        this.width = width;
        this.height = height;
    }

    public RenderSettings rotation(float deg) { this.rotationDeg = deg; return this; }
    public RenderSettings slant(float deg) { this.slantDeg = deg; return this; }
    public RenderSettings size(int w, int h) { this.width = w; this.height = h; return this; }
    public RenderSettings tick(int t) { this.animationTick = t; return this; }


    public static RenderSettings isometric(int w, int h) {
        return new RenderSettings(45f, 35.264f, w, h);
    }
}
