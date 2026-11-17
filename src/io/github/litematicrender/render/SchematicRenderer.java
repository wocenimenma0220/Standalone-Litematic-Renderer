package io.github.litematicrender.render;

import io.github.litematicrender.model.ModelBaker;
import io.github.litematicrender.render.raster.Camera;
import io.github.litematicrender.render.raster.Rasterizer;
import io.github.litematicrender.render.scene.SceneBuilder;
import io.github.litematicrender.render.scene.SceneMesh;
import io.github.litematicrender.schematic.LitematicaSchematic;
import io.github.litematicrender.world.BlockRegistry;

import java.awt.image.BufferedImage;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

/** 投影渲染流程：构建场景、适配相机、光栅化输出。 */
public final class SchematicRenderer {
    private static final int STREAM_THRESHOLD_EDGE = 4096;
    private static final long STREAM_THRESHOLD_PIXELS = 16_777_216L;
    private static final int DEFAULT_BAND_PIXELS = 4_194_304;
    private static final int BAND_CHUNK = 64;
    private static final int RASTER_WORKERS = Math.max(1, Math.min(8, Runtime.getRuntime().availableProcessors()));
    private static final AtomicInteger WORKER_SEQ = new AtomicInteger();
    private static final ExecutorService RASTER_POOL = RASTER_WORKERS <= 1 ? null : Executors.newFixedThreadPool(
        RASTER_WORKERS, task -> Thread.ofPlatform().name("raster-worker-" + WORKER_SEQ.incrementAndGet()).daemon(true).unstarted(task));

    private SchematicRenderer() {}

    /** 相机变化复用已经构建的场景，避免重复遍历方块和计算光照。 */
    public static Image render(LitematicaSchematic schematic, SceneMesh mesh,
                               Colormaps colormaps, SpriteAtlas atlas, RenderSettings settings) {
        int[] outSize = resolveOutputSize(mesh, atlas, settings);
        Camera cam = fittedCamera(mesh, settings, outSize[0], outSize[1]);
        return renderWithCameraForSize(mesh, atlas, settings, cam, outSize[0], outSize[1]);
    }

    /** 统一处理 PNG 导出：常规尺寸直接内存渲染；超清/无损大图采用分带流式渲染并直写 PNG，避免内存溢出。 */
    public static int[] renderToPng(SceneMesh mesh, SpriteAtlas atlas, RenderSettings settings,
                                    Path outPng, GifWriter.Progress progress) throws Exception {
        checkCancelled(settings);
        int[] outSize = resolveOutputSize(mesh, atlas, settings);
        int width = outSize[0], height = outSize[1];
        Camera cam = fittedCamera(mesh, settings, width, height);
        boolean stream = width > STREAM_THRESHOLD_EDGE || height > STREAM_THRESHOLD_EDGE
            || (long) width * height > STREAM_THRESHOLD_PIXELS;
        if (!stream) {
            if (progress != null) progress.update("rendering", 0, 1);
            Image image = renderWithCameraForSize(mesh, atlas, settings, cam, width, height);
            checkCancelled(settings);
            if (progress != null) progress.update("rendering", 1, 1);
            if (progress != null) progress.update("encoding", 0, 1);
            image.writePng(outPng);
            if (progress != null) progress.update("encoding", 1, 1);
            return outSize;
        }
        renderStreamingPng(mesh, atlas, settings, cam, width, height, outPng, DEFAULT_BAND_PIXELS, progress);
        return outSize;
    }

    /** 自动计算导出尺寸：关闭无损时校验并返回用户宽高；开启无损时按贴图密度计算清晰范围内的最大尺寸。 */
    public static int[] resolveOutputSize(SceneMesh mesh, SpriteAtlas atlas, RenderSettings settings) {
        if (!settings.lossless) {
            if (settings.width < 1 || settings.height < 1
                    || settings.width > RenderSettings.MAX_EXPORT_EDGE
                    || settings.height > RenderSettings.MAX_EXPORT_EDGE) {
                throw new IllegalArgumentException("导出分辨率超出支持范围 (1～" + RenderSettings.MAX_EXPORT_EDGE + ")");
            }
            return new int[]{settings.width, settings.height};
        }
        Camera probe = new Camera();
        probe.rotationDeg = settings.rotationDeg;
        probe.slantDeg = settings.slantDeg;
        double[] spans = viewSpansForCamera(probe, mesh);
        if (spans == null) {
            return new int[]{1024, 1024};
        }
        SceneMesh densitySource = settings.selectionMesh != null ? settings.selectionMesh : mesh;
        double maxTexelsPerUnit = computeMaxTexelsPerUnit(densitySource, atlas);
        double previewZoom = Math.max(0.05, Math.min(20.0, settings.previewZoom));
        double targetPxPerUnit = 4.0 * maxTexelsPerUnit * previewZoom;
        double rawW = Math.max(1.0, spans[4] * targetPxPerUnit / 0.92);
        double rawH = Math.max(1.0, spans[5] * targetPxPerUnit / 0.92);

        double maxEdge = Math.max(rawW, rawH);
        if (maxEdge < 512.0) {
            double up = 512.0 / maxEdge;
            rawW *= up;
            rawH *= up;
        }
        maxEdge = Math.max(rawW, rawH);
        if (maxEdge > RenderSettings.MAX_EXPORT_EDGE) {
            double down = (double) RenderSettings.MAX_EXPORT_EDGE / maxEdge;
            rawW *= down;
            rawH *= down;
        }
        int outW = Math.max(1, Math.min(RenderSettings.MAX_EXPORT_EDGE, (int) Math.ceil(rawW)));
        int outH = Math.max(1, Math.min(RenderSettings.MAX_EXPORT_EDGE, (int) Math.ceil(rawH)));
        return new int[]{outW, outH};
    }

    private static Camera fittedCamera(SceneMesh mesh, RenderSettings settings, int width, int height) {
        Camera cam = new Camera();
        cam.rotationDeg = settings.rotationDeg;
        cam.slantDeg = settings.slantDeg;
        fitCameraToMesh(cam, mesh, width, height);
        cam.zoom *= settings.previewZoom;
        cam.offsetX *= settings.previewZoom;
        cam.offsetY *= settings.previewZoom;
        cam.update();
        return cam;
    }

    private static double computeMaxTexelsPerUnit(SceneMesh mesh, SpriteAtlas atlas) {
        double maxDensity = 16.0;
        for (var layer : List.of(mesh.solid, mesh.cutout, mesh.translucent, mesh.portal, mesh.fluid)) {
            for (SceneMesh.MeshQuad q : layer) {
                if (q.decorativeEffect() || q.image != null || q.spriteId == null) continue;
                var opt = atlas.get(q.spriteId);
                if (opt.isEmpty()) continue;
                var contents = opt.get().contents;
                int fw = contents.frameWidth, fh = contents.frameHeight;
                maxDensity = Math.max(maxDensity, quadEdgeDensity(q.x0, q.y0, q.z0, q.x1, q.y1, q.z1, q.u0, q.v0, q.u1, q.v1, fw, fh));
                maxDensity = Math.max(maxDensity, quadEdgeDensity(q.x1, q.y1, q.z1, q.x2, q.y2, q.z2, q.u1, q.v1, q.u2, q.v2, fw, fh));
                maxDensity = Math.max(maxDensity, quadEdgeDensity(q.x2, q.y2, q.z2, q.x3, q.y3, q.z3, q.u2, q.v2, q.u3, q.v3, fw, fh));
                maxDensity = Math.max(maxDensity, quadEdgeDensity(q.x3, q.y3, q.z3, q.x0, q.y0, q.z0, q.u3, q.v3, q.u0, q.v0, fw, fh));
            }
        }
        return maxDensity;
    }

    private static double quadEdgeDensity(double ax, double ay, double az, double bx, double by, double bz,
                                          double u0, double v0, double u1, double v1, int fw, int fh) {
        double dx = bx - ax, dy = by - ay, dz = bz - az;
        double worldLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (worldLen < 0.03125) return 0.0;
        double texLen = Math.hypot((u1 - u0) * fw, (v1 - v0) * fh);
        if (texLen < 0.5) return 0.0;
        return Math.min(2048.0, texLen / worldLen);
    }

    public static Image render(LitematicaSchematic schematic,
                               ModelBaker baker,
                               BlockRegistry registry,
                               Colormaps colormaps,
                               SpriteAtlas atlas,
                               RenderSettings settings) {
        return render(schematic,buildScene(schematic,baker,registry,colormaps,atlas,settings.realLighting,settings.lightingEnabled),colormaps,atlas,settings);
    }

    public static SceneMesh buildScene(LitematicaSchematic schematic, ModelBaker baker,
                                      BlockRegistry registry, Colormaps colormaps, SpriteAtlas atlas) {
        return buildScene(schematic,baker,registry,colormaps,atlas,false);
    }

    public static SceneMesh buildScene(LitematicaSchematic schematic, ModelBaker baker,
                                      BlockRegistry registry, Colormaps colormaps, SpriteAtlas atlas, boolean realLighting) {
        return buildScene(schematic,baker,registry,colormaps,atlas,realLighting,true);
    }
    public static SceneMesh buildScene(LitematicaSchematic schematic,ModelBaker baker,BlockRegistry registry,Colormaps colormaps,SpriteAtlas atlas,boolean realLighting,boolean lightingEnabled) {
        SceneBuilder builder = new SceneBuilder(registry, baker, colormaps, atlas).realLighting(realLighting).lightingEnabled(lightingEnabled);
        for (var e : schematic.regions().entrySet()) {
            var r = e.getValue();
            var origin=r.blockOrigin();builder.addRegion(r, new int[]{origin.x(),origin.y(),origin.z()});
        }
        return builder.build();
    }

    /** 拖动过程中降低预览分辨率，使交互能够及时反馈。 */
    public static RenderSettings interactiveScale(RenderSettings settings, int maxEdge) {
        if (maxEdge <= 0) return settings;
        int edge = Math.max(settings.width, settings.height);
        if (edge <= maxEdge) return settings;
        double f = (double) maxEdge / edge;
        RenderSettings s = new RenderSettings(settings.rotationDeg, settings.slantDeg,
            Math.max(1, (int) Math.round(settings.width * f)),
            Math.max(1, (int) Math.round(settings.height * f)));
        s.transparentBackground = settings.transparentBackground;
        s.backgroundColor = settings.backgroundColor;
        s.backgroundMode = settings.backgroundMode;
        s.backgroundImage = settings.backgroundImage;
        s.checkerSize = settings.checkerSize;
        s.ambientShadeScale = settings.ambientShadeScale;
        s.realLighting = settings.realLighting;
        s.lightingEnabled = settings.lightingEnabled;
        s.previewZoom = settings.previewZoom;
        s.selectionMin=settings.selectionMin;s.selectionMax=settings.selectionMax;
        s.selectionMesh=settings.selectionMesh;
        s.animationTick = settings.animationTick;
        s.cancelSignal = settings.cancelSignal;
        return s;
    }

    private static void checkCancelled(RenderSettings settings) {
        if ((settings.cancelSignal != null && settings.cancelSignal.getAsBoolean())
                || Thread.currentThread().isInterrupted()) {
            throw new java.util.concurrent.CancellationException("渲染已取消");
        }
    }

    /** 使用已适配的相机渲染，不改变中心、缩放或偏移。 */
    public static Image renderWithCamera(SceneMesh mesh, SpriteAtlas atlas,
                                         RenderSettings settings, Camera cam) {
        return renderWithCameraForSize(mesh, atlas, settings, cam, settings.width, settings.height);
    }

    private static Image renderWithCameraForSize(SceneMesh mesh, SpriteAtlas atlas,
                                                 RenderSettings settings, Camera cam, int width, int height) {
        checkCancelled(settings);
        // 动态纹理只更新图集像素，网格和 UV 保持不变。

        atlas.rebakeAtTick(settings.animationTick);
        SceneMesh foreground = settings.selectionMesh != null ? settings.selectionMesh : mesh;
        List<SceneMesh.MeshQuad> orderedTranslucent = orderedTranslucentQuads(foreground, cam);
        List<SceneMesh.MeshQuad> ghosts = settings.selectionMin != null ? sortedGhosts(mesh, cam) : null;

        int stripCount = RASTER_POOL == null || (long) width * height < 65_536L || height < 64
            ? 1 : Math.min(RASTER_WORKERS, Math.max(1, height / 32));
        if (stripCount <= 1) {
            Rasterizer raster = new Rasterizer(width, height, cam, atlas);
            raster.clear(RenderBackground.isTransparent(settings) ? 0 : (settings.backgroundColor | 0xFF000000));
            RenderBackground.fill(raster.color, settings);
            raster.selectionMin = settings.selectionMin; raster.selectionMax = settings.selectionMax;
            raster.selectionPass = settings.selectionMin == null ? 0 : 1;

            int n = 0;
            for (SceneMesh.MeshQuad q : foreground.solid) { if ((++n & 1023) == 0) checkCancelled(settings); draw(raster, q, settings, false); }
            checkCancelled(settings);
            for (SceneMesh.MeshQuad q : foreground.cutout) { if ((++n & 1023) == 0) checkCancelled(settings); draw(raster, q, settings, false); }
            raster.writeColor = false;
            for (SceneMesh.MeshQuad q : foreground.waterMask) draw(raster, q, settings, false);
            raster.writeColor = true;
            checkCancelled(settings);
            drawSorted(raster, orderedTranslucent, settings);
            if (ghosts != null) {
                checkCancelled(settings);
                raster.selectionPass = 2;
                drawSorted(raster, ghosts, settings);
            }
            return raster.color;
        }

        int bandH = (height + stripCount - 1) / stripCount;
        Rasterizer probe = new Rasterizer(width, height, 0, 0, 1, 1, cam, atlas);
        BandPass solidPass = buildBandPass(foreground.solid, probe, bandH, stripCount, settings);
        BandPass cutoutPass = buildBandPass(foreground.cutout, probe, bandH, stripCount, settings);
        BandPass waterMaskPass = buildBandPass(foreground.waterMask, probe, bandH, stripCount, settings);
        BandPass translucentPass = buildBandPass(orderedTranslucent, probe, bandH, stripCount, settings);
        BandPass ghostPass = ghosts != null ? buildBandPass(ghosts, probe, bandH, stripCount, settings) : null;

        int clearArgb = RenderBackground.isTransparent(settings) ? 0 : (settings.backgroundColor | 0xFF000000);
        int baseSelectionPass = settings.selectionMin == null ? 0 : 1;
        Image output = new Image(width, height);
        List<Future<?>> futures = new ArrayList<>(stripCount);
        try {
            for (int b = 0; b < stripCount; b++) {
                final int bandIdx = b;
                final int bandY = b * bandH;
                final int activeH = Math.min(bandH, height - bandY);
                if (activeH <= 0) break;
                futures.add(RASTER_POOL.submit(() -> {
                    checkCancelled(settings);
                    Rasterizer raster = new Rasterizer(width, height, 0, bandY, width, activeH, cam, atlas);
                    raster.selectionMin = settings.selectionMin;
                    raster.selectionMax = settings.selectionMax;
                    raster.clear(clearArgb);
                    RenderBackground.fillRegion(raster.color, width, height, 0, bandY, activeH, settings, null, null);

                    raster.selectionPass = baseSelectionPass;
                    raster.writeColor = true;
                    drawBandPass(raster, solidPass, bandIdx, settings, false);
                    drawBandPass(raster, cutoutPass, bandIdx, settings, false);
                    raster.writeColor = false;
                    drawBandPass(raster, waterMaskPass, bandIdx, settings, false);
                    raster.writeColor = true;
                    drawBandPass(raster, translucentPass, bandIdx, settings, true);
                    if (ghostPass != null) {
                        raster.selectionPass = 2;
                        drawBandPass(raster, ghostPass, bandIdx, settings, true);
                    }
                    System.arraycopy(raster.color.pixels(), 0, output.pixels(), bandY * width, activeH * width);
                }));
            }
            for (Future<?> f : futures) {
                try {
                    f.get();
                } catch (ExecutionException e) {
                    Throwable cause = e.getCause();
                    if (cause instanceof RuntimeException re) throw re;
                    if (cause instanceof Error err) throw err;
                    throw new RuntimeException(cause);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new java.util.concurrent.CancellationException("渲染已取消");
                }
            }
            return output;
        } finally {
            for (Future<?> f : futures) f.cancel(true);
        }
    }

    private static double[] towardEyeVector(Camera cam) {
        double[] origin=new double[3],point=new double[3],towardEye=new double[3];cam.toView(0,0,0,origin);
        for(int axis=0;axis<3;axis++){cam.toView(axis==0?1:0,axis==1?1:0,axis==2?1:0,point);towardEye[axis]=point[2]-origin[2];}
        return towardEye;
    }

    private static List<SceneMesh.MeshQuad> sortedBlended(SceneMesh foreground, Camera cam) {
        List<SceneMesh.MeshQuad> blended = new ArrayList<>(foreground.portalSorted);
        blended.addAll(foreground.fluidSorted);
        blended.addAll(foreground.translucentSorted);
        blended.sort(Comparator.comparingDouble(q -> cam.viewDepth(q.cx, q.cy, q.cz)));
        return blended;
    }

    private static List<SceneMesh.MeshQuad> sortedGhosts(SceneMesh mesh, Camera cam) {
        var ghosts = new ArrayList<SceneMesh.MeshQuad>(mesh.solid);
        ghosts.addAll(mesh.cutout);
        if (mesh.translucentBsp != null) ghosts.addAll(mesh.translucentBsp.faces);
        else { ghosts.addAll(mesh.portalSorted); ghosts.addAll(mesh.fluidSorted); ghosts.addAll(mesh.translucentSorted); }
        ghosts.sort(Comparator.comparingDouble(q -> cam.viewDepth(q.cx, q.cy, q.cz)));
        return ghosts;
    }

    private static List<SceneMesh.MeshQuad> orderedTranslucentQuads(SceneMesh foreground, Camera cam) {
        if (foreground.translucentBsp != null) {
            List<SceneMesh.MeshQuad> out = new ArrayList<>();
            foreground.translucentBsp.visit(towardEyeVector(cam), true, out::add);
            return out;
        }
        return sortedBlended(foreground, cam);
    }

    private static final class BandPass {
        final SceneMesh.MeshQuad[] quads;
        final int[] minBand, maxBand, chunkMin, chunkMax;
        BandPass(SceneMesh.MeshQuad[] quads, int[] minBand, int[] maxBand, int[] chunkMin, int[] chunkMax) {
            this.quads = quads; this.minBand = minBand; this.maxBand = maxBand;
            this.chunkMin = chunkMin; this.chunkMax = chunkMax;
        }
    }

    private static BandPass buildBandPass(List<SceneMesh.MeshQuad> source, Rasterizer probe,
                                          int bandH, int bandCount, RenderSettings settings) {
        if (source.isEmpty()) return new BandPass(new SceneMesh.MeshQuad[0], new int[0], new int[0], new int[0], new int[0]);
        SceneMesh.MeshQuad[] qBuf = new SceneMesh.MeshQuad[Math.min(source.size(), 256)];
        int[] minBuf = new int[qBuf.length], maxBuf = new int[qBuf.length];
        int count = 0, seen = 0;
        int[] range = new int[2];
        for (SceneMesh.MeshQuad q : source) {
            if ((++seen & 4095) == 0) checkCancelled(settings);
            if (!probe.projectBandRange(q, bandH, bandCount, range)) continue;
            if (count == qBuf.length) {
                int next = Math.max(qBuf.length * 2, count + 256);
                qBuf = Arrays.copyOf(qBuf, next);
                minBuf = Arrays.copyOf(minBuf, next);
                maxBuf = Arrays.copyOf(maxBuf, next);
            }
            qBuf[count] = q; minBuf[count] = range[0]; maxBuf[count] = range[1];
            count++;
        }
        SceneMesh.MeshQuad[] quads = Arrays.copyOf(qBuf, count);
        int[] minB = Arrays.copyOf(minBuf, count), maxB = Arrays.copyOf(maxBuf, count);
        int chunks = (count + BAND_CHUNK - 1) / BAND_CHUNK;
        int[] cMin = new int[chunks], cMax = new int[chunks];
        for (int c = 0; c < chunks; c++) {
            int s = c * BAND_CHUNK, e = Math.min(count, s + BAND_CHUNK);
            int lo = Integer.MAX_VALUE, hi = Integer.MIN_VALUE;
            for (int i = s; i < e; i++) { lo = Math.min(lo, minB[i]); hi = Math.max(hi, maxB[i]); }
            cMin[c] = lo; cMax[c] = hi;
        }
        return new BandPass(quads, minB, maxB, cMin, cMax);
    }

    private static void drawBandPass(Rasterizer raster, BandPass pass, int bandIdx,
                                     RenderSettings settings, boolean translucent) {
        int total = pass.quads.length;
        if (total == 0) return;
        int n = 0;
        for (int c = 0; c < pass.chunkMin.length; c++) {
            if (pass.chunkMax[c] < bandIdx || pass.chunkMin[c] > bandIdx) continue;
            int s = c * BAND_CHUNK, e = Math.min(total, s + BAND_CHUNK);
            for (int i = s; i < e; i++) {
                if (pass.maxBand[i] < bandIdx || pass.minBand[i] > bandIdx) continue;
                if ((++n & 1023) == 0) checkCancelled(settings);
                draw(raster, pass.quads[i], settings, translucent);
            }
        }
    }

    /** 按水平条带分段光栅化并流式写盘，用于 8192～81920 及无损超高分辨率 PNG 导出。 */
    public static void renderStreamingPng(SceneMesh mesh, SpriteAtlas atlas, RenderSettings settings,
                                          Camera cam, int width, int height, Path outPng,
                                          int maxBandPixels, GifWriter.Progress progress) throws Exception {
        checkCancelled(settings);
        atlas.rebakeAtTick(settings.animationTick);
        int bandH = Math.max(1, Math.min(height, Math.min(512, Math.max(1, maxBandPixels / Math.max(1, width)))));
        int bandCount = (height + bandH - 1) / bandH;

        SceneMesh foreground = settings.selectionMesh != null ? settings.selectionMesh : mesh;
        Rasterizer probe = new Rasterizer(width, height, 0, 0, 1, 1, cam, atlas);
        BandPass solidPass = buildBandPass(foreground.solid, probe, bandH, bandCount, settings);
        BandPass cutoutPass = buildBandPass(foreground.cutout, probe, bandH, bandCount, settings);
        BandPass waterMaskPass = buildBandPass(foreground.waterMask, probe, bandH, bandCount, settings);
        BandPass translucentPass = buildBandPass(orderedTranslucentQuads(foreground, cam), probe, bandH, bandCount, settings);
        BandPass ghostPass = settings.selectionMin != null
            ? buildBandPass(sortedGhosts(mesh, cam), probe, bandH, bandCount, settings)
            : null;

        int baseSelectionPass = settings.selectionMin == null ? 0 : 1;
        int clearArgb = RenderBackground.isTransparent(settings) ? 0 : (settings.backgroundColor | 0xFF000000);
        long lastReportNs = 0;

        try (StreamingPngWriter png = new StreamingPngWriter(outPng, width, height)) {
            if (progress != null) progress.update("rendering", 0, bandCount);
            if (RASTER_POOL == null || bandCount <= 1) {
                Rasterizer raster = new Rasterizer(width, height, 0, 0, width, bandH, cam, atlas);
                raster.selectionMin = settings.selectionMin;
                raster.selectionMax = settings.selectionMax;
                BufferedImage preparedBg = RenderBackground.prepareSource(settings);
                BufferedImage[] bgScratch = new BufferedImage[1];
                for (int b = 0; b < bandCount; b++) {
                    checkCancelled(settings);
                    int bandY = b * bandH;
                    int activeH = Math.min(bandH, height - bandY);
                    raster.reposition(0, bandY, activeH);
                    raster.clear(clearArgb);
                    RenderBackground.fillRegion(raster.color, width, height, 0, bandY, activeH, settings, preparedBg, bgScratch);

                    raster.selectionPass = baseSelectionPass;
                    raster.writeColor = true;
                    drawBandPass(raster, solidPass, b, settings, false);
                    drawBandPass(raster, cutoutPass, b, settings, false);
                    raster.writeColor = false;
                    drawBandPass(raster, waterMaskPass, b, settings, false);
                    raster.writeColor = true;
                    drawBandPass(raster, translucentPass, b, settings, true);
                    if (ghostPass != null) {
                        raster.selectionPass = 2;
                        drawBandPass(raster, ghostPass, b, settings, true);
                    }

                    png.writeRows(raster.color.pixels(), activeH);
                    long now = System.nanoTime();
                    if (progress != null && (b + 1 == bandCount || now - lastReportNs >= 200_000_000L)) {
                        lastReportNs = now;
                        progress.update("rendering", b + 1, bandCount);
                    }
                }
            } else {
                int inFlightLimit = Math.min(bandCount, Math.min(RASTER_WORKERS, 4));
                var pending = new java.util.ArrayDeque<Future<int[]>>(inFlightLimit);
                ThreadLocal<BufferedImage> localBg = ThreadLocal.withInitial(() -> RenderBackground.prepareSource(settings));
                int nextSubmit = 0;
                try {
                    for (int b = 0; b < bandCount; b++) {
                        while (nextSubmit < bandCount && pending.size() < inFlightLimit) {
                            final int submitIdx = nextSubmit++;
                            final int submitY = submitIdx * bandH;
                            final int submitH = Math.min(bandH, height - submitY);
                            pending.addLast(RASTER_POOL.submit(() -> {
                                checkCancelled(settings);
                                Rasterizer bandRaster = new Rasterizer(width, height, 0, submitY, width, submitH, cam, atlas);
                                bandRaster.selectionMin = settings.selectionMin;
                                bandRaster.selectionMax = settings.selectionMax;
                                bandRaster.clear(clearArgb);
                                RenderBackground.fillRegion(bandRaster.color, width, height, 0, submitY, submitH, settings, localBg.get(), null);
                                bandRaster.selectionPass = baseSelectionPass;
                                bandRaster.writeColor = true;
                                drawBandPass(bandRaster, solidPass, submitIdx, settings, false);
                                drawBandPass(bandRaster, cutoutPass, submitIdx, settings, false);
                                bandRaster.writeColor = false;
                                drawBandPass(bandRaster, waterMaskPass, submitIdx, settings, false);
                                bandRaster.writeColor = true;
                                drawBandPass(bandRaster, translucentPass, submitIdx, settings, true);
                                if (ghostPass != null) {
                                    bandRaster.selectionPass = 2;
                                    drawBandPass(bandRaster, ghostPass, submitIdx, settings, true);
                                }
                                return bandRaster.color.pixels();
                            }));
                        }
                        checkCancelled(settings);
                        int activeH = Math.min(bandH, height - b * bandH);
                        int[] pixels;
                        try {
                            pixels = pending.removeFirst().get();
                        } catch (ExecutionException e) {
                            Throwable cause = e.getCause();
                            if (cause instanceof RuntimeException re) throw re;
                            if (cause instanceof Error err) throw err;
                            throw new RuntimeException(cause);
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                            throw new java.util.concurrent.CancellationException("渲染已取消");
                        }
                        png.writeRows(pixels, activeH);
                        long now = System.nanoTime();
                        if (progress != null && (b + 1 == bandCount || now - lastReportNs >= 200_000_000L)) {
                            lastReportNs = now;
                            progress.update("rendering", b + 1, bandCount);
                        }
                    }
                } finally {
                    for (Future<int[]> f : pending) f.cancel(true);
                }
            }
            checkCancelled(settings);
            if (progress != null) progress.update("encoding", 1, 1);
            png.finish();
        }
    }

    /** 半透明面已在构建时细分，这里只按相机重排副本，防止污染缓存场景。 */
    private static void drawSorted(Rasterizer raster, List<SceneMesh.MeshQuad> quads, RenderSettings settings) {
        if (quads.isEmpty()) return;
        int n = 0;
        for (SceneMesh.MeshQuad q : quads) {
            if ((++n & 1023) == 0) checkCancelled(settings);
            draw(raster, q, settings, true);
        }
    }

    private static void draw(Rasterizer r, SceneMesh.MeshQuad q, RenderSettings s, boolean translucent) {
        int[] colors=q.vertexColors;
        if(colors!=null&&s.ambientShadeScale!=1){colors=colors.clone();for(int i=0;i<4;i++){int value=0;for(int shift=0;shift<=16;shift+=8)value|=Math.round(Math.max(0,Math.min(255,((colors[i]>>shift)&255)*s.ambientShadeScale)))<<shift;colors[i]=value;}}
        r.drawQuad(q.x0, q.y0, q.z0, q.x1, q.y1, q.z1, q.x2, q.y2, q.z2, q.x3, q.y3, q.z3,
            q.u0, q.v0, q.u1, q.v1, q.u2, q.v2, q.u3, q.v3,
            q.spriteId, q.rgb, q.image, q.tintR, q.tintG, q.tintB,
            q.shade * s.ambientShadeScale, q.ao, translucent, q.doubleSided, colors);
    }

    /** 一次适配整周旋转，保持相机中心和正交缩放固定。 */
    public static Camera fitRotationCamera(SceneMesh mesh, RenderSettings settings) {
        Camera cam = new Camera();
        cam.rotationDeg = settings.rotationDeg;
        cam.slantDeg = settings.slantDeg;
        double[] bounds = meshBounds(mesh);
        if (bounds != null) {
            cam.centerX = (bounds[0] + bounds[3]) / 2;
            cam.centerY = (bounds[1] + bounds[4]) / 2;
            cam.centerZ = (bounds[2] + bounds[5]) / 2;
            double radius = 0;
            for (var layer : List.of(mesh.solid, mesh.cutout, mesh.translucent, mesh.portal, mesh.fluid)) {
                for (var q : layer) {
                    if (q.decorativeEffect()) continue;
                    radius = Math.max(radius, Math.hypot(q.x0 - cam.centerX, q.z0 - cam.centerZ));
                    radius = Math.max(radius, Math.hypot(q.x1 - cam.centerX, q.z1 - cam.centerZ));
                    radius = Math.max(radius, Math.hypot(q.x2 - cam.centerX, q.z2 - cam.centerZ));
                    radius = Math.max(radius, Math.hypot(q.x3 - cam.centerX, q.z3 - cam.centerZ));
                }
            }
            double pitch = Math.toRadians(cam.slantDeg);
            double halfHeight = (bounds[4] - bounds[1]) / 2;
            double spanX = Math.max(1e-3, 2 * radius);
            double spanY = Math.max(1e-3, 2 * (Math.abs(Math.cos(pitch)) * halfHeight + Math.abs(Math.sin(pitch)) * radius));
            cam.zoom = (float)(Math.min(settings.width / spanX, settings.height / spanY) * 0.92 * settings.previewZoom);
        }
        cam.update();
        return cam;
    }

    private static double[] meshBounds(SceneMesh mesh) {
        double minXw = Double.MAX_VALUE, maxXw = -Double.MAX_VALUE;
        double minYw = Double.MAX_VALUE, maxYw = -Double.MAX_VALUE;
        double minZw = Double.MAX_VALUE, maxZw = -Double.MAX_VALUE;
        for (var layer : List.of(mesh.solid, mesh.cutout, mesh.translucent, mesh.portal, mesh.fluid)) {
            for (SceneMesh.MeshQuad q : layer) {
                if(q.decorativeEffect())continue;
                minXw = Math.min(minXw, Math.min(Math.min(q.x0, q.x1), Math.min(q.x2, q.x3)));
                maxXw = Math.max(maxXw, Math.max(Math.max(q.x0, q.x1), Math.max(q.x2, q.x3)));
                minYw = Math.min(minYw, Math.min(Math.min(q.y0, q.y1), Math.min(q.y2, q.y3)));
                maxYw = Math.max(maxYw, Math.max(Math.max(q.y0, q.y1), Math.max(q.y2, q.y3)));
                minZw = Math.min(minZw, Math.min(Math.min(q.z0, q.z1), Math.min(q.z2, q.z3)));
                maxZw = Math.max(maxZw, Math.max(Math.max(q.z0, q.z1), Math.max(q.z2, q.z3)));
            }
        }
        return minXw == Double.MAX_VALUE ? null : new double[]{minXw, minYw, minZw, maxXw, maxYw, maxZw};
    }

    private static double[] viewSpansForCamera(Camera cam, SceneMesh mesh) {
        double[] bounds = meshBounds(mesh);
        if (bounds == null) {
            cam.centerX = cam.centerY = cam.centerZ = 0;
            cam.update();
            return null;
        }
        double minXw = bounds[0], minYw = bounds[1], minZw = bounds[2];
        double maxXw = bounds[3], maxYw = bounds[4], maxZw = bounds[5];
        cam.centerX = (minXw + maxXw) / 2.0;
        cam.centerY = (minYw + maxYw) / 2.0;
        cam.centerZ = (minZw + maxZw) / 2.0;
        cam.update();

        double dx = (maxXw - minXw) / 2.0, dy = (maxYw - minYw) / 2.0, dz = (maxZw - minZw) / 2.0;
        double[] v = new double[3];
        double minX = Double.MAX_VALUE, maxX = -Double.MAX_VALUE, minY = Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
        for (int cx = 0; cx <= 1; cx++) for (int cy = 0; cy <= 1; cy++) for (int cz = 0; cz <= 1; cz++) {
            cam.toView(cam.centerX + (cx == 0 ? -dx : dx), cam.centerY + (cy == 0 ? -dy : dy), cam.centerZ + (cz == 0 ? -dz : dz), v);
            minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
            minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
        }
        return new double[]{minX, maxX, minY, maxY, Math.max(1e-3, maxX - minX), Math.max(1e-3, maxY - minY)};
    }

    /** 按模型真实包围盒适配视口。 */
    public static void fitCameraToMesh(Camera cam, SceneMesh mesh, int width, int height) {
        double[] s = viewSpansForCamera(cam, mesh);
        if (s == null) {
            cam.zoom = 1;
            cam.offsetX = cam.offsetY = 0;
            return;
        }
        double fit = Math.min(width / s[4], height / s[5]) * 0.92;
        cam.zoom = (float) fit;
        cam.offsetX = (float) (-(s[0] + s[1]) / 2.0 * fit);
        cam.offsetY = (float) (-(s[2] + s[3]) / 2.0 * fit);
    }
}
