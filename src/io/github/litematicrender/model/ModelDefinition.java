package io.github.litematicrender.model;

import io.github.litematicrender.util.MiniJson;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 已解析的模型定义；父模型链由 ModelBaker 在外部处理。 */
public final class ModelDefinition {
    public record ElementRotation(float[] origin, String axis, float angle, boolean rescale) {}

    public record Face(Map<String, Object> raw) {
        /** UV 的最小值和最大值保留原始顺序，允许反向区间；排序会翻转侦测器等模型的纹理。 */
        public float[] uv() {
            Object u = raw.get("uv");
            if (u instanceof List<?> list && list.size() == 4) {
                return new float[]{
                    (float) MiniJson.asDouble(list.get(0), 0), (float) MiniJson.asDouble(list.get(1), 0),
                    (float) MiniJson.asDouble(list.get(2), 16), (float) MiniJson.asDouble(list.get(3), 16)};
            }
            return null;
        }

        /** 面内 UV 旋转角，只允许 0、90、180、270 度。 */
        public int rotationDegrees() {
            int r = MiniJson.asInt(raw.get("rotation"), 0);
            return ((r % 360) + 360) % 360;
        }

        /** 用顶点索引的循环偏移表示旋转。 */
        public int rotationShift() {
            return rotationDegrees() / 90;
        }

        public String texture() {
            return MiniJson.asString(raw.get("texture"), null);
        }

        public String cullface() {
            return MiniJson.asString(raw.get("cullface"), null);
        }

        public int tintindex() {
            return MiniJson.asInt(raw.get("tintindex"), -1);
        }


    }

    public record Element(float[] from, float[] to, Map<String, Face> faces,
                          ElementRotation rotation, String shadeDirectionOverride, int lightEmission) {}

    public final String location;
    public final String parent;
    public final Map<String, String> textures;
    /** 贴图引用声明的强制半透明槽位，可覆盖贴图像素本身的透明分类。 */
    public final java.util.Set<String> forceTranslucentSlots;
    public final List<Element> elements;
    public final Boolean ambientOcclusion;
    public final Map<String, Object> raw;

    private ModelDefinition(String location, String parent, Map<String, String> textures,
                            java.util.Set<String> forceTranslucentSlots,
                            List<Element> elements, Boolean ambientOcclusion, Map<String, Object> raw) {
        this.location = location;
        this.parent = parent;
        this.textures = textures;
        this.forceTranslucentSlots = forceTranslucentSlots;
        this.elements = elements;
        this.ambientOcclusion = ambientOcclusion;
        this.raw = raw;
    }

    public static ModelDefinition parse(String location, Map<String, Object> json) {
        String parent = MiniJson.asString(json.get("parent"), null);
        Map<String, String> textures = new LinkedHashMap<>();
        java.util.Set<String> forceTranslucent = new java.util.LinkedHashSet<>();
        Map<String, Object> texObj = MiniJson.asObject(json.get("textures"));
        if (texObj != null) {
            for (Map.Entry<String, Object> e : texObj.entrySet()) {
                textures.put(e.getKey(), textureRefString(e.getValue()));
                if (textureRefForcesTranslucent(e.getValue())) {
                    forceTranslucent.add(e.getKey());
                }
            }
        }
        List<Element> elements = null;
        List<Object> elemsArr = MiniJson.asArray(json.get("elements"));
        if (elemsArr != null) {
            elements = new ArrayList<>(elemsArr.size());
            for (Object o : elemsArr) {
                Map<String, Object> em = MiniJson.asObject(o);
                if (em == null) continue;
                elements.add(parseElement(em));
            }
        }
        Boolean ao = json.containsKey("ambientocclusion") ? MiniJson.asBool(json.get("ambientocclusion"), true) : null;
        return new ModelDefinition(location, parent, textures, forceTranslucent, elements, ao, json);
    }


    private static boolean textureRefForcesTranslucent(Object v) {
        if (v instanceof Map<?, ?> m) {
            Object f = m.get("force_translucent");
            if (f instanceof Boolean b) return b;
            return MiniJson.asBool(f, false);
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    /** 兼容旧版字符串贴图引用和 26.x 的对象形式，后者可携带 force_translucent。 */
    private static String textureRefString(Object v) {
        if (v instanceof String s) return s;
        if (v instanceof Map<?, ?> m) {
            Object sprite = m.get("sprite");
            return sprite instanceof String s2 ? s2 : "";
        }
        return "";
    }

    private static Element parseElement(Map<String, Object> em) {
        float[] from = readVec(em.get("from"), new float[]{0, 0, 0});
        float[] to = readVec(em.get("to"), new float[]{16, 16, 16});
        Map<String, Face> faces = new LinkedHashMap<>();
        Map<String, Object> facesObj = MiniJson.asObject(em.get("faces"));
        if (facesObj != null) {
            for (Map.Entry<String, Object> e : facesObj.entrySet()) {
                Object v = e.getValue();
                if (v instanceof Map) {
                    faces.put(e.getKey(), new Face((Map<String, Object>) v));
                } else if (v instanceof String s) {

                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("texture", s);
                    faces.put(e.getKey(), new Face(m));
                }
            }
        }
        ElementRotation rotation = null;
        Map<String, Object> rotObj = MiniJson.asObject(em.get("rotation"));
        if (rotObj != null) {
            float[] origin = readVec(rotObj.get("origin"), new float[]{8, 8, 8});
            String axis = MiniJson.asString(rotObj.get("axis"), "y");
            float angle = (float) MiniJson.asDouble(rotObj.get("angle"), 0);
            boolean rescale = MiniJson.asBool(rotObj.get("rescale"), false);
            rotation = new ElementRotation(origin, axis, angle, rescale);
        }
        String shadeOverride = MiniJson.asString(em.get("shade_direction_override"), null);
        int lightEmission = MiniJson.asInt(em.get("light_emission"), 0);
        return new Element(from, to, faces, rotation, shadeOverride, lightEmission);
    }

    private static float[] readVec(Object o, float[] def) {
        if (o instanceof List<?> list && list.size() >= 3) {
            return new float[]{
                (float) MiniJson.asDouble(list.get(0), 0),
                (float) MiniJson.asDouble(list.get(1), 0),
                (float) MiniJson.asDouble(list.get(2), 0)};
        }
        return def;
    }
}
