'use strict';

/** Java 引擎使用逐行 JSON-RPC，所有调用串行执行，保持当前投影和渲染状态一致。 */

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const {memoryPolicy}=require('./performance-policy');

class EngineClient {
  /** 构造参数包含 Java 路径、类路径、项目目录以及事件和退出回调。 */
  constructor(opts) {
    this.opts = opts;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();

    this.queue = [];
    this.busy = false;
    this.stderrTail = [];
  }

  isRunning() {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
  }

  start() {
    this.stopping = null;
    this.forced = false;
    this.stderrTail = [];
    return new Promise((resolve, reject) => {
      const args = [
        `-Xmx${memoryPolicy().heapMB}m`,
        '-Dfile.encoding=UTF-8',
        '-Djava.net.useSystemProxies=true',
        `-Dlitematicrender.home=${this.opts.home}`,
        '-cp',
        this.opts.classpath,
        'io.github.litematicrender.Main',
        '--serve',
      ];
      let child;
      try {
        child = spawn(this.opts.javaExe, args, { cwd: this.opts.home, windowsHide: true });
      } catch (err) {
        reject(err);
        return;
      }
      this.proc = child;

      // 标准输出和错误流都显式按 UTF-8 解码，避免中文资源包名称在 JSON 解析前损坏。


      child.stdout.setEncoding('utf8');
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => { if (this.proc === child && !this.forced) this._onLine(line); });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (this.proc !== child || this.forced) return;
        // 只保留有界的错误日志末尾，用于退出诊断。
        for (const l of String(chunk).split(/\r?\n/)) {
          if (!l.trim()) continue;
          this.stderrTail.push(l);
          if (this.stderrTail.length > 200) this.stderrTail.shift();
        }
        if (this.opts.onEvent) this.opts.onEvent({ event: 'stderr', message: String(chunk) });
      });

      child.on('error', (err) => {
        this._failAll(err);
        if (this.opts.onExit) this.opts.onExit({ error: String(err.message || err) });
        reject(err);
      });

      child.on('exit', (code, signal) => {
        if (this.proc !== child) return;
        this.proc = null;
        const info = { code, signal, forced: this.forced, stderrTail: this.stderrTail.slice(-40) };
        this._failAll(new Error(`render engine exited (code=${code} signal=${signal})`));
        if (this.opts.onExit) this.opts.onExit(info);
        cleanup();
        reject(new Error('渲染引擎在启动完成前退出'));
      });


      const onReady = (evt) => {
        if (evt.event === 'ready') {
          cleanup();
          resolve({ pid: evt.pid });
        }
      };
      this._readyHook = onReady;
      const cleanup = () => {
        this._readyHook = null;
      };
      setTimeout(() => {
        if (this._readyHook) {
          cleanup();
          resolve({ pid: child.pid, slow: true });
        }
      }, 8000).unref?.();
    });
  }

  _onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event === 'ready') {
      this.temporaryCaches = msg.temporaryCaches;
      if (this._readyHook) this._readyHook(msg);
      if (this.opts.onEvent) this.opts.onEvent(msg);
      return;
    }
    if (msg.id === undefined) {
      if (this.opts.onEvent) this.opts.onEvent(msg);
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(Object.assign(new Error(msg.error || 'engine error'), { errorType: msg.errorType }));
  }

  _failAll(err) {
    for (const job of this.queue.splice(0)) job.reject(err);
    for (const [, entry] of this.pending) entry.reject(err);
    this.pending.clear();
  }


  call(method, params) {
    if(this.stopping)return Promise.reject(new Error(this.forced ? '渲染已强制停止' : '应用正在退出'));
    return new Promise((resolve, reject) => {
      this.queue.push({ method, params, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    this._send(job.method, job.params)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.busy = false;
        this._pump();
      });
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.isRunning()) {
        reject(new Error('render engine is not running'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const line = JSON.stringify({ id, method, params: params || {} }) + '\n';
      this.proc.stdin.write(line, 'utf8', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  stop() {
    if (this.stopping) return this.stopping;
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
    this.stopping = new Promise(resolve => {
      const killTimer = setTimeout(() => { try { proc.kill(); } catch {   } }, 5000);
      proc.once('exit', () => { clearTimeout(killTimer); resolve(); });
      for(const job of this.queue.splice(0))job.reject(new Error('应用正在退出'));
      try {
        proc.stdin.write(JSON.stringify({ id: 0, method: 'cancelPreview', params: {} }) + '\n');
        proc.stdin.end(JSON.stringify({ id: 0, method: 'shutdown', params: {} }) + '\n');
      } catch { try { proc.kill(); } catch {   } }
    });
    return this.stopping;
  }

  /** 强制取消不进入 RPC 队列，避免被阻塞的读取或渲染请求挡住。 */
  forceStop() {
    if (this.stopping) return this.stopping;
    const proc = this.proc;
    this.forced = true;
    this.stopping = new Promise((resolve, reject) => {
      if (!proc || proc.exitCode !== null || proc.signalCode !== null) { resolve(); return; }
      proc.once('exit', resolve);
      try { proc.kill('SIGKILL'); } catch (error) { reject(error); }
    });
    this._failAll(new Error('渲染已强制停止'));
    return this.stopping;
  }

  getStderrTail() {
    return this.stderrTail.slice(-40);
  }
}

module.exports = { EngineClient };
