package io.github.litematicrender.render.scene;

/** 每个光照页保存 4096 个值，均匀页无需额外字节数组。 */
final class LightPage {
    private int uniform;
    private byte[] data;
    long payloadBytes(){return data==null?0:data.length;}
    void fill(int value) { uniform=value; data=null; }
    int get(int index) {
        return data == null ? uniform : (data[index >> 1] >>> ((index & 1) * 4)) & 15;
    }
    void set(int index, int value) {
        if (data == null) {
            if (value == uniform) return;
            data = new byte[2048];
            if (uniform != 0) java.util.Arrays.fill(data, (byte)(uniform | uniform << 4));
        }
        int shift = (index & 1) * 4, slot = index >> 1;
        data[slot] = (byte)((data[slot] & ~(15 << shift)) | (value << shift));
    }
    void compact() {
        if (data == null) return;
        int value = data[0] & 15, pair = value | value << 4;
        for (byte b : data) if ((b & 255) != pair) return;
        uniform = value; data = null;
    }
}
