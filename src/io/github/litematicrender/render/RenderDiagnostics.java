package io.github.litematicrender.render;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** 汇总无法解析的模型和贴图，并按原因及资源标识计数，避免缺失资源被静默隐藏。 */
public final class RenderDiagnostics {
    private static final Map<String, AtomicLong> COUNTS = new ConcurrentHashMap<>();

    private RenderDiagnostics() {}


    public static void note(String reason, String id) {
        COUNTS.computeIfAbsent(reason + " | " + id, k -> new AtomicLong()).incrementAndGet();
    }


    public static Map<String, Long> snapshot() {
        Map<String, Long> out = new LinkedHashMap<>();
        COUNTS.entrySet().stream()
            .sorted((a, b) -> Long.compare(b.getValue().get(), a.getValue().get()))
            .forEach(e -> out.put(e.getKey(), e.getValue().get()));
        return out;
    }

    public static long total() {
        return COUNTS.values().stream().mapToLong(AtomicLong::get).sum();
    }

    public static void reset() {
        COUNTS.clear();
    }


    public static boolean report(java.io.PrintStream out) {
        Map<String, Long> snap = snapshot();
        if (snap.isEmpty()) return true;
        out.println("!! unresolved render inputs (" + total() + " occurrences)");
        snap.forEach((k, v) -> out.println("   " + v + " x  " + k));
        return false;
    }
}
