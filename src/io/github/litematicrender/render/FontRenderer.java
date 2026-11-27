package io.github.litematicrender.render;

import io.github.litematicrender.render.scene.BlockEntityData;
import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.util.MiniJson;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import java.util.zip.ZipInputStream;

/** 支持 Minecraft 位图与按需懒加载 Unihex 字体，完整合并资源包字体栈并支持富文本样式。 */
public final class FontRenderer {
    private record Glyph(Image sheet, int x, int y, int w, int h, float scale, float advance, float yOffset) {}
    private record SizeOverride(int from, int to, Integer left, Integer right) {}

    /** 按需解压并索引 Unihex .hex 文件，避免启动时为 11 万字形提前分配 Image。 */
    private static final class UnihexSource {
        private final byte[] zipBytes;
        private final List<SizeOverride> overrides;
        private boolean indexed;
        private byte[] hexBytes;
        private int[] keys;
        private int[] offsets;
        private int mask;
        private int count;

        UnihexSource(byte[] zipBytes, List<SizeOverride> overrides) {
            this.zipBytes = zipBytes;
            this.overrides = overrides;
        }

        synchronized void ensureIndexed() {
            if (indexed) return;
            indexed = true;
            try (var in = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
                var combined = new ByteArrayOutputStream(1 << 20);
                for (var entry = in.getNextEntry(); entry != null; entry = in.getNextEntry()) {
                    if (!entry.getName().endsWith(".hex")) continue;
                    in.transferTo(combined);
                    combined.write('\n');
                }
                hexBytes = combined.toByteArray();
                int cap = 1 << 18; // 262,144 slots for ~114k Unifont entries (< 45% load)
                keys = new int[cap];
                offsets = new int[cap];
                Arrays.fill(keys, -1);
                mask = cap - 1;
                int n = hexBytes.length, pos = 0;
                while (pos < n) {
                    int lineStart = pos;
                    int colon = -1;
                    while (pos < n && hexBytes[pos] != '\n' && hexBytes[pos] != '\r') {
                        if (colon < 0 && hexBytes[pos] == ':') colon = pos;
                        pos++;
                    }
                    while (pos < n && (hexBytes[pos] == '\n' || hexBytes[pos] == '\r')) pos++;
                    if (colon <= lineStart) continue;
                    int cp = parseHexInt(hexBytes, lineStart, colon);
                    if (cp < 0 || !supported(cp)) continue;
                    if (count * 2 >= keys.length) grow();
                    put(cp, colon + 1);
                }
            } catch (IOException ignored) {
                hexBytes = new byte[0];
                keys = new int[0];
                offsets = new int[0];
            }
        }

        private void grow() {
            int[] oldKeys = keys, oldOffsets = offsets;
            int newCap = oldKeys.length * 2;
            keys = new int[newCap];
            offsets = new int[newCap];
            Arrays.fill(keys, -1);
            mask = newCap - 1;
            count = 0;
            for (int i = 0; i < oldKeys.length; i++) {
                if (oldKeys[i] >= 0) put(oldKeys[i], oldOffsets[i]);
            }
        }

        private void put(int cp, int off) {
            int slot = mix(cp) & mask;
            while (keys[slot] >= 0) {
                if (keys[slot] == cp) return;
                slot = (slot + 1) & mask;
            }
            keys[slot] = cp;
            offsets[slot] = off;
            count++;
        }

        private static int mix(int x) {
            x ^= x >>> 16; x *= 0x7feb352d; x ^= x >>> 15; return x;
        }

        private static int parseHexInt(byte[] b, int start, int end) {
            int val = 0;
            for (int i = start; i < end; i++) {
                int d = hexDigit(b[i]);
                if (d < 0) return -1;
                val = (val << 4) | d;
            }
            return val;
        }

        private static int hexDigit(byte c) {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            return -1;
        }

        private int findOffset(int cp) {
            ensureIndexed();
            if (keys == null || keys.length == 0) return -1;
            int slot = mix(cp) & mask;
            while (keys[slot] >= 0) {
                if (keys[slot] == cp) return offsets[slot];
                slot = (slot + 1) & mask;
            }
            return -1;
        }

        boolean contains(int cp) {
            return findOffset(cp) >= 0;
        }

        Glyph decode(int cp) {
            int start = findOffset(cp);
            if (start < 0) return null;
            int end = start;
            while (end < hexBytes.length && hexBytes[end] != '\n' && hexBytes[end] != '\r') end++;
            while (start < end && hexBytes[start] <= ' ') start++;
            while (end > start && hexBytes[end - 1] <= ' ') end--;
            int len = end - start;
            int digits = len / 16, width = digits * 4;
            if (digits < 2 || digits > 8 || len != digits * 16) return null;
            long[] rows = new long[16];
            int left = width, right = -1;
            for (int y = 0; y < 16; y++) {
                long row = 0;
                int base = start + y * digits;
                for (int d = 0; d < digits; d++) {
                    int nibble = hexDigit(hexBytes[base + d]);
                    if (nibble < 0) return null;
                    row = (row << 4) | nibble;
                }
                rows[y] = row;
                for (int x = 0; x < width; x++) {
                    if ((row & (1L << (width - 1 - x))) != 0) {
                        left = Math.min(left, x);
                        right = Math.max(right, x);
                    }
                }
            }
            if (right < left) { left = 0; right = width - 1; }
            for (var o : overrides) {
                if (cp >= o.from && cp <= o.to) {
                    if (o.left != null) left = o.left;
                    if (o.right != null) right = o.right;
                }
            }
            int glyphW = Math.max(1, right - left + 1);
            Image image = new Image(glyphW, 16);
            for (int y = 0; y < 16; y++) {
                for (int x = left; x <= right; x++) {
                    if (x >= 0 && x < width && (rows[y] & (1L << (width - 1 - x))) != 0) {
                        image.setPixel(x - left, y, 0xFFFFFFFF);
                    }
                }
            }
            return new Glyph(image, 0, 0, image.width, 16, 0.5f, image.width / 2f + 1, 0f);
        }
    }

    private static final class FontSet {
        final Map<Integer, Glyph> glyphs = new HashMap<>();
        final Map<Integer, Float> spaces = new HashMap<>();
        final List<UnihexSource> unihex = new ArrayList<>();
        final Set<String> visited = new HashSet<>();
        int providers;

        boolean hasGlyph(int cp) {
            if (!supported(cp)) return false;
            if (spaces.containsKey(cp) || glyphs.containsKey(cp)) return true;
            for (var src : unihex) if (src.contains(cp)) return true;
            return false;
        }

        Glyph glyph(int cp) {
            if (!supported(cp)) return null;
            Glyph g = glyphs.get(cp);
            if (g != null || glyphs.containsKey(cp)) return g;
            for (var src : unihex) {
                Glyph decoded = src.decode(cp);
                if (decoded != null) {
                    glyphs.put(cp, decoded);
                    return decoded;
                }
            }
            return null;
        }
    }

    private final ResourceManager resources;
    private final Map<String, FontSet> fonts = new HashMap<>();
    private final FontSet defaultFont;
    private final Map<String, String> translations;
    private int missingGlyphs;

    private record SignKey(List<BlockEntityData.StyledLine> lines, int color, boolean glow, boolean hanging) {}
    public record SignPanel(String spriteId, Image image) {}
    private final Map<SignKey, SignPanel> signPanels = new LinkedHashMap<>(256, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<SignKey, SignPanel> item) { return size() > 256; }
    };

    private FontRenderer(ResourceManager resources) {
        this.resources = resources;
        this.translations = loadTranslations(resources);
        this.defaultFont = loadFontSet("minecraft:default");
        this.fonts.put("minecraft:default", this.defaultFont);
    }

    public static FontRenderer load(ResourceManager resources) {
        return new FontRenderer(resources);
    }

    public Map<String, String> translations() {
        return this.translations;
    }

    private static Map<String, String> loadTranslations(ResourceManager resources) {
        Map<String, String> map = new HashMap<>();
        for (String lang : List.of("en_us", "zh_cn")) {
            List<byte[]> stack = resources.getResourceStack("minecraft", "lang/" + lang + ".json");
            for (int i = stack.size() - 1; i >= 0; i--) {
                try {
                    Map<String, Object> obj = MiniJson.parseObject(new String(stack.get(i), StandardCharsets.UTF_8));
                    obj.forEach((k, v) -> { if (v instanceof String s) map.put(k, s); });
                } catch (Exception ignored) {}
            }
        }
        return Map.copyOf(map);
    }

    private synchronized FontSet fontSet(String id) {
        if (id == null || id.isEmpty() || id.equals("minecraft:default") || id.equals("default")) return defaultFont;
        String normalized = id.contains(":") ? id : "minecraft:" + id;
        return fonts.computeIfAbsent(normalized, this::loadFontSet);
    }

    private FontSet loadFontSet(String id) {
        FontSet set = new FontSet();
        readFont(set, id);
        return set;
    }

    /** 合并整条资源包栈中的字体定义，确保自定义图标包不会覆盖清空原版字体。 */
    private void readFont(FontSet set, String id) {
        String normalized = id.contains(":") ? id : "minecraft:" + id;
        if (!set.visited.add(normalized)) return;
        String[] parts = normalized.split(":", 2);
        List<byte[]> stack = resources.getResourceStack(parts[0], "font/" + parts[1] + ".json");
        for (byte[] data : stack) {
            try {
                var root = MiniJson.parseObject(new String(data, StandardCharsets.UTF_8));
                var list = MiniJson.asArray(root.get("providers"));
                if (list == null) continue;
                for (Object item : list) {
                    var p = MiniJson.asObject(item);
                    if (p == null) continue;
                    var filter = MiniJson.asObject(p.get("filter"));
                    if (filter != null && (Boolean.TRUE.equals(filter.get("jp")) || Boolean.TRUE.equals(filter.get("uniform")))) continue;
                    switch (MiniJson.asString(p.get("type"), "")) {
                        case "reference", "minecraft:reference" -> {
                            String refId = MiniJson.asString(p.get("id"), "");
                            if (!refId.isEmpty()) readFont(set, refId);
                        }
                        case "bitmap", "minecraft:bitmap" -> readBitmap(set, p);
                        case "space", "minecraft:space" -> {
                            var advances = MiniJson.asObject(p.get("advances"));
                            if (advances != null) advances.forEach((s, n) -> {
                                if (!s.isEmpty() && n instanceof Number value) set.spaces.putIfAbsent(s.codePointAt(0), value.floatValue());
                            });
                        }
                        case "unihex", "minecraft:unihex" -> readUnihex(set, p);
                        default -> { }
                    }
                }
            } catch (Exception e) {
                System.err.println("[FontRenderer] Cannot load " + normalized + ": " + e.getMessage());
            }
        }
    }

    private byte[] resource(String id, String prefix, String suffix) {
        String[] parts = id.split(":", 2);
        return resources.getResource(parts.length == 2 ? parts[0] : "minecraft",
            prefix + parts[parts.length - 1] + suffix).orElse(null);
    }

    private void readBitmap(FontSet set, Map<String, Object> p) throws IOException {
        byte[] bytes = resource(MiniJson.asString(p.get("file"), ""), "textures/", "");
        if (bytes == null) return;
        Image sheet = Image.read(bytes);
        var rows = MiniJson.asArray(p.get("chars"));
        if (rows == null || rows.isEmpty()) return;
        int cols = rows.stream().mapToInt(r -> r.toString().codePointCount(0, r.toString().length())).max().orElse(0);
        if (cols == 0) return;
        int cellW = sheet.width / cols, cellH = sheet.height / rows.size();
        if (cellW <= 0 || cellH <= 0) return;
        int height = MiniJson.asInt(p.get("height"), 8);
        int ascent = MiniJson.asInt(p.get("ascent"), 7);
        float scale = height / (float) cellH;
        float yOffset = 7f - ascent;
        for (int y = 0; y < rows.size(); y++) {
            int[] codepoints = rows.get(y).toString().codePoints().toArray();
            for (int x = 0; x < codepoints.length; x++) {
                int cp = codepoints[x];
                if (cp == 0 || !supported(cp) || set.glyphs.containsKey(cp)) continue;
                int last = -1;
                for (int gx = 0; gx < cellW; gx++) for (int gy = 0; gy < cellH; gy++) {
                    if (Image.alpha(sheet.pixel(x * cellW + gx, y * cellH + gy)) > 0) last = Math.max(last, gx);
                }
                if (last < 0) continue;
                int inkW = last + 1;
                set.glyphs.putIfAbsent(cp, new Glyph(sheet, x * cellW, y * cellH, inkW, cellH, scale, inkW * scale + 1, yOffset));
            }
        }
        set.providers++;
    }

    private void readUnihex(FontSet set, Map<String, Object> p) throws IOException {
        byte[] zip = resource(MiniJson.asString(p.get("hex_file"), ""), "", "");
        if (zip == null) throw new IOException("Missing bundled Unihex file");
        List<SizeOverride> overrides = new ArrayList<>();
        var rawOverrides = MiniJson.asArray(p.get("size_overrides"));
        if (rawOverrides != null) {
            for (Object o : rawOverrides) {
                var range = MiniJson.asObject(o);
                if (range == null) continue;
                String from = MiniJson.asString(range.get("from"), ""), to = MiniJson.asString(range.get("to"), "");
                if (from.isEmpty() || to.isEmpty()) continue;
                Integer left = range.get("left") instanceof Number n ? n.intValue() : null;
                Integer right = range.get("right") instanceof Number n ? n.intValue() : null;
                overrides.add(new SizeOverride(from.codePointAt(0), to.codePointAt(0), left, right));
            }
        }
        set.unihex.add(new UnihexSource(zip, List.copyOf(overrides)));
        set.providers++;
    }

    /** 放开全部有效 Unicode 可见字符（排除控制字符与代理项），由 Unihex 按需懒加载。 */
    private static boolean supported(int cp) {
        if (cp < 0x20 || cp == 0x7F || cp > 0x10FFFF) return false;
        if (cp >= 0xD800 && cp <= 0xDFFF) return false;
        return Character.getType(cp) != Character.CONTROL;
    }

    public synchronized boolean hasGlyph(int cp) {
        return defaultFont.hasGlyph(cp);
    }

    public synchronized int glyphsLoaded() {
        return defaultFont.glyphs.size();
    }

    public int providersLoaded() {
        return defaultFont.providers;
    }

    public int missingGlyphCount() {
        return missingGlyphs;
    }

    public synchronized boolean canRenderAny(String text) {
        return text != null && text.codePoints().anyMatch(cp -> supported(cp) && !defaultFont.spaces.containsKey(cp) && defaultFont.hasGlyph(cp));
    }

    public synchronized boolean canRenderAny(BlockEntityData.StyledLine line) {
        if (line == null) return false;
        for (var span : line.spans()) {
            FontSet fs = fontSet(span.font());
            boolean ok = span.text().codePoints().anyMatch(cp -> supported(cp)
                && !fs.spaces.containsKey(cp) && !defaultFont.spaces.containsKey(cp)
                && (fs.hasGlyph(cp) || defaultFont.hasGlyph(cp)));
            if (ok) return true;
        }
        return false;
    }

    /** 文字像素缓存属于资源会话，坐标和光照不影响缓存内容。 */
    public synchronized SignPanel signPanel(List<String> lines, int color, boolean glow, boolean hanging) {
        List<BlockEntityData.StyledLine> styled = new ArrayList<>();
        for (int i = 0; i < Math.min(4, lines.size()); i++) {
            String raw = lines.get(i);
            if (raw != null && raw.indexOf('\u00A7') >= 0) {
                styled.add(BlockEntityData.parseStyledJsonOrPlain(raw, translations));
            } else {
                styled.add(raw == null || raw.isEmpty() ? BlockEntityData.StyledLine.EMPTY
                    : new BlockEntityData.StyledLine(List.of(new BlockEntityData.TextSpan(raw, null, false, false, false, false, null))));
            }
        }
        return signPanelStyled(styled, color, glow, hanging);
    }

    public synchronized SignPanel signPanelStyled(List<BlockEntityData.StyledLine> lines, int color, boolean glow, boolean hanging) {
        SignKey key = new SignKey(List.copyOf(lines.subList(0, Math.min(4, lines.size()))), color, glow, hanging);
        SignPanel cached = signPanels.get(key);
        if (cached != null) return cached;
        int dark = color == 0 && glow ? 0xF0EBCC : scaleColor(color, 0.4f);
        int maxWidth = hanging ? 60 : 90, lineHeight = hanging ? 9 : 10;
        Image panel = new Image((maxWidth + 2) * 2, (lineHeight * 4 + 2) * 2);
        for (int i = 0; i < key.lines.size(); i++) {
            Image line = renderStyledLine(key.lines.get(i), 0xFF000000 | (glow ? color : dark), maxWidth,
                glow ? 0xFF000000 | dark : null, glow);
            int dx = (panel.width - line.width) / 2, dy = i * lineHeight * 2 + (glow ? 0 : 2);
            for (int py = 0; py < line.height; py++) for (int px = 0; px < line.width; px++) {
                int tx = dx + px, ty = dy + py, argb = line.pixel(px, py);
                if (tx >= 0 && ty >= 0 && tx < panel.width && ty < panel.height && Image.alpha(argb) != 0) panel.setPixel(tx, ty, argb);
            }
        }
        SignPanel result = new SignPanel(hashSprite("litematicrender:sign/", panel), panel);
        signPanels.put(key, result);
        return result;
    }

    /** 为 text_display 展示实体渲染多行富文本面板（支持背景色、阴影、对齐与换行宽度）。 */
    public synchronized SignPanel textDisplayPanel(List<BlockEntityData.StyledLine> paragraphs, int maxWidth,
                                                   int backgroundArgb, int textOpacity, boolean shadow, String alignment) {
        int lineW = Math.max(16, Math.min(512, maxWidth));
        List<Image> rendered = new ArrayList<>();
        int widest = 1;
        for (var para : paragraphs) {
            for (var wrapped : wrapStyledLine(para, lineW)) {
                Image img = renderStyledLine(wrapped, 0xFFFFFFFF, lineW, null, false);
                rendered.add(img);
                widest = Math.max(widest, img.width);
            }
        }
        if (rendered.isEmpty()) rendered.add(new Image(2, 16));
        int padX = 4, padY = 4, lineStep = 20;
        int w = widest + padX * 2, h = rendered.size() * lineStep + padY * 2 - 4;
        Image panel = new Image(Math.max(2, w), Math.max(2, h));
        if (Image.alpha(backgroundArgb) > 0) Arrays.fill(panel.pixels(), backgroundArgb);
        int alphaScale = Math.max(0, Math.min(255, textOpacity));
        for (int i = 0; i < rendered.size(); i++) {
            Image line = rendered.get(i);
            int dx = switch (alignment == null ? "center" : alignment) {
                case "left" -> padX;
                case "right" -> panel.width - padX - line.width;
                default -> (panel.width - line.width) / 2;
            };
            int dy = padY + i * lineStep;
            if (shadow) {
                for (int py = 0; py < line.height; py++) for (int px = 0; px < line.width; px++) {
                    int argb = line.pixel(px, py);
                    if (Image.alpha(argb) == 0) continue;
                    int sArgb = Image.argb(Image.alpha(argb) * alphaScale / 255,
                        Image.red(argb) / 4, Image.green(argb) / 4, Image.blue(argb) / 4);
                    blendOver(panel, dx + px + 2, dy + py + 2, sArgb);
                }
            }
            for (int py = 0; py < line.height; py++) for (int px = 0; px < line.width; px++) {
                int argb = line.pixel(px, py);
                if (Image.alpha(argb) == 0) continue;
                int fg = (argb & 0x00FFFFFF) | ((Image.alpha(argb) * alphaScale / 255) << 24);
                blendOver(panel, dx + px, dy + py, fg);
            }
        }
        return new SignPanel(hashSprite("litematicrender:text_display/", panel), panel);
    }

    private List<BlockEntityData.StyledLine> wrapStyledLine(BlockEntityData.StyledLine line, int maxWidth) {
        List<BlockEntityData.StyledLine> result = new ArrayList<>();
        List<BlockEntityData.TextSpan> current = new ArrayList<>();
        float width = 0;
        for (var span : line.spans()) {
            FontSet fs = fontSet(span.font());
            StringBuilder seg = new StringBuilder();
            int[] cps = span.text().codePoints().toArray();
            for (int cp : cps) {
                if (cp == '\r') continue;
                if (cp == '\n') {
                    if (!seg.isEmpty()) { current.add(withText(span, seg.toString())); seg.setLength(0); }
                    result.add(new BlockEntityData.StyledLine(List.copyOf(current)));
                    current.clear();
                    width = 0;
                    continue;
                }
                float adv = advanceOf(fs, cp, span.bold());
                if (width > 0 && width + adv > maxWidth) {
                    if (!seg.isEmpty()) { current.add(withText(span, seg.toString())); seg.setLength(0); }
                    result.add(new BlockEntityData.StyledLine(List.copyOf(current)));
                    current.clear();
                    width = 0;
                }
                seg.appendCodePoint(cp);
                width += adv;
            }
            if (!seg.isEmpty()) current.add(withText(span, seg.toString()));
        }
        if (!current.isEmpty() || result.isEmpty()) result.add(new BlockEntityData.StyledLine(List.copyOf(current)));
        return result;
    }

    private static BlockEntityData.TextSpan withText(BlockEntityData.TextSpan s, String t) {
        return new BlockEntityData.TextSpan(t, s.color(), s.bold(), s.italic(), s.underlined(), s.strikethrough(), s.font());
    }

    private static void blendOver(Image dst, int x, int y, int argb) {
        if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return;
        int a = Image.alpha(argb);
        if (a == 0) return;
        if (a == 255) { dst.setPixel(x, y, argb); return; }
        int under = dst.pixel(x, y), ua = Image.alpha(under);
        int outA = a + ua * (255 - a) / 255;
        if (outA <= 0) return;
        int r = (Image.red(argb) * a + Image.red(under) * ua * (255 - a) / 255) / outA;
        int g = (Image.green(argb) * a + Image.green(under) * ua * (255 - a) / 255) / outA;
        int b = (Image.blue(argb) * a + Image.blue(under) * ua * (255 - a) / 255) / outA;
        dst.setPixel(x, y, Image.argb(outA, r, g, b));
    }

    private static String hashSprite(String prefix, Image panel) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            var bytes = ByteBuffer.allocate(8 + panel.pixels().length * 4);
            bytes.putInt(panel.width).putInt(panel.height);
            for (int pixel : panel.pixels()) bytes.putInt(pixel);
            return prefix + HexFormat.of().formatHex(digest.digest(bytes.array()));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static int scaleColor(int rgb, float scale) {
        return (int) (((rgb >> 16) & 255) * scale) << 16 | (int) (((rgb >> 8) & 255) * scale) << 8 | (int) ((rgb & 255) * scale);
    }

    private float advanceOf(FontSet fs, int cp, boolean bold) {
        Float sp = fs.spaces.get(cp);
        if (sp == null) sp = defaultFont.spaces.get(cp);
        if (sp != null) return sp;
        Glyph g = fs.glyph(cp);
        if (g == null && fs != defaultFont) g = defaultFont.glyph(cp);
        return (g == null ? 5f : g.advance) + (bold && g != null ? 1f : 0f);
    }

    private record LaidGlyph(Glyph glyph, int x, int advancePx, int argb, Integer outline,
                             boolean bold, boolean italic, boolean underlined, boolean strikethrough) {}

    /** 以两倍分辨率绘制告示牌文字，并按游戏逻辑宽度裁剪。 */
    public synchronized Image renderLine(String text, int argb, int maxWidth, Integer outline) {
        var line = text == null || text.isEmpty() ? BlockEntityData.StyledLine.EMPTY
            : new BlockEntityData.StyledLine(List.of(new BlockEntityData.TextSpan(text, null, false, false, false, false, null)));
        return renderStyledLine(line, argb, maxWidth, outline, outline != null);
    }

    public synchronized Image renderStyledLine(BlockEntityData.StyledLine line, int defaultArgb, int maxWidth,
                                               Integer defaultOutline, boolean glow) {
        List<LaidGlyph> laid = new ArrayList<>();
        float width = 0;
        outer:
        for (var span : line.spans()) {
            FontSet fs = fontSet(span.font());
            int spanArgb = span.color() == null ? defaultArgb : (0xFF000000 | (span.color() & 0xFFFFFF));
            Integer spanOutline = defaultOutline;
            if (glow && span.color() != null) {
                int sc = span.color() & 0xFFFFFF;
                spanOutline = 0xFF000000 | (sc == 0 ? 0xF0EBCC : scaleColor(sc, 0.4f));
            }
            for (int cp : span.text().codePoints().toArray()) {
                if (cp == '\n' || cp == '\r') break outer;
                Float sp = fs.spaces.get(cp);
                if (sp == null) sp = defaultFont.spaces.get(cp);
                Glyph g = null;
                if (sp == null && supported(cp)) {
                    g = fs.glyph(cp);
                    if (g == null && fs != defaultFont) g = defaultFont.glyph(cp);
                }
                float advance = sp != null ? sp : (g == null ? 5f : g.advance) + (span.bold() && g != null ? 1f : 0f);
                if (width + advance > maxWidth) break outer;
                if (g == null && sp == null && supported(cp)) missingGlyphs++;
                int xPx = Math.round(width * 2);
                int advPx = Math.max(0, Math.round((width + advance) * 2) - xPx);
                laid.add(new LaidGlyph(g, xPx, advPx, spanArgb, spanOutline, span.bold(), span.italic(), span.underlined(), span.strikethrough()));
                width += advance;
            }
        }
        int pad = defaultOutline == null ? 0 : 2;
        Image out = new Image(Math.max(1, Math.round(width * 2)) + pad * 2, 16 + pad * 2);
        if (defaultOutline != null) {
            for (int oy = -2; oy <= 2; oy += 2) for (int ox = -2; ox <= 2; ox += 2) {
                if (ox == 0 && oy == 0) continue;
                for (var lg : laid) {
                    if (lg.outline == null) continue;
                    drawGlyph(out, lg, pad + ox, pad + oy, lg.outline);
                }
            }
        }
        for (var lg : laid) drawGlyph(out, lg, pad, pad, lg.argb);
        return out;
    }

    private static void drawGlyph(Image dst, LaidGlyph lg, int baseX, int baseY, int argb) {
        if (lg.glyph != null) {
            int dy = baseY + Math.round(lg.glyph.yOffset * 2);
            blit(dst, lg.glyph, baseX + lg.x, dy, argb, lg.italic);
            if (lg.bold) blit(dst, lg.glyph, baseX + lg.x + 2, dy, argb, lg.italic);
        }
        if (lg.underlined && lg.advancePx > 0) fillRect(dst, baseX + lg.x, baseY + 14, lg.advancePx, 2, argb);
        if (lg.strikethrough && lg.advancePx > 0) fillRect(dst, baseX + lg.x, baseY + 7, lg.advancePx, 2, argb);
    }

    private static void fillRect(Image dst, int x, int y, int w, int h, int argb) {
        for (int dy = 0; dy < h; dy++) for (int dx = 0; dx < w; dx++) {
            int px = x + dx, py = y + dy;
            if (px >= 0 && py >= 0 && px < dst.width && py < dst.height) dst.setPixel(px, py, argb);
        }
    }

    private static void blit(Image dst, Glyph glyph, int dx, int dy, int argb, boolean italic) {
        int w = Math.round(glyph.w * glyph.scale * 2), h = Math.round(glyph.h * glyph.scale * 2);
        if (w <= 0 || h <= 0) return;
        for (int y = 0; y < h; y++) {
            int shear = italic ? Math.round((1f - (float) y / Math.max(1, h - 1)) * 2f) : 0;
            for (int x = 0; x < w; x++) {
                int sx = glyph.x + Math.min(glyph.w - 1, (int) (x / (glyph.scale * 2)));
                int sy = glyph.y + Math.min(glyph.h - 1, (int) (y / (glyph.scale * 2)));
                if (Image.alpha(glyph.sheet.pixel(sx, sy)) == 0) continue;
                int px = dx + x + shear, py = dy + y;
                if (px >= 0 && py >= 0 && px < dst.width && py < dst.height) dst.setPixel(px, py, argb);
            }
        }
    }
}
