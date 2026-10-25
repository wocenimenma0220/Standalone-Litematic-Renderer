package io.github.litematicrender.nbt;

import java.io.IOException;

/** 仅投影方块长数组使用压缩页，普通 NBT 数组继续采用连续存储。 */
public final class NbtPackedLongArray extends NbtElement {
    public final PackedLongArray value;
    public NbtPackedLongArray(PackedLongArray value){this.value=value;}
    @Override public int type(){return NbtTypes.TAG_LONG_ARRAY;}
    @Override public NbtElement copy(){return this;}
    @Override public void write(NbtOutput output)throws IOException{output.writeInt(value.length());for(int i=0;i<value.length();i++)output.writeLong(value.get(i));}
    @Override public String toString(){return "["+value.length()+" packed longs]";}
}
