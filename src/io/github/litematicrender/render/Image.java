package io.github.litematicrender.render;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;

/** 简化的 RGBA 图像；像素按从上到下的行顺序保存为 ARGB 整数。 */
public final class Image {
    public final int width;
    public final int height;
    private final int[] pixels;

    public Image(int width, int height) {
        this.width = width;
        this.height = height;
        this.pixels = new int[width * height];
    }

    private Image(int width, int height, int[] pixels) {
        this.width = width;
        this.height = height;
        this.pixels = pixels;
    }

    public int pixel(int x, int y) {
        return this.pixels[y * this.width + x];
    }

    public void setPixel(int x, int y, int argb) {
        this.pixels[y * this.width + x] = argb;
    }

    public int[] pixels() {
        return this.pixels;
    }

    public static int alpha(int argb) { return (argb >>> 24) & 0xFF; }
    public static int red(int argb)   { return (argb >>> 16) & 0xFF; }
    public static int green(int argb) { return (argb >>> 8) & 0xFF; }
    public static int blue(int argb)  { return argb & 0xFF; }

    public static int argb(int a, int r, int g, int b) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    /** 在 0～1 UV 空间中采用最近邻采样。 */
    public int sampleNearest(float u, float v) {
        int x = Math.min(this.width - 1, Math.max(0, (int) (u * this.width)));
        int y = Math.min(this.height - 1, Math.max(0, (int) (v * this.height)));
        return this.pixel(x, y);
    }


    public void blitFrom(Image src, int srcX, int srcY, int dstX, int dstY, int w, int h) {
        if (w <= 0 || h <= 0) return;
        int startX = 0;
        if (dstX < 0) startX = Math.max(startX, -dstX);
        if (srcX < 0) startX = Math.max(startX, -srcX);
        int endX = w;
        if (dstX + endX > this.width) endX = this.width - dstX;
        if (srcX + endX > src.width) endX = src.width - srcX;
        int copyW = endX - startX;
        if (copyW <= 0) return;

        int startY = 0;
        if (dstY < 0) startY = Math.max(startY, -dstY);
        if (srcY < 0) startY = Math.max(startY, -srcY);
        int endY = h;
        if (dstY + endY > this.height) endY = this.height - dstY;
        if (srcY + endY > src.height) endY = src.height - srcY;
        if (endY <= startY) return;

        int sStride = src.width, dStride = this.width;
        int sOff = (srcY + startY) * sStride + (srcX + startX);
        int dOff = (dstY + startY) * dStride + (dstX + startX);
        for (int y = startY; y < endY; y++) {
            System.arraycopy(src.pixels, sOff, this.pixels, dOff, copyW);
            sOff += sStride;
            dOff += dStride;
        }
    }


    public void blitTo(Image dst, int srcX, int srcY, int dstX, int dstY, int w, int h) {
        dst.blitFrom(this, srcX, srcY, dstX, dstY, w, h);
    }

    public static Image read(byte[] data) throws IOException {
        var input=new javax.imageio.stream.MemoryCacheImageInputStream(new ByteArrayInputStream(data));
        try{
            BufferedImage img = ImageIO.read(input);
            if (img == null) throw new IOException("Unsupported image format");
            return fromBuffered(img);
        }finally{try{input.close();}catch(IOException alreadyClosed){/** ImageIO 成功解码后会关闭输入流。 */}}
    }

    public static Image read(InputStream in) throws IOException {
        BufferedImage img = ImageIO.read(in);
        if (img == null) throw new IOException("Unsupported image format");
        return fromBuffered(img);
    }

    public static Image read(Path file) throws IOException {
        BufferedImage img = ImageIO.read(file.toFile());
        if (img == null) throw new IOException("Unsupported image format: " + file);
        return fromBuffered(img);
    }

    public static Image fromBuffered(BufferedImage img) {
        int w = img.getWidth(), h = img.getHeight();
        int[] argb = new int[w * h];
        img.getRGB(0, 0, w, h, argb, 0, w);
        return new Image(w, h, argb);
    }

    public BufferedImage toBuffered() {
        BufferedImage img = new BufferedImage(this.width, this.height, BufferedImage.TYPE_INT_ARGB);
        img.setRGB(0, 0, this.width, this.height, this.pixels, 0, this.width);
        return img;
    }

    public void writePng(Path file) throws IOException {
        Path target = file.toAbsolutePath();
        java.nio.file.Files.createDirectories(target.getParent());
        if (!ImageIO.write(this.toBuffered(), "png", target.toFile())) {
            throw new IOException("PNG writer unavailable: " + target);
        }
    }

    /** 缺失纹理使用原版粉黑棋盘格。 */
    public static Image missing() {
        return missing(16, 16);
    }

    public static Image missing(int width, int height) {
        Image img = new Image(width, height);
        int magenta = 0xFFF800F8 & 0xFFFFFFFF;
        int black = 0xFF000000;
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                img.setPixel(x, y, (y < height / 2 ^ x < width / 2) ? magenta : black);
            }
        }
        return img;
    }
}
