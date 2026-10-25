package io.github.litematicrender.render;

import io.github.litematicrender.model.ModelBaker;
import io.github.litematicrender.resource.ResourceManager;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.world.BlockRegistry;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** 命令行渲染入口：加载资源、调用 SchematicRenderer 并报告耗时。 */
public final class CliRenderer {
    private CliRenderer() {}


    public record Result(Image image, int blockKinds, int spriteCount, int atlasWidth, int atlasHeight,
                         int solidQuads, int cutoutQuads, int translucentQuads, long loadMillis,
                         long atlasMillis, long sceneMillis, long rasterMillis) {}


    /** 命令行与桌面界面使用相同的资源叠加顺序：原版、内置包、用户资源包。 */
    public static ResourceManager openResources(Path vanillaRoot, Path home) throws IOException {
        ResourceManager res = new ResourceManager(vanillaRoot);
        io.github.litematicrender.resource.BuiltinPacks.list(home).forEach(res::importPackUnchecked);
        return res;
    }


    public static Result renderToFile(Path schemFile, Path vanillaRoot, Path outPng,
                                      RenderSettings settings, boolean verbose) throws Exception {


        Path home = vanillaRoot.getParent() != null && vanillaRoot.getParent().getParent() != null
            ? vanillaRoot.getParent().getParent()
            : vanillaRoot;
        return renderToFile(schemFile, vanillaRoot, home, outPng, settings, verbose);
    }


    public static Result renderToFile(Path schemFile, Path vanillaRoot, Path home, Path outPng,
                                      RenderSettings settings, boolean verbose) throws Exception {
        RenderDiagnostics.reset();
        long t0 = System.currentTimeMillis();
        LitematicaSchematic schem = LitematicaSchematic.load(schemFile);
        ResourceManager resources = openResources(vanillaRoot, home);
        try {
            BlockRegistry registry = BlockRegistry.load(resources);
            schem.materialize(registry);
            long t1 = System.currentTimeMillis();

            Colormaps colormaps = new Colormaps();
            colormaps.load(resources);
            SpriteAtlas atlas = SpriteAtlas.load(resources, "blocks");
            long t2 = System.currentTimeMillis();

            ModelBaker baker = new ModelBaker(resources, registry);

            long t3 = System.currentTimeMillis();
            Image image = SchematicRenderer.render(schem, baker, registry, colormaps, atlas, settings);
            long t4 = System.currentTimeMillis();

            if (outPng != null) {
                image.writePng(outPng);
            }

            if (verbose) {
                System.out.println("load: " + (t1 - t0) + "ms, block kinds=" + registry.blockCount());
                System.out.println("atlas: " + (t2 - t1) + "ms, sprites=" + atlas.spriteCount()
                    + " " + atlas.stitched.width + "x" + atlas.stitched.height);
                System.out.println("scene+raster: " + (t4 - t2) + "ms");
                if (outPng != null) System.out.println("written: " + outPng.toAbsolutePath());
                RenderDiagnostics.report(System.out);
            }
            return new Result(image, registry.blockCount(), atlas.spriteCount(),
                atlas.stitched.width, atlas.stitched.height, 0, 0, 0,
                t1 - t0, t2 - t1, t3 - t2, t4 - t3);
        } finally {
            resources.close();
        }
    }

    /** 导出一整周相机旋转，并同步推进动态贴图。 */
    public static void renderAnimation(Path schemFile, Path vanillaRoot, Path outGif,
                                       RenderSettings settings, int ticks, int delayCs,
                                       boolean verbose) throws Exception {
        RenderDiagnostics.reset();
        LitematicaSchematic schem = LitematicaSchematic.load(schemFile);
        Path home = vanillaRoot.getParent() != null && vanillaRoot.getParent().getParent() != null
            ? vanillaRoot.getParent().getParent() : vanillaRoot;
        ResourceManager resources = openResources(vanillaRoot, home);
        try {
            BlockRegistry registry = BlockRegistry.load(resources);
            schem.materialize(registry);
            Colormaps colormaps = new Colormaps();
            colormaps.load(resources);
            SpriteAtlas atlas = SpriteAtlas.load(resources, "blocks");
            ModelBaker baker = new ModelBaker(resources, registry);

            var mesh=SchematicRenderer.buildScene(schem,baker,registry,colormaps,atlas,settings.realLighting,settings.lightingEnabled);
            int frameCount=Math.max(2,Math.min(RenderSettings.MAX_ANIMATION_FRAMES,ticks));
            var camera=SchematicRenderer.fitRotationCamera(mesh,settings);
            if (verbose) {
                System.out.println("rotating animation: " + frameCount + " frames");
            }

            long t0 = System.currentTimeMillis();
            GifWriter.writeFrames(outGif,frameCount,delayCs,i -> {
                RenderSettings s = new RenderSettings(settings.rotationDeg+i*360f/frameCount, settings.slantDeg,
                    settings.width, settings.height);
                s.transparentBackground = settings.transparentBackground;
                s.backgroundColor = settings.backgroundColor;
                s.backgroundMode = settings.backgroundMode;
                s.backgroundImage = settings.backgroundImage;
                s.checkerSize = settings.checkerSize;
                s.ambientShadeScale = settings.ambientShadeScale;
                s.animationTick = settings.animationTick + (int)(i * (long)delayCs / 5);
                camera.rotationDeg=s.rotationDeg;
                camera.update();
                return SchematicRenderer.renderWithCamera(mesh,atlas,s,camera);
            });
            long t2 = System.currentTimeMillis();

            if (verbose) {
                System.out.println("rendered and encoded " + frameCount + " frames in " + (t2 - t0) + "ms");
                System.out.println("written: " + outGif.toAbsolutePath());
                RenderDiagnostics.report(System.out);
            }
        } finally {
            resources.close();
        }
    }

    /** Main 和启动器的命令行入口，位置参数包括投影、资源、输出、尺寸及视角。 */
    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("usage: CliRenderer <file.litematic> <assets/vanilla> <out.png> "
                + "[width] [height] [rotationDeg] [slantDeg]");
            System.exit(2);
        }
        int width = args.length > 3 ? Integer.parseInt(args[3]) : 1024;
        int height = args.length > 4 ? Integer.parseInt(args[4]) : 1024;
        float rotation = args.length > 5 ? Float.parseFloat(args[5]) : 45f;
        float slant = args.length > 6 ? Float.parseFloat(args[6]) : 30f;
        RenderSettings settings = new RenderSettings(rotation, slant, width, height);
        renderToFile(Path.of(args[0]), Path.of(args[1]), Path.of(args[2]), settings, true);
    }
}
