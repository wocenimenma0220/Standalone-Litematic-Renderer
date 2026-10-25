package io.github.litematicrender.render;

/** 透明分类分别记录全透明和半透明像素，两种标志独立，并非互斥枚举。 */
public record Transparency(boolean hasTransparent, boolean hasTranslucent) {
    public static final Transparency NONE = new Transparency(false, false);
    public static final Transparency TRANSPARENT = new Transparency(true, false);
    public static final Transparency TRANSLUCENT = new Transparency(false, true);
    public static final Transparency TRANSPARENT_AND_TRANSLUCENT = new Transparency(true, true);

    public static Transparency of(boolean hasTransparent, boolean hasTranslucent) {
        if (hasTransparent && hasTranslucent) return TRANSPARENT_AND_TRANSLUCENT;
        if (hasTransparent) return TRANSPARENT;
        return hasTranslucent ? TRANSLUCENT : NONE;
    }

    public boolean isOpaque() {
        return !this.hasTransparent && !this.hasTranslucent;
    }
}
