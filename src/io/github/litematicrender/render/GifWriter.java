package io.github.litematicrender.render;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 无外部依赖的 GIF89a 编码器，支持全局调色板、循环播放和逐帧压缩。 */
public final class GifWriter {
    private final int width;
    private final int height;
    /** 调色板保存 256 个 RGB 值，索引 0 保留给透明像素。 */
    private final int[] palette = new int[256];
    private final Sink out = new Sink();
    private static final class Sink {
        java.io.OutputStream stream = new ByteArrayOutputStream();
        void write(int value) { try { stream.write(value); } catch (IOException e) { throw new java.io.UncheckedIOException(e); } }
        void write(byte[] bytes, int start, int length) { try { stream.write(bytes,start,length); } catch (IOException e) { throw new java.io.UncheckedIOException(e); } }
        byte[] toByteArray() { return ((ByteArrayOutputStream)stream).toByteArray(); }
    }
    /** 按颜色缓存调色板索引，避免对同一种颜色反复搜索 256 项。 */
    private final Map<Integer, Integer> nearestCache = new HashMap<>();
    private int framesWritten;

    public GifWriter(int width, int height) {
        this.width = width;
        this.height = height;
    }

    @FunctionalInterface public interface FrameSource { Image render(int tick) throws Exception; }
    @FunctionalInterface public interface Progress { void update(String stage,int completed,int total); }

    /** 先渲染并暂存原始像素，再使用统一调色板编码，限制帧内存占用。 */
    public static void writeFrames(Path file, int frameCount, int delayCs, FrameSource source) throws Exception {
        writeFrames(file,frameCount,delayCs,source,(stage,completed,total)->{});
    }

    public static void writeFrames(Path file,int frameCount,int delayCs,FrameSource source,Progress progress)throws Exception {
        if (frameCount <= 0) throw new IOException("no frames to write");
        Path destination = file.toAbsolutePath(), parent = destination.getParent();
        Files.createDirectories(parent);
        Path spool = Files.createTempFile(parent,".projection-frames-",".tmp");
        Path encoded = null;
        try {
            var histogram = new PaletteBuilder();
            GifWriter gif = null;
            try (var pixels = new java.io.DataOutputStream(new java.io.BufferedOutputStream(Files.newOutputStream(spool),1<<20))) {
                for (int tick=0;tick<frameCount;tick++) {
                    Image frame=source.render(tick);
                    if (gif==null) gif=new GifWriter(frame.width,frame.height);
                    if (frame.width!=gif.width || frame.height!=gif.height) throw new IOException("frame size mismatch");
                    histogram.add(frame);
                    for (int pixel:frame.pixels()) pixels.writeInt(pixel);
                    progress.update("rendering",tick+1,frameCount);
                }
            }
            histogram.finish(gif.palette);
            encoded=Files.createTempFile(parent,".projection-gif-",".tmp");
            try (var output=new java.io.BufferedOutputStream(Files.newOutputStream(encoded),1<<20);
                 var pixels=new java.io.DataInputStream(new java.io.BufferedInputStream(Files.newInputStream(spool),1<<20))) {
                gif.out.stream=output; gif.writeHeader();
                Image frame=new Image(gif.width,gif.height);
                for(int tick=0;tick<frameCount;tick++) {
                    for(int i=0;i<frame.pixels().length;i++) frame.pixels()[i]=pixels.readInt();
                    gif.writeFrame(frame,delayCs);
                    progress.update("encoding",tick+1,frameCount);
                }
                gif.writeTrailer();
            }
            Files.move(encoded,destination,java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(spool);
            if(encoded!=null) Files.deleteIfExists(encoded);
        }
    }

    /** 所有帧尺寸相同；帧间隔以百分之一秒为单位。 */
    public static void write(Path file, java.util.List<Image> frames, int delayCs) throws IOException {
        if (frames.isEmpty()) throw new IOException("no frames to write");
        Image first = frames.get(0);
        GifWriter gif = new GifWriter(first.width, first.height);
        gif.buildPalette(frames);
        gif.writeHeader();
        for (Image f : frames) {
            if (f.width != first.width || f.height != first.height) {
                throw new IOException("frame size mismatch: "
                    + f.width + "x" + f.height + " vs " + first.width + "x" + first.height);
            }
            gif.writeFrame(f, delayCs);
        }
        gif.writeTrailer();
        Files.createDirectories(file.getParent());
        Files.write(file, gif.out.toByteArray());
    }

    // ------------------------------------------------------------------

    /** 调色板从实际帧颜色生成，避免固定 RGB 网格损失 Minecraft 贴图的低饱和度细节。 */
    private void buildPalette(java.util.List<Image> frames) {
        var builder=new PaletteBuilder();
        for(Image frame:frames)builder.add(frame);
        builder.finish(this.palette);
    }

    private static final class PaletteBuilder {
        final Map<Integer, Long> histogram = new HashMap<>();
        long[] sums = new long[3];
        long total = 0;
        void add(Image f) {
            int[] px = f.pixels();
            for (int argb : px) {
                int a = (argb >>> 24) & 0xFF;
                if (a == 0) continue;              // 半透明细节也必须参与颜色统计。
                int r = (argb >>> 16) & 0xFF, g = (argb >>> 8) & 0xFF, b = argb & 0xFF;
                sums[0] += r*(long)a; sums[1] += g*(long)a; sums[2] += b*(long)a; total+=a;

                int key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
                histogram.merge(key, (long)a, Long::sum);
            }
        }

        void finish(int[] palette) {
        // 索引 0 专用于透明像素。
        int idx = 1;
        List<Map.Entry<Integer, Long>> sorted = new ArrayList<>(histogram.entrySet());
        sorted.sort((x, y) -> Long.compare(y.getValue(), x.getValue()));
        for (Map.Entry<Integer, Long> e : sorted) {
            if (idx >= 256) break;
            int key = e.getKey();
            int r = (key >>> 10) & 0x1F, g = (key >>> 5) & 0x1F, b = key & 0x1F;
            // 使用量化桶中心值，避免整体颜色偏暗。
            palette[idx++] = (((r << 3) | 4) << 16) | (((g << 3) | 4) << 8) | ((b << 3) | 4);
        }

        // 不足 255 种颜色时用均值补齐，以满足 GIF 调色板长度要求。

        if (idx < 256) {
            int ar = total == 0 ? 0 : (int) (sums[0] / total);
            int ag = total == 0 ? 0 : (int) (sums[1] / total);
            int ab = total == 0 ? 0 : (int) (sums[2] / total);
            int base = (ar << 16) | (ag << 8) | ab;
            while (idx < 256) {
                palette[idx++] = base;
            }
        }
        }
    }

    /** 查找最近颜色；透明覆盖率由像素位置独立计算。 */
    private int nearest(int argb) {
        Integer cached = this.nearestCache.get(argb);
        if (cached != null) return cached;
        int result;
        int a = (argb >>> 24) & 0xFF;
        if (a == 0) {
            result = 0;
        } else {
            int r = (argb >>> 16) & 0xFF, g = (argb >>> 8) & 0xFF, b = argb & 0xFF;
            int best = 1, bestDist = Integer.MAX_VALUE;
            for (int i = 1; i < 256; i++) {
                int p = this.palette[i];
                int dr = r - ((p >>> 16) & 0xFF);
                int dg = g - ((p >>> 8) & 0xFF);
                int db = b - (p & 0xFF);
                int d = dr * dr + dg * dg + db * db;
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                    if (d == 0) break;
                }
            }
            result = best;
        }
        if (this.nearestCache.size() >= 65536) this.nearestCache.clear();
        this.nearestCache.put(argb, result);
        return result;
    }

    private void writeHeader() {
        writeString("GIF89a");
        writeShort(this.width);
        writeShort(this.height);
        this.out.write(0xF7);
        this.out.write(0);
        this.out.write(0);
        for (int i = 0; i < 256; i++) {
            int c = this.palette[i];
            this.out.write((c >>> 16) & 0xFF);
            this.out.write((c >>> 8) & 0xFF);
            this.out.write(c & 0xFF);
        }
        // 使用 NETSCAPE2.0 扩展实现无限循环。
        this.out.write(0x21);
        this.out.write(0xFF);
        this.out.write(11);
        writeString("NETSCAPE2.0");
        this.out.write(3);
        this.out.write(1);
        writeShort(0);
        this.out.write(0);
    }

    private void writeFrame(Image img, int delayCs) {
        // 每帧先清除上一帧内容，末帧回到首帧时同样处理，避免残影。

        this.out.write(0x21);
        this.out.write(0xF9);
        this.out.write(4);
        this.out.write(0x09);              // 使用清除到背景的帧处置方式，并开启透明标记。
        writeShort(Math.max(1, delayCs));
        this.out.write(0);
        this.out.write(0);


        this.out.write(0x2C);
        writeShort(0);
        writeShort(0);
        writeShort(this.width);
        writeShort(this.height);
        this.out.write(0);


        byte[] indices = new byte[this.width * this.height];
        for (int y = 0; y < this.height; y++) {
            for (int x = 0; x < this.width; x++) {
                int argb=img.pixel(x,y),alpha=argb>>>24;
                indices[y * this.width + x] = (byte)(visible(alpha,x,y)?nearest(argb):0);
            }
        }
        writeLzw(indices);
        this.framesWritten++;
    }

    private void writeTrailer() {
        this.out.write(0x3B);
    }

    /** GIF 仅支持二值透明度；固定 16×16 Bayer 掩码保留覆盖率并避免闪烁。 */
    private static boolean visible(int alpha,int x,int y) {
        if(alpha==0)return false;
        if(alpha==255)return true;
        int threshold=0;
        for(int bit=0;bit<4;bit++) {
            int xb=(x>>bit)&1,yb=(y>>bit)&1;
            threshold=(threshold<<2)|((xb^yb)<<1)|yb;
        }
        return alpha*256>(threshold*2+1)*255/2;
    }

    // ------------------------------------------------------------------
    // 按 GIF 规范写入可变位宽 LZW 数据及清除、结束代码。

    private void writeLzw(byte[] data) {
        final int minCodeSize = 8;
        final int clearCode = 1 << minCodeSize;         // 256
        final int endCode = clearCode + 1;              // 257
        this.out.write(minCodeSize);

        BitWriter bw = new BitWriter();
        int codeSize = minCodeSize + 1;
        int nextCode = endCode + 1;
        java.util.Map<Integer, Integer> table = new java.util.HashMap<>();
        bw.write(clearCode, codeSize);

        int prefix = data.length > 0 ? (data[0] & 0xFF) : -1;
        for (int i = 1; i < data.length; i++) {
            int k = data[i] & 0xFF;
            int key = (prefix << 8) | k;
            Integer existing = table.get(key);
            if (existing != null) {
                prefix = existing;
                continue;
            }
            bw.write(prefix, codeSize);
            table.put(key, nextCode++);
            if (nextCode > (1 << codeSize)) {
                if (codeSize < 12) {
                    codeSize++;
                } else {
                    bw.write(clearCode, codeSize);
                    table.clear();
                    codeSize = minCodeSize + 1;
                    nextCode = endCode + 1;
                }
            }
            prefix = k;
        }
        if (prefix >= 0) bw.write(prefix, codeSize);
        bw.write(endCode, codeSize);
        bw.flush();

        // 每个数据子块不超过 255 字节。
        byte[] payload = bw.toByteArray();
        int offset = 0;
        while (offset < payload.length) {
            int n = Math.min(255, payload.length - offset);
            this.out.write(n);
            this.out.write(payload, offset, n);
            offset += n;
        }
        this.out.write(0);
    }

    /** GIF 的 LZW 位流使用低位优先的位累积器。 */
    private static final class BitWriter {
        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        private int acc;
        private int bits;

        void write(int code, int size) {
            this.acc |= code << this.bits;
            this.bits += size;
            while (this.bits >= 8) {
                this.buf.write(this.acc & 0xFF);
                this.acc >>>= 8;
                this.bits -= 8;
            }
        }

        void flush() {
            if (this.bits > 0) {
                this.buf.write(this.acc & 0xFF);
                this.acc = 0;
                this.bits = 0;
            }
        }

        byte[] toByteArray() { return this.buf.toByteArray(); }
    }

    private void writeShort(int v) {
        this.out.write(v & 0xFF);
        this.out.write((v >>> 8) & 0xFF);
    }

    private void writeString(String s) {
        for (int i = 0; i < s.length(); i++) this.out.write(s.charAt(i) & 0xFF);
    }
}
