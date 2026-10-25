package io.github.litematicrender.render;

import java.util.List;

/** 资源贴图及其动画帧数据，对应原版 SpriteContents 的数据部分。 */
public final class SpriteContents {
    public final String name;
    public final int frameWidth;
    public final int frameHeight;
    public final Image sheet;
    public final int frameCount;
    public final int frameTime;
    public final List<Integer> frames;   // 动画播放的源帧索引顺序，可含重复索引。
    public final boolean interpolate;
    /** 按原版语义记录透明度分类。 */
    public final boolean hasTransparent;
    public final boolean hasTranslucent;
    /** 记录当前已复制到图集的源帧，避免重复更新。 */
    int lastBakedFrame = -1;

    public SpriteContents(String name, int frameWidth, int frameHeight, Image sheet,
                          int frameCount, int frameTime, List<Integer> frames, boolean interpolate) {
        this.name = name;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.sheet = sheet;
        this.frameCount = frameCount;
        this.frameTime = frameTime;
        this.frames = frames;
        this.interpolate = interpolate;

        boolean transparent = false, translucent = false;
        scan:
        for (int y = 0; y < sheet.height; y++) {
            for (int x = 0; x < sheet.width; x++) {
                int a = Image.alpha(sheet.pixel(x, y));
                if (a == 0) transparent = true;
                else if (a != 255) translucent = true;
                if (transparent && translucent) break scan;
            }
        }
        this.hasTransparent = transparent;
        this.hasTranslucent = translucent;
    }

    public boolean isAnimated() {
        return this.frameCount > 1;
    }

    /** 按面片 UV 所覆盖的区域检查透明和半透明像素，保留强制半透明的独立语义。 */
    public Transparency transparencyIn(float minU, float minV, float maxU, float maxV) {
        int x0 = (int) Math.floor(Math.max(0f, Math.min(minU, maxU)) * this.frameWidth);
        int y0 = (int) Math.floor(Math.max(0f, Math.min(minV, maxV)) * this.frameHeight);
        int x1 = (int) Math.ceil(Math.min(1f, Math.max(minU, maxU)) * this.frameWidth);
        int y1 = (int) Math.ceil(Math.min(1f, Math.max(minV, maxV)) * this.frameHeight);
        x0 = Math.max(0, Math.min(this.frameWidth - 1, x0));
        y0 = Math.max(0, Math.min(this.frameHeight - 1, y0));
        x1 = Math.max(x0 + 1, Math.min(this.frameWidth, x1));
        y1 = Math.max(y0 + 1, Math.min(this.frameHeight, y1));

        boolean transparent = false, translucent = false;


        for (int y = 0; y < this.sheet.height; y++) {
            if (y % this.frameHeight < y0 || y % this.frameHeight >= y1) continue;
            for (int x = 0; x < this.sheet.width; x++) {
                if (x % this.frameWidth < x0 || x % this.frameWidth >= x1) continue;
                int a = Image.alpha(this.sheet.pixel(x, y));
                if (a == 0) transparent = true;
                else if (a != 255) translucent = true;
                if (transparent && translucent) return Transparency.TRANSPARENT_AND_TRANSLUCENT;
            }
        }
        if (transparent) return Transparency.TRANSPARENT;
        return translucent ? Transparency.TRANSLUCENT : Transparency.NONE;
    }

    /** 按 frames 列表和 frametime 选择当前游戏刻的源帧，支持重复帧和循环。 */
    public int frameAtTick(int tick) {
        if (!isAnimated() || this.frames.isEmpty()) return 0;
        int step = Math.max(0, tick) / Math.max(1, this.frameTime);
        int idx = step % this.frames.size();
        return this.frames.get(idx);
    }

    /** 返回指定帧在原图中的视图，不复制像素。 */
    public int framePixel(int frame, int x, int y) {
        int fy = this.frameY(frame) * this.frameHeight;
        int fx = this.frameX(frame) * this.frameWidth;
        return this.sheet.pixel(fx + x, fy + y);
    }

    public int frameX(int index) {
        int rowSize = Math.max(1, this.sheet.width / this.frameWidth);
        return index % rowSize;
    }

    public int frameY(int index) {
        int rowSize = Math.max(1, this.sheet.width / this.frameWidth);
        return index / rowSize;
    }


    public Image frameImage(int frame) {
        Image out = new Image(this.frameWidth, this.frameHeight);
        for (int y = 0; y < this.frameHeight; y++) {
            for (int x = 0; x < this.frameWidth; x++) {
                out.setPixel(x, y, this.framePixel(frame, x, y));
            }
        }
        return out;
    }
}
