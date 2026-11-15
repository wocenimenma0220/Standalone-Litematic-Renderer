package io.github.litematicrender.render;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

/** 流式 RGBA PNG 编码器：按条带顺序增量压缩写入 IDAT，支持超大图低内存无损导出。 */
public final class StreamingPngWriter implements AutoCloseable {
    private static final byte[] PNG_MAGIC = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    private static final int MAX_IDAT_BYTES = 65536;

    private final Path destination;
    private final Path tempFile;
    private final OutputStream out;
    private final int width;
    private final int height;
    private final byte[] rowBuf;
    private final byte[] idatBuf = new byte[MAX_IDAT_BYTES];
    private final Deflater deflater;
    private final CRC32 crc = new CRC32();
    private int idatLen;
    private int rowsWritten;
    private boolean finished;
    private boolean closed;

    public StreamingPngWriter(Path file, int width, int height) throws IOException {
        this(file, width, height, (long) width * height > 67_108_864L ? Deflater.BEST_SPEED : 3);
    }

    public StreamingPngWriter(Path file, int width, int height, int compressionLevel) throws IOException {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("invalid PNG dimensions: " + width + "x" + height);
        }
        this.destination = file.toAbsolutePath();
        Path parent = this.destination.getParent();
        if (parent != null) Files.createDirectories(parent);
        this.tempFile = Files.createTempFile(parent != null ? parent : Path.of("."), ".projection-png-", ".tmp");
        this.width = width;
        this.height = height;
        this.rowBuf = new byte[1 + width * 4];
        this.deflater = new Deflater(compressionLevel);
        try {
            this.out = new BufferedOutputStream(Files.newOutputStream(this.tempFile), 262144);
            this.out.write(PNG_MAGIC);
            writeIhdr();
        } catch (Throwable t) {
            this.deflater.end();
            try { Files.deleteIfExists(this.tempFile); } catch (IOException ignored) {}
            throw t;
        }
    }

    public void writeRows(int[] argbPixels, int rowCount) throws IOException {
        if (this.finished || this.closed) throw new IllegalStateException("PNG writer already finished");
        if (rowCount <= 0) return;
        if (this.rowsWritten + rowCount > this.height) {
            throw new IllegalArgumentException("too many rows: " + (this.rowsWritten + rowCount) + " > " + this.height);
        }
        int w = this.width;
        byte[] row = this.rowBuf;
        row[0] = 0; // None scanline filter: exact lossless RGBA storage with zero filter overhead.
        for (int y = 0; y < rowCount; y++) {
            int srcBase = y * w;
            int dst = 1;
            for (int x = 0; x < w; x++) {
                int p = argbPixels[srcBase + x];
                row[dst]     = (byte) (p >>> 16);
                row[dst + 1] = (byte) (p >>> 8);
                row[dst + 2] = (byte) p;
                row[dst + 3] = (byte) (p >>> 24);
                dst += 4;
            }
            this.deflater.setInput(row, 0, row.length);
            drainDeflater(false);
        }
        this.rowsWritten += rowCount;
    }

    public void finish() throws IOException {
        if (this.finished) return;
        if (this.rowsWritten != this.height) {
            throw new IOException("incomplete PNG rows: " + this.rowsWritten + " / " + this.height);
        }
        this.deflater.finish();
        drainDeflater(true);
        flushIdatChunk();
        writeChunk("IEND", new byte[0], 0);
        this.out.flush();
        this.out.close();
        this.deflater.end();
        Files.move(this.tempFile, this.destination, StandardCopyOption.REPLACE_EXISTING);
        this.finished = true;
        this.closed = true;
    }

    @Override
    public void close() throws IOException {
        if (this.closed) return;
        this.closed = true;
        try {
            this.deflater.end();
            this.out.close();
        } finally {
            if (!this.finished) Files.deleteIfExists(this.tempFile);
        }
    }

    private void drainDeflater(boolean finishing) throws IOException {
        while (true) {
            int space = this.idatBuf.length - this.idatLen;
            if (space == 0) {
                flushIdatChunk();
                space = this.idatBuf.length;
            }
            int produced = this.deflater.deflate(this.idatBuf, this.idatLen, space);
            if (produced > 0) {
                this.idatLen += produced;
            } else if (finishing) {
                if (this.deflater.finished()) break;
            } else if (this.deflater.needsInput()) {
                break;
            }
        }
    }

    private void flushIdatChunk() throws IOException {
        if (this.idatLen <= 0) return;
        writeChunk("IDAT", this.idatBuf, this.idatLen);
        this.idatLen = 0;
    }

    private void writeIhdr() throws IOException {
        byte[] ihdr = new byte[13];
        putInt(ihdr, 0, this.width);
        putInt(ihdr, 4, this.height);
        ihdr[8] = 8;  // 8-bit channel depth
        ihdr[9] = 6;  // RGBA color type
        ihdr[10] = 0; // zlib deflate
        ihdr[11] = 0; // adaptive filtering
        ihdr[12] = 0; // non-interlaced
        writeChunk("IHDR", ihdr, 13);
    }

    private void writeChunk(String type, byte[] data, int len) throws IOException {
        byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
        writeInt(len);
        this.out.write(typeBytes, 0, 4);
        if (len > 0) this.out.write(data, 0, len);
        this.crc.reset();
        this.crc.update(typeBytes, 0, 4);
        if (len > 0) this.crc.update(data, 0, len);
        writeInt((int) this.crc.getValue());
    }

    private void writeInt(int v) throws IOException {
        this.out.write((v >>> 24) & 0xFF);
        this.out.write((v >>> 16) & 0xFF);
        this.out.write((v >>> 8) & 0xFF);
        this.out.write(v & 0xFF);
    }

    private static void putInt(byte[] buf, int off, int v) {
        buf[off]     = (byte) (v >>> 24);
        buf[off + 1] = (byte) (v >>> 16);
        buf[off + 2] = (byte) (v >>> 8);
        buf[off + 3] = (byte) v;
    }
}
