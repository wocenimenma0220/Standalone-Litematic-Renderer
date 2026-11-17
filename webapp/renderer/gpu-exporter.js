'use strict';
/** 复用现有 WebGL GpuView 几何与纹理贴图，通过离屏 FBO 实现极速 PNG 与 360° GIF 导出。 */
(function (root) {
  function maxEdge(view) {
    const gl = view?.gl;
    if (!gl || gl.isContextLost()) return 0;
    const rb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0;
    const tex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    return Math.min(8192, rb, tex);
  }

  function canExport({ kind, rawSize, width, height, view, cpuPreview, viewReady, scenePreparing, overview }) {
    if (cpuPreview || !viewReady || !view || scenePreparing || overview) {
      return { ok: false, reason: '当前未使用完整 GPU 3D 视图，自动使用 CPU 导出' };
    }
    if (view.stream) {
      return { ok: false, reason: '分块大投影由 CPU 后台导出以保证全部区块与最高精度' };
    }
    if (rawSize === 'lossless') {
      return { ok: false, reason: '无损自适应分辨率需由 CPU 导出' };
    }
    const limit = maxEdge(view);
    if (!limit || width > limit || height > limit) {
      return { ok: false, reason: `导出尺寸超出当前显卡单帧上限（${limit || 0}px），自动改用 CPU 导出` };
    }
    if (kind === 'gif' && (width > 4096 || height > 4096)) {
      return { ok: false, reason: 'GIF 动画最高支持 4096 × 4096' };
    }
    return { ok: true };
  }

  function createFbo(gl, width, height) {
    const colorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(colorTex);
      gl.deleteRenderbuffer(depthRb);
      throw Error('显卡离屏渲染缓冲创建失败 (0x' + status.toString(16) + ')');
    }
    return {
      fbo,
      dispose() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(colorTex);
        gl.deleteRenderbuffer(depthRb);
      },
    };
  }

  async function renderCoverBackground(dataUrl, width, height) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(Error('无法解码导出背景图'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#22262e';
    ctx.fillRect(0, 0, width, height);
    const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const w = Math.ceil(img.naturalWidth * scale), h = Math.ceil(img.naturalHeight * scale);
    ctx.drawImage(img, Math.floor((width - w) / 2), Math.floor((height - h) / 2), w, h);
    return ctx.getImageData(0, 0, width, height).data;
  }

  function resolveGlClearColor(transparent, backgroundMode, backgroundInt) {
    if (transparent || backgroundMode === 'image') return [0, 0, 0, 0];
    const r = ((backgroundInt >>> 16) & 255) / 255;
    const g = ((backgroundInt >>> 8) & 255) / 255;
    const b = (backgroundInt & 255) / 255;
    return [r, g, b, 1];
  }

  function convertReadback(raw, out, width, height, { transparent, bgPixels, swapRB }) {
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * rowBytes;
      const dstRow = y * rowBytes;
      for (let x = 0; x < rowBytes; x += 4) {
        const s = srcRow + x, d = dstRow + x;
        const a = raw[s + 3];
        let r = raw[s], g = raw[s + 1], b = raw[s + 2], outA = a;
        if (bgPixels) {
          const inv = 255 - a;
          r = Math.min(255, r + (((bgPixels[d] * inv + 127) / 255) | 0));
          g = Math.min(255, g + (((bgPixels[d + 1] * inv + 127) / 255) | 0));
          b = Math.min(255, b + (((bgPixels[d + 2] * inv + 127) / 255) | 0));
          outA = 255;
        } else if (transparent) {
          if (a === 0) {
            r = g = b = outA = 0;
          } else if (a < 255) {
            r = Math.min(255, Math.round((r * 255) / a));
            g = Math.min(255, Math.round((g * 255) / a));
            b = Math.min(255, Math.round((b * 255) / a));
          }
        } else {
          outA = 255;
        }
        if (swapRB) {
          out[d] = b; out[d + 1] = g; out[d + 2] = r; out[d + 3] = outA;
        } else {
          out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = outA;
        }
      }
    }
  }

  async function renderFrameRgba({ view, width, height, rotationDeg, slantDeg, transparent, backgroundMode, backgroundColor, backgroundDataUrl, selection }) {
    const gl = view.gl;
    const bgPixels = !transparent && backgroundMode === 'image' && backgroundDataUrl
      ? await renderCoverBackground(backgroundDataUrl, width, height) : null;
    const target = createFbo(gl, width, height);
    try {
      const clear = resolveGlClearColor(transparent, backgroundMode, backgroundColor);
      view.draw({
        orbit: true,
        rotationDeg,
        slantDeg,
        zoom: 1,
        background: clear,
        focus: selection || null,
        selectionBox: false,
        searchBoxes: false,
        searchDim: false,
        editTarget: null,
        framebuffer: target.fbo,
        targetWidth: width,
        targetHeight: height,
      });
      const raw = new Uint8Array(width * height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const rgba = new Uint8Array(width * height * 4);
      convertReadback(raw, rgba, width, height, { transparent, bgPixels, swapRB: false });
      return rgba;
    } finally {
      target.dispose();
    }
  }

  async function exportPng(options) {
    const { out, width, height } = options;
    const rgba = await renderFrameRgba(options);
    return await window.exportsApi.saveGpuPng({ out, width, height, rgbaBuffer: rgba.buffer });
  }

  async function exportGif({ view, width, height, rotationDeg, slantDeg, frames, delay, transparent, backgroundMode, backgroundColor, backgroundDataUrl, selection, out }) {
    const gl = view.gl;
    const bgPixels = !transparent && backgroundMode === 'image' && backgroundDataUrl
      ? await renderCoverBackground(backgroundDataUrl, width, height) : null;
    const target = createFbo(gl, width, height);
    const frameBytes = width * height * 4;
    const batchFrames = Math.max(1, Math.min(16, Math.floor((8 * 1024 * 1024) / Math.max(1, frameBytes))));
    const raw = new Uint8Array(frameBytes);
    let session = null;
    try {
      session = await window.exportsApi.gpuGifBegin({ out, width, height, frames, delay });
      const clear = resolveGlClearColor(transparent, backgroundMode, backgroundColor);
      let chunkBuf = new Uint8Array(Math.min(frames, batchFrames) * frameBytes);
      let inBatch = 0;
      for (let i = 0; i < frames; i++) {
        view.draw({
          orbit: true,
          fixedFit: true,
          rotationDeg: rotationDeg + (i * 360) / frames,
          slantDeg,
          zoom: 1,
          background: clear,
          focus: selection || null,
          selectionBox: false,
          searchBoxes: false,
          searchDim: false,
          editTarget: null,
          framebuffer: target.fbo,
          targetWidth: width,
          targetHeight: height,
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const dstSlice = chunkBuf.subarray(inBatch * frameBytes, (inBatch + 1) * frameBytes);
        convertReadback(raw, dstSlice, width, height, { transparent, bgPixels, swapRB: true });
        inBatch++;
        if (inBatch === batchFrames || i === frames - 1) {
          const payload = inBatch * frameBytes === chunkBuf.byteLength
            ? chunkBuf.buffer
            : chunkBuf.slice(0, inBatch * frameBytes).buffer;
          const res = await window.exportsApi.gpuGifChunk({ id: session.id, chunk: payload, completed: i + 1 });
          if (res?.aborted) return { aborted: true, id: session.id };
          inBatch = 0;
          if (frames - 1 - i > 0 && frames - 1 - i < batchFrames) {
            chunkBuf = new Uint8Array((frames - 1 - i) * frameBytes);
          }
          await new Promise(r => setTimeout(r, 0));
        }
      }
      return await window.exportsApi.gpuGifFinish({ id: session.id });
    } catch (err) {
      if (session?.id) await window.exportsApi.gpuGifAbort(session.id).catch(() => {});
      throw err;
    } finally {
      target.dispose();
    }
  }

  root.GpuExporter = { canExport, maxEdge, renderFrameRgba, exportPng, exportGif };
})(typeof window !== 'undefined' ? window : globalThis);
