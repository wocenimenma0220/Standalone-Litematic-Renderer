package io.github.litematicrender.render;

import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.util.MiniJson;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/** 纹理目录：加载图集定义和动画元数据，提供贴图 UV 映射。 */
public final class SpriteAtlas {

    public static final class Entry {
        public final SpriteContents contents;

        public final float u0, v0, u1, v1;
        /** 保存贴图在图集中的像素起点，供动画帧重绘使用。 */
        public final int pixelX, pixelY;

        Entry(SpriteContents contents, float u0, float v0, float u1, float v1, int pixelX, int pixelY) {
            this.contents = contents;
            this.u0 = u0;
            this.v0 = v0;
            this.u1 = u1;
            this.v1 = v1;
            this.pixelX = pixelX;
            this.pixelY = pixelY;
        }


        public float u(float frac) {
            return this.u0 + (this.u1 - this.u0) * frac;
        }

        public float v(float frac) {
            return this.v0 + (this.v1 - this.v0) * frac;
        }
    }

    public final String id;
    private final Map<String, SpriteContents> sprites = new HashMap<>();
    private final Map<String, SpriteContents> baseSprites = new HashMap<>();
    private final Map<String, int[]> generatedPixels = new HashMap<>();
    private final Map<String, Long> generatedSizes = new HashMap<>();
    private final Map<String, Entry> entries = new HashMap<>();
    public Image stitched;
    public final int padding;
    /** 纯色预览使用独立图集，不修改完整场景图集。 */
    public static SpriteAtlas overview() {
        Image white=new Image(1,1);white.pixels()[0]=0xffffffff;
        return new SpriteAtlas("overview",Map.of("litematicrender:overview",new SpriteContents("litematicrender:overview",1,1,white,1,1,List.of(0),false)),0);
    }
    /** 只持久化不可变基础资源；场景生成的文字和皮肤归当前场景所有。 */
    void writeCache(java.io.DataOutput out)throws java.io.IOException{
        out.writeUTF(id);out.writeInt(padding);out.writeInt(baseSprites.size());
        for(var sprite:baseSprites.values().stream().sorted(java.util.Comparator.comparing(s->s.name)).toList()){
            out.writeUTF(sprite.name);out.writeInt(sprite.frameWidth);out.writeInt(sprite.frameHeight);
            out.writeInt(sprite.sheet.width);out.writeInt(sprite.sheet.height);out.writeInt(sprite.frameCount);out.writeInt(sprite.frameTime);
            out.writeBoolean(sprite.interpolate);out.writeInt(sprite.frames.size());for(int frame:sprite.frames)out.writeInt(frame);
            for(int pixel:sprite.sheet.pixels())out.writeInt(pixel);
        }
    }
    static SpriteAtlas readCache(java.io.DataInput in)throws java.io.IOException{
        String id=in.readUTF();int padding=in.readInt(),count=in.readInt();
        if(!id.equals("blocks")||padding!=1||count<1||count>32768)throw new java.io.IOException("Invalid cached atlas");
        long pixels=0,frames=0;Map<String,SpriteContents> loaded=new HashMap<>();
        for(int i=0;i<count;i++){
            String name=in.readUTF();int fw=in.readInt(),fh=in.readInt(),w=in.readInt(),h=in.readInt(),fc=in.readInt(),ft=in.readInt();
            boolean interpolate=in.readBoolean();int n=in.readInt();pixels+=(long)w*h;frames+=n;
            if(name.length()>512||loaded.containsKey(name)||w<1||h<1||w>16384||h>16384||fw<1||fh<1||fw>w||fh>h||w%fw!=0||h%fh!=0
                ||fc!=(w/fw)*(h/fh)||ft<1||n<1||frames>1048576||pixels>32L*1024*1024)throw new java.io.IOException("Invalid cached sprite");
            // 保留动画元数据原值，与普通加载路径保持一致。

            var order=new ArrayList<Integer>(n);for(int k=0;k<n;k++)order.add(in.readInt());
            var image=new Image(w,h);for(int p=0;p<image.pixels().length;p++)image.pixels()[p]=in.readInt();
            loaded.put(name,new SpriteContents(name,fw,fh,image,fc,ft,List.copyOf(order),interpolate));
        }
        if(!loaded.containsKey("minecraft:missingno"))throw new java.io.IOException("Missing cached fallback sprite");
        return new SpriteAtlas(id,loaded,padding);
    }

    /** 重新拼接场景文字和皮肤，保证 CPU 导出和 WebGL 使用相同像素。 */
    public void replaceGeneratedSprites(Map<String, Image> images) {
        boolean identical = images.size() == this.generatedPixels.size();
        if (identical) for (var item : images.entrySet()) {
            Image image = item.getValue();
            long size = ((long) image.width << 32) | image.height;
            if (!Long.valueOf(size).equals(this.generatedSizes.get(item.getKey()))
                || !java.util.Arrays.equals(image.pixels(), this.generatedPixels.get(item.getKey()))) {
                identical = false; break;
            }
        }
        if (identical) return;
        Map<String, SpriteContents> combined = new HashMap<>(this.baseSprites);
        images.forEach((id, image) -> combined.put(id,
            new SpriteContents(id, image.width, image.height, image, 1, 1, List.of(0), false)));
        SpriteAtlas rebuilt = new SpriteAtlas(this.id, combined, this.padding);
        this.sprites.clear(); this.sprites.putAll(rebuilt.sprites);
        this.entries.clear(); this.entries.putAll(rebuilt.entries);
        this.stitched = rebuilt.stitched;
        this.generatedPixels.clear(); this.generatedSizes.clear();
        images.forEach((name,image) -> {
            this.generatedPixels.put(name,image.pixels().clone());
            this.generatedSizes.put(name,((long)image.width << 32) | image.height);
        });
        this.regionTransparency.clear();
        this.bakedTick = 0;
        this.sprites.values().forEach(sprite -> sprite.lastBakedFrame = sprite.frameAtTick(0));
    }

    private int bakedTick;

    private SpriteAtlas(String id, Map<String, SpriteContents> loaded, int padding) {
        this.id = id;
        this.padding = padding;
        this.baseSprites.putAll(loaded);
        // 按高度降序采用货架式布局拼接图集。
        List<SpriteContents> sorted = new ArrayList<>(loaded.values());
        sorted.sort((a, b) -> {
            int cmp = Integer.compare(b.frameHeight + 2 * padding, a.frameHeight + 2 * padding);
            return cmp != 0 ? cmp : a.name.compareTo(b.name);
        });
        int pad = padding;

        long totalArea = 0;
        int maxDim = 0;
        for (SpriteContents s : sorted) {
            totalArea += (long) (s.frameWidth + 2 * pad) * (s.frameHeight + 2 * pad);
            maxDim = Math.max(maxDim, s.frameWidth + 2 * pad);
        }
        int estWidth = (int) Math.max(maxDim, Math.ceil(Math.sqrt(totalArea * 1.15)));
        int width = Math.min(4096, roundUpPow2(Math.max(estWidth, 16)));


        int[] layout = packShelves(sorted, width, pad);
        int height = roundUpPow2(Math.max(layout[0], 16));
        this.stitched = new Image(width, height);
        int cx = 0, cy = 0, crow = 0;
        for (SpriteContents s : sorted) {
            int w = s.frameWidth + 2 * pad, h = s.frameHeight + 2 * pad;
            if (cx + w > width && cx > 0) {
                cy += crow;
                cx = 0;
                crow = 0;
            }
            int px = cx + pad, py = cy + pad;
            // 第零刻遵循动画元数据中的帧顺序，不能假定从源图第零帧开始。
            int firstFrame=s.frameAtTick(0);
            s.sheet.blitTo(this.stitched,s.frameX(firstFrame)*s.frameWidth,s.frameY(firstFrame)*s.frameHeight,
                px,py,s.frameWidth,s.frameHeight);
            extrude(px,py,s.frameWidth,s.frameHeight);
            s.lastBakedFrame=firstFrame;
            float u0 = (float) px / width;
            float v0 = (float) py / height;
            float u1 = (float) (px + s.frameWidth) / width;
            float v1 = (float) (py + s.frameHeight) / height;
            this.sprites.put(s.name, s);
            this.entries.put(s.name, new Entry(s, u0, v0, u1, v1, px, py));
            cx += w;
            crow = Math.max(crow, h);
        }
        this.bakedTick = 0;
    }

    /** 动画只原地替换贴图像素，不改变布局和 UV，因此现有面片始终有效。 */
    public int rebakeAtTick(int tick) {
        if (tick == this.bakedTick) return 0;
        int changed = 0;
        for (Map.Entry<String, Entry> e : this.entries.entrySet()) {
            SpriteContents s = e.getValue().contents;
            if (!s.isAnimated()) continue;
            int frame = s.frameAtTick(tick);
            if (frame == s.lastBakedFrame) continue;
            s.lastBakedFrame = frame;
            int px = e.getValue().pixelX;
            int py = e.getValue().pixelY;
            for (int y = 0; y < s.frameHeight; y++) {
                for (int x = 0; x < s.frameWidth; x++) {
                    this.stitched.setPixel(px + x, py + y, s.framePixel(frame, x, y));
                }
            }
            extrude(px,py,s.frameWidth,s.frameHeight);
            changed++;
        }
        this.bakedTick = tick;
        return changed;
    }

    /** 将边缘像素复制到留白区，避免多重采样使相邻贴图串色或墙面漏光。 */
    private void extrude(int x,int y,int width,int height) {
        for(int dy=-padding;dy<height+padding;dy++)for(int dx=-padding;dx<width+padding;dx++) {
            if(dx>=0&&dx<width&&dy>=0&&dy<height)continue;
            stitched.setPixel(x+dx,y+dy,stitched.pixel(x+Math.max(0,Math.min(width-1,dx)),y+Math.max(0,Math.min(height-1,dy))));
        }
    }


    public int bakedTick() {
        return this.bakedTick;
    }

    public record AnimationCycle(int frames, boolean complete) {}
    /** 仅根据当前场景实际使用的纹理选择公共动画周期。 */
    public AnimationCycle animationCycle(io.github.litematicrender.render.scene.SceneMesh mesh, int limit) {
        int maximum=Math.max(1,limit);
        long period=1;
        java.util.Set<String> used=new java.util.HashSet<>();
        for(var layer:List.of(mesh.solid,mesh.cutout,mesh.portal,mesh.fluid,mesh.translucent))
            for(var quad:layer)if(quad.spriteId!=null)used.add(quad.spriteId);
        for(String id:used) {
            SpriteContents sprite=this.sprites.get(id);
            if(sprite==null || !sprite.isAnimated())continue;
            long duration=(long)sprite.frames.size()*Math.max(1,sprite.frameTime);
            long a=period,b=duration;
            while(b!=0){long rest=a%b;a=b;b=rest;}
            long common=period/a;
            if(common>maximum/duration)return new AnimationCycle(maximum,false);
            period=common*duration;
        }
        return new AnimationCycle((int)period,true);
    }


    private static int[] packShelves(List<SpriteContents> sorted, int width, int pad) {
        int x = 0, y = 0, rowH = 0;
        for (SpriteContents s : sorted) {
            int w = s.frameWidth + 2 * pad, h = s.frameHeight + 2 * pad;
            if (x + w > width && x > 0) {
                y += rowH;
                x = 0;
                rowH = 0;
            }
            x += w;
            rowH = Math.max(rowH, h);
        }
        return new int[]{y + rowH};
    }

    private static int roundUpPow2(int v) {
        int p = 16;
        while (p < v) p <<= 1;
        return p;
    }

    public Optional<Entry> get(String spriteId) {
        return Optional.ofNullable(this.entries.get(spriteId));
    }

    /** 按一个面实际采样的 UV 区域判断透明度，不能只检查整张纹理。 */
    public Transparency transparencyOf(String spriteId, float u0, float v0, float u1, float v1,
                                       float u2, float v2, float u3, float v3,
                                       boolean forceTranslucent) {
        // 强制材质标记优先于像素透明度检查。
        if (forceTranslucent) return Transparency.TRANSLUCENT;
        Entry e = spriteId == null ? null : this.entries.get(spriteId);
        if (e == null) return Transparency.NONE;

        float minU = Math.min(Math.min(u0, u1), Math.min(u2, u3));
        float minV = Math.min(Math.min(v0, v1), Math.min(v2, v3));
        float maxU = Math.max(Math.max(u0, u1), Math.max(u2, u3));
        float maxV = Math.max(Math.max(v0, v1), Math.max(v2, v3));


        if (minU <= 0f && minV <= 0f && maxU >= 1f && maxV >= 1f) {
            return Transparency.of(e.contents.hasTransparent, e.contents.hasTranslucent);
        }
        // 将近似 UV 矩形量化为同一缓存键，精度为单张贴图的 1/64。

        String key = spriteId + '|' + Math.round(minU * 64) + ',' + Math.round(minV * 64) + ','
            + Math.round(maxU * 64) + ',' + Math.round(maxV * 64);
        return this.regionTransparency.computeIfAbsent(key,
            k -> e.contents.transparencyIn(minU, minV, maxU, maxV));
    }


    private final Map<String, Transparency> regionTransparency = new java.util.concurrent.ConcurrentHashMap<>();

    public SpriteContents getOrMissing(String spriteId) {
        SpriteContents s = this.sprites.get(spriteId);
        return s != null ? s : missingContents();
    }

    public Entry getOrMissingEntry(String spriteId) {
        Entry e = this.entries.get(spriteId);
        if (e != null) return e;
        RenderDiagnostics.note("sprite not in atlas", spriteId);
        return this.entries.get("minecraft:missingno");
    }

    private static SpriteContents missingContents() {
        return new SpriteContents("minecraft:missingno", 16, 16, Image.missing(), 1, 1, List.of(0), false);
    }

    public int spriteCount() {
        return this.sprites.size();
    }

    // ------------------------------------------------------------------


    /** 不同资源包的图集定义需要合并，不能像普通资源那样仅保留最高优先级文件。 */
    public static SpriteAtlas load(ResourceManager resources, String atlasId) {
        Map<String, SpriteContents> loaded = new HashMap<>();
        String defPath = "atlases/" + atlasId + ".json";
        List<Object> sources = new ArrayList<>();


        for (byte[] data : resources.getResourceStack("minecraft", defPath)) {
            try {
                Map<String, Object> root = MiniJson.parseObject(new String(data, java.nio.charset.StandardCharsets.UTF_8));
                List<Object> arr = MiniJson.asArray(root.get("sources"));
                if (arr != null) sources.addAll(arr);
            } catch (Exception e) {
                System.err.println("[SpriteAtlas] bad atlas json: " + e);
            }
        }

        for (Object srcObj : sources) {
            Map<String, Object> src = MiniJson.asObject(srcObj);
            if (src == null) continue;
            String type = MiniJson.asString(src.get("type"), "");
            switch (type) {
                case "minecraft:directory" -> {
                    String sourceDir = MiniJson.asString(src.get("source"), "");
                    String prefix = MiniJson.asString(src.get("prefix"), sourceDir.isEmpty() ? "" : sourceDir + "/");
                    for (String[] pair : resources.listResources("textures/" + sourceDir, ".png")) {
                        String ns = pair[0];
                        String rel = pair[1];

                        String relNoExt = rel.substring(0, rel.length() - 4);
                        String spriteId = ns + ":" + prefix + relNoExt.substring(("textures/" + sourceDir + "/").length());
                        loadSprite(resources, loaded, ns, relNoExt + ".png", spriteId);
                    }
                }
                case "minecraft:single" -> {
                    String resourceId = MiniJson.asString(src.get("resource"), "");

                    String ns = "minecraft";
                    String path = resourceId;
                    int colon = resourceId.indexOf(':');
                    if (colon >= 0) {
                        ns = resourceId.substring(0, colon);
                        path = resourceId.substring(colon + 1);
                    }
                    String spriteOverride = MiniJson.asString(src.get("sprite"), null);
                    String spriteId = spriteOverride != null ? spriteOverride : resourceId;
                    loadSprite(resources, loaded, ns, "textures/" + path + ".png", spriteId);
                }
                default -> {   }
            }
        }


        loaded.putIfAbsent("minecraft:missingno", missingContents());
        return new SpriteAtlas(atlasId, loaded, 1);
    }

    private static void loadSprite(ResourceManager resources, Map<String, SpriteContents> loaded,
                                   String ns, String texPath, String spriteId) {
        byte[] png = resources.getResource(ns, texPath).orElse(null);
        if (png == null) return;
        try {
            Image img = Image.read(png);
            int frameTime = 1;
            List<Integer> frames = null;
            boolean interpolate = false;
            // 动画帧尺寸优先使用元数据中的宽高，否则取能放入图像的最大正方形。

            // 所有动画纹理都必须计算帧尺寸，不能把整条动画图当成单帧。


            int fw = Math.min(img.width, img.height);
            int fh = fw;
            boolean animated = false;

            byte[] mcmeta = resources.getResource(ns, texPath + ".mcmeta").orElse(null);
            if (mcmeta != null) {
                try {
                    Map<String, Object> root = MiniJson.parseObject(new String(mcmeta, java.nio.charset.StandardCharsets.UTF_8));
                    Map<String, Object> anim = MiniJson.asObject(root.get("animation"));
                    if (anim != null) {
                        animated = true;
                        frameTime = Math.max(1, MiniJson.asInt(anim.get("frametime"), 1));
                        interpolate = MiniJson.asBool(anim.get("interpolate"), false);

                        int fwOverride = MiniJson.asInt(anim.get("width"), 0);
                        int fhOverride = MiniJson.asInt(anim.get("height"), 0);
                        if (fwOverride > 0 && fhOverride > 0) {
                            fw = fwOverride;
                            fh = fhOverride;
                        } else if (fwOverride > 0) {
                            fw = fwOverride;
                            fh = img.height;
                        } else if (fhOverride > 0) {
                            fw = img.width;
                            fh = fhOverride;
                        }
                        if (fw <= 0 || fh <= 0 || img.width % fw != 0 || img.height % fh != 0) {
                            int min = Math.min(img.width, img.height);
                            fw = fh = min;
                        }
                        List<Object> frameArr = MiniJson.asArray(anim.get("frames"));
                        if (frameArr != null && !frameArr.isEmpty()) {
                            frames = new ArrayList<>();
                            for (Object f : frameArr) {
                                if (f instanceof Number n) frames.add(n.intValue());

                            }
                        }
                    }
                } catch (Exception ignored) {}
            }
            if (!animated) {

                fw = img.width;
                fh = img.height;
            }
            // 彩色玻璃保持资源作者给定的透明度，不为匹配玻璃板外观而提高不透明度。


            int frameCount = (img.height / fh) * (img.width / fw);
            if (frames == null) {
                frames = new ArrayList<>();
                for (int i = 0; i < frameCount; i++) frames.add(i);
            }
            loaded.putIfAbsent(spriteId, new SpriteContents(spriteId, fw, fh, img, Math.max(1, frameCount), frameTime, frames, interpolate));
        } catch (Exception ignored) {}
    }
}
