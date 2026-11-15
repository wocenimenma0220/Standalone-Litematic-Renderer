package io.github.litematicrender.render;

import java.awt.Color;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;

/** 先写背景，再混合玻璃与水，确保半透明颜色正确。 */
public final class RenderBackground {
    private RenderBackground() {}
    public static boolean isTransparent(RenderSettings settings) {
        return settings.transparentBackground || "checker".equals(settings.backgroundMode);
    }
    public static void fill(Image target, RenderSettings settings) {
        fillRegion(target, target.width, target.height, 0, 0, target.height, settings, null, null);
    }

    public static BufferedImage prepareSource(RenderSettings settings) {
        if (isTransparent(settings) || !"image".equals(settings.backgroundMode) || settings.backgroundImage == null) {
            return null;
        }
        return settings.backgroundImage.toBuffered();
    }

    public static void fillRegion(Image target, int fullWidth, int fullHeight, int tileX0, int tileY0,
                                  int activeHeight, RenderSettings settings,
                                  BufferedImage preparedSource, BufferedImage[] scratch) {
        if (isTransparent(settings) || activeHeight <= 0) return;
        if ("image".equals(settings.backgroundMode) && settings.backgroundImage != null) {
            Image source = settings.backgroundImage;
            BufferedImage srcBuf = preparedSource != null ? preparedSource : source.toBuffered();
            double scale = Math.max((double) fullWidth / source.width, (double) fullHeight / source.height);
            int width = (int) Math.ceil(source.width * scale), height = (int) Math.ceil(source.height * scale);
            BufferedImage background = scratch != null && scratch[0] != null
                    && scratch[0].getWidth() == target.width && scratch[0].getHeight() == activeHeight
                ? scratch[0]
                : new BufferedImage(target.width, activeHeight, BufferedImage.TYPE_INT_ARGB);
            if (scratch != null) scratch[0] = background;
            var graphics = background.createGraphics();
            try {
                graphics.setColor(new Color(0x22262E));
                graphics.fillRect(0, 0, target.width, activeHeight);
                graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                graphics.drawImage(srcBuf, (fullWidth - width) / 2 - tileX0, (fullHeight - height) / 2 - tileY0,
                    width, height, null);
            } finally {
                graphics.dispose();
            }
            background.getRGB(0, 0, target.width, activeHeight, target.pixels(), 0, target.width);
        }
    }
}
