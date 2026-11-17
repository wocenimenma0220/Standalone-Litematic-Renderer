package io.github.litematicrender.render;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

/** 无外部依赖的 GIF89a 编码器，支持全局调色板、循环播放和并行帧压缩。 */
public final class GifWriter {
    private static final int ENCODE_WORKERS = Math.max(1, Math.min(6, Runtime.getRuntime().availableProcessors()));
    private static final AtomicInteger ENCODE_SEQ = new AtomicInteger();
    private static final ExecutorService ENCODE_POOL = ENCODE_WORKERS <= 1 ? null : Executors.newFixedThreadPool(
        ENCODE_WORKERS, task -> Thread.ofPlatform().name("gif-encode-" + ENCODE_SEQ.incrementAndGet()).daemon(true).unstarted(task));

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
    /** 按 RGB 缓存调色板索引（开放定址零装箱表），避免对同一种颜色反复搜索 256 项。 */
    private static final int CACHE_SIZE = 8192;
    private static final int CACHE_MASK = CACHE_SIZE - 1;
    private final int[] nearestKeys = new int[CACHE_SIZE];
    private final byte[] nearestVals = new byte[CACHE_SIZE];
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
            byte[] ioBuf = new byte[65536];
            try (var pixels = new java.io.BufferedOutputStream(Files.newOutputStream(spool),1<<20)) {
                for (int tick=0;tick<frameCount;tick++) {
                    if (Thread.currentThread().isInterrupted()) throw new java.util.concurrent.CancellationException("渲染已取消");
                    Image frame=source.render(tick);
                    if (gif==null) gif=new GifWriter(frame.width,frame.height);
                    if (frame.width!=gif.width || frame.height!=gif.height) throw new IOException("frame size mismatch");
                    histogram.add(frame);
                    writeSpoolPixels(pixels, frame.pixels(), ioBuf);
                    progress.update("rendering",tick+1,frameCount);
                }
            }
            histogram.finish(gif.palette);
            encoded=Files.createTempFile(parent,".projection-gif-",".tmp");
            encodeFromSpool(spool, encoded, gif, frameCount, delayCs, () -> false, progress);
            Files.move(encoded,destination,java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(spool);
            if(encoded!=null) Files.deleteIfExists(encoded);
        }
    }

    /** 直接从预先生成的原始 ARGB 帧文件并行统计调色板并编码为 GIF89a（供 GPU 快速导出使用）。 */
    public static void writeFramesFromSpool(Path destinationFile, Path spool, int width, int height, int frameCount, int delayCs,
                                            BooleanSupplier cancelSignal, Progress progress) throws Exception {
        if (frameCount <= 0) throw new IOException("no frames to write");
        if (width <= 0 || height <= 0) throw new IOException("invalid dimensions");
        Path destination = destinationFile.toAbsolutePath(), parent = destination.getParent();
        Files.createDirectories(parent);
        Path encoded = Files.createTempFile(parent, ".projection-gif-", ".tmp");
        try {
            var histogram = new PaletteBuilder();
            GifWriter gif = new GifWriter(width, height);
            byte[] ioBuf = new byte[65536];
            Image scan = new Image(width, height);
            try (var in = new java.io.BufferedInputStream(Files.newInputStream(spool), 1 << 20)) {
                for (int tick = 0; tick < frameCount; tick++) {
                    if ((cancelSignal != null && cancelSignal.getAsBoolean()) || Thread.currentThread().isInterrupted()) {
                        throw new java.util.concurrent.CancellationException("渲染已取消");
                    }
                    readSpoolPixels(in, scan.pixels(), ioBuf);
                    histogram.add(scan);
                }
            }
            histogram.finish(gif.palette);
            encodeFromSpool(spool, encoded, gif, frameCount, delayCs, cancelSignal, progress);
            Files.move(encoded, destination, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } finally {
            if (encoded != null) Files.deleteIfExists(encoded);
        }
    }

    private static void encodeFromSpool(Path spool, Path encoded, GifWriter gif, int frameCount, int delayCs,
                                        BooleanSupplier cancelSignal, Progress progress) throws Exception {
        byte[] ioBuf = new byte[65536];
        try (var output = new java.io.BufferedOutputStream(Files.newOutputStream(encoded), 1 << 20);
             var pixels = new java.io.BufferedInputStream(Files.newInputStream(spool), 1 << 20)) {
            gif.out.stream = output;
            gif.writeHeader();
            if (ENCODE_POOL == null || frameCount < 2 || (long) gif.width * gif.height * frameCount < 262_144L) {
                Image frame = new Image(gif.width, gif.height);
                for (int tick = 0; tick < frameCount; tick++) {
                    if ((cancelSignal != null && cancelSignal.getAsBoolean()) || Thread.currentThread().isInterrupted()) {
                        throw new java.util.concurrent.CancellationException("渲染已取消");
                    }
                    readSpoolPixels(pixels, frame.pixels(), ioBuf);
                    gif.writeFrame(frame, delayCs);
                    progress.update("encoding", tick + 1, frameCount);
                }
            } else {
                int inFlight = Math.min(frameCount, ENCODE_WORKERS * 2);
                ArrayDeque<Future<byte[]>> pending = new ArrayDeque<>(inFlight);
                int submitted = 0;
                try {
                    for (int tick = 0; tick < frameCount; tick++) {
                        while (submitted < frameCount && pending.size() < inFlight) {
                            if ((cancelSignal != null && cancelSignal.getAsBoolean()) || Thread.currentThread().isInterrupted()) {
                                throw new java.util.concurrent.CancellationException("渲染已取消");
                            }
                            Image copy = new Image(gif.width, gif.height);
                            readSpoolPixels(pixels, copy.pixels(), ioBuf);
                            pending.addLast(ENCODE_POOL.submit(() -> {
                                GifWriter scratch = new GifWriter(gif.width, gif.height);
                                System.arraycopy(gif.palette, 0, scratch.palette, 0, 256);
                                scratch.writeFrame(copy, delayCs);
                                return scratch.out.toByteArray();
                            }));
                            submitted++;
                        }
                        if ((cancelSignal != null && cancelSignal.getAsBoolean()) || Thread.currentThread().isInterrupted()) {
                            throw new java.util.concurrent.CancellationException("渲染已取消");
                        }
                        byte[] encodedFrame;
                        try {
                            encodedFrame = pending.removeFirst().get();
                        } catch (ExecutionException e) {
                            Throwable cause = e.getCause();
                            if (cause instanceof RuntimeException re) throw re;
                            if (cause instanceof Error err) throw err;
                            throw new RuntimeException(cause);
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                            throw new java.util.concurrent.CancellationException("渲染已取消");
                        }
                        output.write(encodedFrame);
                        gif.framesWritten++;
                        progress.update("encoding", tick + 1, frameCount);
                    }
                } finally {
                    for (Future<byte[]> f : pending) f.cancel(true);
                }
            }
            gif.writeTrailer();
        }
    }

    private static void writeSpoolPixels(java.io.OutputStream out, int[] data, byte[] buf) throws IOException {
        int i = 0, len = data.length;
        while (i < len) {
            int batch = Math.min(len - i, buf.length >> 2), off = 0;
            for (int j = 0; j < batch; j++) {
                int p = data[i + j];
                buf[off] = (byte) p;
                buf[off + 1] = (byte) (p >>> 8);
                buf[off + 2] = (byte) (p >>> 16);
                buf[off + 3] = (byte) (p >>> 24);
                off += 4;
            }
            out.write(buf, 0, off);
            i += batch;
        }
    }

    private static void readSpoolPixels(java.io.InputStream in, int[] data, byte[] buf) throws IOException {
        int i = 0, len = data.length;
        while (i < len) {
            int batch = Math.min(len - i, buf.length >> 2), need = batch << 2, got = 0;
            while (got < need) {
                int n = in.read(buf, got, need - got);
                if (n < 0) throw new java.io.EOFException();
                got += n;
            }
            for (int j = 0, off = 0; j < batch; j++, off += 4) {
                data[i + j] = (buf[off] & 0xFF) | ((buf[off + 1] & 0xFF) << 8)
                        | ((buf[off + 2] & 0xFF) << 16) | ((buf[off + 3] & 0xFF) << 24);
            }
            i += batch;
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
        int a = argb >>> 24;
        if (a == 0) return 0;
        int key = argb | 0xFF000000;
        int slot = ((key * 0x9E3779B9) >>> (32 - 13)) & CACHE_MASK;
        if (this.nearestKeys[slot] == key) return this.nearestVals[slot] & 0xFF;
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
        this.nearestKeys[slot] = key;
        this.nearestVals[slot] = (byte) best;
        return best;
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

    private final int[] lzwKeys = new int[8192];
    private final int[] lzwEpochs = new int[8192];
    private final short[] lzwVals = new short[8192];
    private int lzwEpoch = 0;

    private void writeLzw(byte[] data) {
        final int minCodeSize = 8;
        final int clearCode = 1 << minCodeSize;         // 256
        final int endCode = clearCode + 1;              // 257
        this.out.write(minCodeSize);

        BitWriter bw = new BitWriter();
        int codeSize = minCodeSize + 1;
        int nextCode = endCode + 1;
        int epoch = ++this.lzwEpoch;
        if (epoch == 0) { java.util.Arrays.fill(this.lzwEpochs, 0); epoch = this.lzwEpoch = 1; }
        bw.write(clearCode, codeSize);

        int prefix = data.length > 0 ? (data[0] & 0xFF) : -1;
        for (int i = 1; i < data.length; i++) {
            int k = data[i] & 0xFF;
            int key = (prefix << 8) | k;
            int slot = (key * 0x9E3779B9) >>> 19;
            int existing = -1;
            while (this.lzwEpochs[slot] == epoch) {
                if (this.lzwKeys[slot] == key) { existing = this.lzwVals[slot] & 0xFFFF; break; }
                slot = (slot + 1) & 8191;
            }
            if (existing >= 0) {
                prefix = existing;
                continue;
            }
            bw.write(prefix, codeSize);
            this.lzwEpochs[slot] = epoch;
            this.lzwKeys[slot] = key;
            this.lzwVals[slot] = (short) (nextCode++);
            if (nextCode > (1 << codeSize)) {
                if (codeSize < 12) {
                    codeSize++;
                } else {
                    bw.write(clearCode, codeSize);
                    epoch = ++this.lzwEpoch;
                    if (epoch == 0) { java.util.Arrays.fill(this.lzwEpochs, 0); epoch = this.lzwEpoch = 1; }
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
