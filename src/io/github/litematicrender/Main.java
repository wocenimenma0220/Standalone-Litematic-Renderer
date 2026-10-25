package io.github.litematicrender;

import io.github.litematicrender.render.RenderSettings;
import io.github.litematicrender.render.CliRenderer;

import java.nio.file.Path;

/** 应用入口：命令行负责 PNG/GIF 导出，桌面界面通过逐行 JSON 协议调用 Java 引擎。 */
public final class Main {
    public static void main(String[] args) throws Exception {
        Path base = Path.of(System.getProperty("litematicrender.home", ".")).toAbsolutePath();
        Path vanilla = base.resolve("assets/vanilla");

        if (args.length > 0 && args[0].equals("--render")) {
            String[] rest = new String[args.length - 1];
            System.arraycopy(args, 1, rest, 0, rest.length);
            CliRenderer.main(buildCliArgs(rest, vanilla));
            return;
        }

        if (args.length > 0 && args[0].equals("--anim")) {
            if (args.length < 2) {
                System.err.println("usage: --anim <file.litematic> [out.gif] [size] [frames]");
                System.exit(2);
            }
            Path schem = Path.of(args[1]);
            Path out = Path.of(args.length > 2 ? args[2] : "animation.gif");
            int size = args.length > 3 ? Integer.parseInt(args[3]) : 512;
            int frames = args.length > 4 ? Integer.parseInt(args[4]) : RenderSettings.DEFAULT_ANIMATION_FRAMES;
            RenderSettings settings = new RenderSettings(45f, 30f, size, size);
            CliRenderer.renderAnimation(schem, vanilla, out, settings, frames, RenderSettings.DEFAULT_ANIMATION_DELAY_CS, true);
            return;
        }

        if (args.length > 0 && args[0].equals("--serve")) {
            io.github.litematicrender.serve.JsonRpcServer.main(new String[0]);
            return;
        }

        System.err.println("usage: --render <file.litematic> [out.png] [width] [height]");
        System.err.println("       --anim   <file.litematic> [out.gif] [size] [frames]");
        System.err.println("       --serve");
        System.exit(2);
    }

    private static String[] buildCliArgs(String[] rest, Path vanilla) {
        java.util.List<String> out = new java.util.ArrayList<>();
        out.add(rest.length > 0 ? rest[0] : "");
        out.add(vanilla.toString());
        out.add(rest.length > 1 ? rest[1] : "render.png");
        // 原样转发可选的宽、高、旋转角和俯仰角参数。
        for (int i = 2; i < rest.length; i++) out.add(rest[i]);
        return out.toArray(String[]::new);
    }
}
