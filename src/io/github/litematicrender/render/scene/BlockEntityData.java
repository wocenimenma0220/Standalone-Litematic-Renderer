package io.github.litematicrender.render.scene;

import io.github.litematicrender.nbt.NbtCompound;
import io.github.litematicrender.nbt.NbtElement;
import io.github.litematicrender.nbt.NbtList;
import io.github.litematicrender.nbt.NbtScalars;
import io.github.litematicrender.util.MiniJson;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 读取静态渲染需要的方块实体 NBT，补充原版实体渲染器负责的外观数据。 */
public final class BlockEntityData {

    public record TextSpan(String text, Integer color, boolean bold, boolean italic,
                           boolean underlined, boolean strikethrough, String font) {}

    public record StyledLine(List<TextSpan> spans) {
        public static final StyledLine EMPTY = new StyledLine(List.of());
        public boolean isBlank() {
            for (var s : spans) if (!s.text().isBlank()) return false;
            return true;
        }
        public String plain() {
            var sb = new StringBuilder();
            for (var s : spans) sb.append(s.text());
            return sb.toString();
        }
    }

    public record Sign(List<String> frontLines, List<String> backLines, int frontColor, int backColor,
                       boolean glowingFront, boolean glowingBack) {
        public boolean hasText() {
            return frontLines.stream().anyMatch(line -> !line.isBlank()) || backLines.stream().anyMatch(line -> !line.isBlank());
        }
    }

    public record StyledSign(List<StyledLine> frontLines, List<StyledLine> backLines, int frontColor, int backColor,
                             boolean glowingFront, boolean glowingBack) {
        public boolean hasText() {
            return frontLines.stream().anyMatch(line -> !line.isBlank()) || backLines.stream().anyMatch(line -> !line.isBlank());
        }
    }

    private record Style(Integer color, boolean bold, boolean italic, boolean underlined, boolean strikethrough, String font) {
        static final Style DEFAULT = new Style(null, false, false, false, false, null);
    }

    private BlockEntityData() {}

    public static List<String> potPatterns(NbtCompound tag) {
        var result = new ArrayList<String>();
        var allowed = java.util.Set.of("angler","archer","arms_up","blade","brewer","burn","danger","explorer","flow","friend","guster","heart","heartbreak","howl","miner","mourner","plenty","prize","scrape","sheaf","shelter","skull","snort");
        NbtElement decorations = tag == null ? null : tag.get("sherds").orElse(null);
        if (decorations == null && tag != null) {
            var components = tag.getCompound("components").orElse(null);
            if (components != null) decorations = components.get("minecraft:pot_decorations").orElse(null);
        }
        String[] keys={"back","left","right","front"};
        for(int i=0;i<4;i++) {
            NbtElement item = null;
            if(decorations instanceof NbtList list && i<list.size()) item=list.get(i);
            else if(decorations instanceof NbtCompound compound) item=compound.get(keys[i]).orElse(null);
            String id=item instanceof NbtScalars.NbtString text ? text.value
                : item instanceof NbtCompound stack ? stack.getStringOrDefault("id","") : "";
            String name=id.replace("minecraft:","").replace("_pottery_sherd","");
            result.add(allowed.contains(name) ? name : "blank");
        }
        return result;
    }

    /** 兼容旧版 Text1～Text4 和新版 front_text/back_text 的 messages 布局。 */
    public static Sign readSign(NbtCompound te) {
        var styled = readStyledSign(te, Map.of());
        List<String> front = styled.frontLines().stream().map(StyledLine::plain).toList();
        List<String> back = styled.backLines().stream().map(StyledLine::plain).toList();
        return new Sign(front, back, styled.frontColor(), styled.backColor(), styled.glowingFront(), styled.glowingBack());
    }

    /** 解析告示牌富文本组件，保留颜色、粗体/斜体/下划线/删除线、自定义字体、translate 与 § 格式码。 */
    public static StyledSign readStyledSign(NbtCompound te, Map<String, String> translations) {
        List<StyledLine> front = new ArrayList<>();
        List<StyledLine> back = new ArrayList<>();
        int frontColor = 0x000000;
        int backColor = 0x000000;
        boolean glowFront = false, glowBack = false;

        NbtCompound frontTag = te.getCompound("front_text").orElse(null);
        NbtCompound backTag = te.getCompound("back_text").orElse(null);
        if (frontTag != null || backTag != null) {
            if (frontTag != null) {
                readStyledMessages(frontTag, front, translations);
                frontColor = dyeColor(frontTag.getStringOrDefault("color", "black"));
                glowFront = frontTag.getBooleanOrDefault("has_glowing_text", false);
            }
            if (backTag != null) {
                readStyledMessages(backTag, back, translations);
                backColor = dyeColor(backTag.getStringOrDefault("color", "black"));
                glowBack = backTag.getBooleanOrDefault("has_glowing_text", false);
            }
        } else {
            for (int i = 1; i <= 4; i++) {
                String s = te.getStringOrDefault("Text" + i, "");
                front.add(parseStyledJsonOrPlain(s, translations));
            }
            frontColor = dyeColor(te.getStringOrDefault("Color", "black"));
            glowFront = te.getBooleanOrDefault("GlowingText", false);
        }
        return new StyledSign(front, back, frontColor, backColor, glowFront, glowBack);
    }

    private static void readStyledMessages(NbtCompound side, List<StyledLine> out, Map<String, String> translations) {
        NbtList messages = side.getList("messages").orElse(null);
        if (messages == null) return;
        for (int i = 0; i < messages.size(); i++) {
            out.add(parseStyledNbt(messages.get(i), translations));
        }
    }

    public static StyledLine parseStyledNbt(NbtElement value, Map<String, String> translations) {
        if (value == null) return StyledLine.EMPTY;
        List<TextSpan> out = new ArrayList<>();
        collectNbt(value, Style.DEFAULT, translations == null ? Map.of() : translations, out, 0);
        return out.isEmpty() ? StyledLine.EMPTY : new StyledLine(List.copyOf(out));
    }

    public static StyledLine parseStyledJsonOrPlain(String raw, Map<String, String> translations) {
        if (raw == null || raw.isEmpty()) return StyledLine.EMPTY;
        List<TextSpan> out = new ArrayList<>();
        Map<String, String> lang = translations == null ? Map.of() : translations;
        try {
            collectJson(MiniJson.parse(raw), Style.DEFAULT, lang, out, 0);
        } catch (RuntimeException e) {
            appendSectionFormatted(raw, Style.DEFAULT, out);
        }
        return out.isEmpty() ? StyledLine.EMPTY : new StyledLine(List.copyOf(out));
    }

    public static StyledLine parseSectionText(String raw) {
        if (raw == null || raw.isEmpty()) return StyledLine.EMPTY;
        List<TextSpan> out = new ArrayList<>();
        appendSectionFormatted(raw, Style.DEFAULT, out);
        return out.isEmpty() ? StyledLine.EMPTY : new StyledLine(List.copyOf(out));
    }

    /** 只提取可见文本，保留 Unicode 转义、字符串和 extra 数组，并剥离 § 格式码。 */
    public static String plainText(String raw) {
        return parseStyledJsonOrPlain(raw, Map.of()).plain();
    }

    /** 新版本文本组件也可能直接使用 NBT，而非 JSON 字符串。 */
    public static String nbtText(NbtElement value) {
        return parseStyledNbt(value, Map.of()).plain();
    }

    private static void collectNbt(NbtElement value, Style parent, Map<String, String> lang, List<TextSpan> out, int depth) {
        if (value == null || depth > 16) return;
        if (value instanceof NbtScalars.NbtString text) {
            // 告示牌或 text_display 常将 JSON 文本组件保存在字符串 NBT 中。
            if (depth == 0) {
                try {
                    collectJson(MiniJson.parse(text.value), parent, lang, out, depth + 1);
                    return;
                } catch (RuntimeException ignored) {}
            }
            appendSectionFormatted(text.value, parent, out);
            return;
        }
        if (value instanceof NbtList list) {
            Style inherited = parent;
            for (int i = 0; i < list.size(); i++) {
                NbtElement item = list.get(i);
                if (i == 0 && item instanceof NbtCompound first) {
                    inherited = mergeNbtStyle(first, parent);
                    collectNbtCompoundBody(first, inherited, lang, out, depth + 1);
                } else {
                    collectNbt(item, inherited, lang, out, depth + 1);
                }
            }
            return;
        }
        if (value instanceof NbtCompound compound) {
            Style style = mergeNbtStyle(compound, parent);
            collectNbtCompoundBody(compound, style, lang, out, depth + 1);
            return;
        }
        if (value instanceof NbtScalars.NbtByte b) appendSectionFormatted(Byte.toString(b.value), parent, out);
        else if (value instanceof NbtScalars.NbtShort s) appendSectionFormatted(Short.toString(s.value), parent, out);
        else if (value instanceof NbtScalars.NbtInt n) appendSectionFormatted(Integer.toString(n.value), parent, out);
        else if (value instanceof NbtScalars.NbtLong l) appendSectionFormatted(Long.toString(l.value), parent, out);
        else if (value instanceof NbtScalars.NbtFloat f) appendSectionFormatted(Float.toString(f.value), parent, out);
        else if (value instanceof NbtScalars.NbtDouble d) appendSectionFormatted(Double.toString(d.value), parent, out);
    }

    private static void collectNbtCompoundBody(NbtCompound c, Style style, Map<String, String> lang, List<TextSpan> out, int depth) {
        String text = c.getStringOrDefault("text", "");
        if (!text.isEmpty()) appendSectionFormatted(text, style, out);
        String translate = c.getStringOrDefault("translate", "");
        if (!translate.isEmpty()) {
            String fallback = c.getStringOrDefault("fallback", translate);
            String template = lang.getOrDefault(translate, fallback);
            NbtList with = c.getList("with").orElse(null);
            List<List<TextSpan>> args = new ArrayList<>();
            if (with != null) {
                for (var item : with.getElements()) {
                    List<TextSpan> argSpans = new ArrayList<>();
                    collectNbt(item, style, lang, argSpans, depth + 1);
                    args.add(argSpans);
                }
            }
            expandTranslation(template, args, style, out);
        }
        String keybind = c.getStringOrDefault("keybind", "");
        if (!keybind.isEmpty()) {
            appendSectionFormatted(lang.getOrDefault(keybind, keybind), style, out);
        }
        NbtList extra = c.getList("extra").orElse(null);
        if (extra != null) {
            for (var item : extra.getElements()) collectNbt(item, style, lang, out, depth + 1);
        }
    }

    private static void collectJson(Object value, Style parent, Map<String, String> lang, List<TextSpan> out, int depth) {
        if (value == null || depth > 16) return;
        if (value instanceof String text) {
            appendSectionFormatted(text, parent, out);
            return;
        }
        if (value instanceof Number || value instanceof Boolean) {
            appendSectionFormatted(String.valueOf(value), parent, out);
            return;
        }
        if (value instanceof List<?> list) {
            Style inherited = parent;
            for (int i = 0; i < list.size(); i++) {
                Object item = list.get(i);
                if (i == 0 && item instanceof Map<?, ?> first) {
                    inherited = mergeJsonStyle(first, parent);
                    collectJsonObjectBody(first, inherited, lang, out, depth + 1);
                } else {
                    collectJson(item, inherited, lang, out, depth + 1);
                }
            }
            return;
        }
        if (value instanceof Map<?, ?> map) {
            Style style = mergeJsonStyle(map, parent);
            collectJsonObjectBody(map, style, lang, out, depth + 1);
        }
    }

    private static void collectJsonObjectBody(Map<?, ?> map, Style style, Map<String, String> lang, List<TextSpan> out, int depth) {
        if (map.get("text") instanceof String s && !s.isEmpty()) {
            appendSectionFormatted(s, style, out);
        }
        if (map.get("translate") instanceof String key && !key.isEmpty()) {
            String fallback = map.get("fallback") instanceof String fb ? fb : key;
            String template = lang.getOrDefault(key, fallback);
            List<List<TextSpan>> args = new ArrayList<>();
            if (map.get("with") instanceof List<?> with) {
                for (Object item : with) {
                    List<TextSpan> argSpans = new ArrayList<>();
                    collectJson(item, style, lang, argSpans, depth + 1);
                    args.add(argSpans);
                }
            }
            expandTranslation(template, args, style, out);
        }
        if (map.get("keybind") instanceof String kb && !kb.isEmpty()) {
            appendSectionFormatted(lang.getOrDefault(kb, kb), style, out);
        }
        Object extra = map.get("extra");
        if (extra instanceof List<?> list) {
            for (Object item : list) collectJson(item, style, lang, out, depth + 1);
        } else if (extra != null) {
            collectJson(extra, style, lang, out, depth + 1);
        }
    }

    private static void expandTranslation(String template, List<List<TextSpan>> args, Style style, List<TextSpan> out) {
        int nextArg = 0;
        StringBuilder lit = new StringBuilder();
        for (int i = 0; i < template.length(); ) {
            char c = template.charAt(i);
            if (c == '%' && i + 1 < template.length()) {
                char n = template.charAt(i + 1);
                if (n == '%') {
                    lit.append('%'); i += 2; continue;
                }
                if (n == 's') {
                    if (!lit.isEmpty()) { appendSectionFormatted(lit.toString(), style, out); lit.setLength(0); }
                    if (nextArg < args.size()) out.addAll(args.get(nextArg));
                    nextArg++; i += 2; continue;
                }
                int j = i + 1;
                while (j < template.length() && template.charAt(j) >= '0' && template.charAt(j) <= '9') j++;
                if (j > i + 1 && j + 1 < template.length() && template.charAt(j) == '$' && template.charAt(j + 1) == 's') {
                    int idx = Integer.parseInt(template.substring(i + 1, j)) - 1;
                    if (!lit.isEmpty()) { appendSectionFormatted(lit.toString(), style, out); lit.setLength(0); }
                    if (idx >= 0 && idx < args.size()) out.addAll(args.get(idx));
                    i = j + 2; continue;
                }
            }
            lit.append(c); i++;
        }
        if (!lit.isEmpty()) appendSectionFormatted(lit.toString(), style, out);
    }

    /** 解释传统 § 格式码（颜色、粗体、斜体、下划线、删除线、重置），避免格式字母残留。 */
    private static void appendSectionFormatted(String text, Style base, List<TextSpan> out) {
        if (text == null || text.isEmpty()) return;
        if (text.indexOf('\u00A7') < 0) {
            out.add(new TextSpan(text, base.color, base.bold, base.italic, base.underlined, base.strikethrough, base.font));
            return;
        }
        Integer color = base.color;
        boolean bold = base.bold, italic = base.italic, underlined = base.underlined, strikethrough = base.strikethrough;
        String font = base.font;
        StringBuilder buf = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\u00A7' && i + 1 < text.length()) {
                char code = Character.toLowerCase(text.charAt(i + 1));
                int legacyColor = legacyCodeColor(code);
                boolean known = legacyColor >= 0 || code == 'l' || code == 'o' || code == 'n' || code == 'm' || code == 'k' || code == 'r';
                if (known) {
                    if (!buf.isEmpty()) {
                        out.add(new TextSpan(buf.toString(), color, bold, italic, underlined, strikethrough, font));
                        buf.setLength(0);
                    }
                    if (legacyColor >= 0) {
                        color = legacyColor;
                        bold = italic = underlined = strikethrough = false;
                    } else if (code == 'l') bold = true;
                    else if (code == 'o') italic = true;
                    else if (code == 'n') underlined = true;
                    else if (code == 'm') strikethrough = true;
                    else if (code == 'r') {
                        color = base.color;
                        bold = base.bold; italic = base.italic; underlined = base.underlined; strikethrough = base.strikethrough;
                    }
                    i++;
                    continue;
                }
            }
            buf.append(c);
        }
        if (!buf.isEmpty()) {
            out.add(new TextSpan(buf.toString(), color, bold, italic, underlined, strikethrough, font));
        }
    }

    private static Style mergeNbtStyle(NbtCompound c, Style parent) {
        Integer color = parent.color;
        if (c.contains("color")) {
            Integer parsed = parseTextColor(c.getStringOrDefault("color", ""));
            if (parsed != null) color = parsed;
        }
        boolean bold = c.contains("bold") ? c.getBooleanOrDefault("bold", false) : parent.bold;
        boolean italic = c.contains("italic") ? c.getBooleanOrDefault("italic", false) : parent.italic;
        boolean underlined = c.contains("underlined") ? c.getBooleanOrDefault("underlined", false) : parent.underlined;
        boolean strikethrough = c.contains("strikethrough") ? c.getBooleanOrDefault("strikethrough", false) : parent.strikethrough;
        String font = c.contains("font") ? c.getStringOrDefault("font", parent.font) : parent.font;
        return new Style(color, bold, italic, underlined, strikethrough, font);
    }

    private static Style mergeJsonStyle(Map<?, ?> m, Style parent) {
        Integer color = parent.color;
        if (m.get("color") instanceof String s) {
            Integer parsed = parseTextColor(s);
            if (parsed != null) color = parsed;
        }
        boolean bold = m.containsKey("bold") ? MiniJson.asBool(m.get("bold"), false) : parent.bold;
        boolean italic = m.containsKey("italic") ? MiniJson.asBool(m.get("italic"), false) : parent.italic;
        boolean underlined = m.containsKey("underlined") ? MiniJson.asBool(m.get("underlined"), false) : parent.underlined;
        boolean strikethrough = m.containsKey("strikethrough") ? MiniJson.asBool(m.get("strikethrough"), false) : parent.strikethrough;
        String font = m.get("font") instanceof String f && !f.isEmpty() ? f : parent.font;
        return new Style(color, bold, italic, underlined, strikethrough, font);
    }

    private static int legacyCodeColor(char code) {
        return switch (code) {
            case '0' -> 0x000000; case '1' -> 0x0000AA; case '2' -> 0x00AA00; case '3' -> 0x00AAAA;
            case '4' -> 0xAA0000; case '5' -> 0xAA00AA; case '6' -> 0xFFAA00; case '7' -> 0xAAAAAA;
            case '8' -> 0x555555; case '9' -> 0x5555FF; case 'a' -> 0x55FF55; case 'b' -> 0x55FFFF;
            case 'c' -> 0xFF5555; case 'd' -> 0xFF55FF; case 'e' -> 0xFFFF55; case 'f' -> 0xFFFFFF;
            default -> -1;
        };
    }

    public static Integer parseTextColor(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        String s = raw.trim().toLowerCase(Locale.ROOT);
        if (s.startsWith("#") && s.length() == 7) {
            try { return Integer.parseInt(s.substring(1), 16) & 0xFFFFFF; } catch (NumberFormatException ignored) { return null; }
        }
        return switch (s) {
            case "black" -> 0x000000; case "dark_blue" -> 0x0000AA; case "dark_green" -> 0x00AA00;
            case "dark_aqua" -> 0x00AAAA; case "dark_red" -> 0xAA0000; case "dark_purple" -> 0xAA00AA;
            case "gold" -> 0xFFAA00; case "gray" -> 0xAAAAAA; case "dark_gray" -> 0x555555;
            case "blue" -> 0x5555FF; case "green" -> 0x55FF55; case "aqua" -> 0x55FFFF;
            case "red" -> 0xFF5555; case "light_purple" -> 0xFF55FF; case "yellow" -> 0xFFFF55;
            case "white" -> 0xFFFFFF;
            default -> null;
        };
    }

    static int dyeColor(String name) {
        return switch (name) {
            case "white" -> 0xFFFFFF;
            case "orange" -> 0xFF681F;
            case "magenta" -> 0xFF00FF;
            case "light_blue" -> 0x9AC0CD;
            case "yellow" -> 0xFFFF00;
            case "lime" -> 0xBFFF00;
            case "pink" -> 0xFF69B4;
            case "gray" -> 0x808080;
            case "light_gray" -> 0xD3D3D3;
            case "cyan" -> 0x00FFFF;
            case "purple" -> 0xA020F0;
            case "blue" -> 0x0000FF;
            case "brown" -> 0x8B4513;
            case "green" -> 0x00FF00;
            case "red" -> 0xFF0000;
            case "black" -> 0x000000;
            default -> 0x000000;
        };
    }
}
