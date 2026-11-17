'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repo = path.resolve(__dirname, '../../..');
const out = path.join(__dirname, '../single-instance-output');
const electronData = path.join(out, 'electron');

const isSecondChild = process.env.LITEMATIC_SECOND_CHILD === '1';

if (isSecondChild) {
  // Child launch simulating Windows double-clicking a schematic file externally
  app.setPath('userData', electronData);
  BrowserWindow.prototype.show = function () {
    this.setPosition(-20000, -20000, false);
    this.showInactive();
  };
  require(path.join(repo, 'webapp/main.js'));
  setTimeout(() => { console.error('Second instance did not exit quickly'); app.exit(9); }, 10000).unref();
} else {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const fixture = [
    path.join(repo, 'tools/verify/fly-output/inspection.litematic'),
    path.join(repo, 'tools/verify/verification-output/pipeline-home/pipeline.litematic'),
    path.join(repo, 'docs/examples/功能演示.litematic'),
  ].find(p => fs.existsSync(p));
  if (!fixture) throw Error('No test schematic fixture found');

  const firstFile = path.join(out, 'first.litematic');
  const secondFile = path.join(out, 'second.litematic');
  const thirdFile = path.join(out, 'third.litematic');
  fs.copyFileSync(fixture, firstFile);
  fs.copyFileSync(fixture, secondFile);
  fs.copyFileSync(fixture, thirdFile);

  process.argv = [process.argv[0], path.join(repo, 'webapp'), firstFile];
  process.env.JAVA_TOOL_OPTIONS = (process.env.JAVA_TOOL_OPTIONS || '') + ' -Dlitematicrender.skins.offline=true';
  process.env.LITEMATIC_DISABLE_AUTO_UPDATE = '1';
  app.setPath('userData', electronData);
  BrowserWindow.prototype.show = function () {
    this.setPosition(-20000, -20000, false);
    this.showInactive();
  };
  app.commandLine.appendSwitch('disable-renderer-backgrounding');

  const settingsModule = require(path.join(repo, 'webapp/ui-settings'));
  const OriginalSettings = settingsModule.UiSettings;
  settingsModule.UiSettings = class extends OriginalSettings {
    constructor() { super(out); }
  };
  const settingsFile = path.join(out, 'settings/ui.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ hideWelcome: true, backgroundMode: 'checker', previewBackend: 'gpu' }));

  function launchExternalOpen(fileArg) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename, fileArg], {
        cwd: repo,
        env: { ...process.env, LITEMATIC_SECOND_CHILD: '1', LITEMATIC_DISABLE_AUTO_UPDATE: '1' },
        windowsHide: true,
        stdio: 'ignore',
      });
      const t0 = Date.now();
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code, elapsedMs: Date.now() - t0 }));
    });
  }

  let createdCount = 0;
  app.on('browser-window-created', () => { createdCount++; });

  app.once('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const run = code => win.webContents.executeJavaScript('(async()=>{' + code + '})()');
      try {
        // 1. Wait for startup CLI file (first.litematic) to load
        const waitFile = async (expectedPath, mode = '3d') => {
          const end = Date.now() + 60000;
          while (Date.now() < end) {
            const st = await run(`return {
              file: state.file,
              opening: state.fileOpening,
              rendering: state.rendering,
              viewReady: state.viewReady,
              sheetMode: state.sheetMode,
              sheetOut: state.lastSheet?.out || null,
            };`);
            if (st.file === expectedPath && !st.opening && !st.rendering) {
              if (mode === 'sheet' && st.sheetOut) return st;
              if (mode === '3d' && st.viewReady) return st;
            }
            await new Promise(r => setTimeout(r, 40));
          }
          throw Error('Timed out waiting for ' + expectedPath + ' (' + mode + ')');
        };

        const st1 = await waitFile(firstFile, '3d');
        assert.equal(createdCount, 1);
        assert.equal(BrowserWindow.getAllWindows().length, 1);

        // 2. Externally launch second.litematic while Instance #1 is running in 3D mode
        const ext2 = await launchExternalOpen(secondFile);
        assert.equal(ext2.code, 0, 'Second instance must exit with code 0, got ' + ext2.code);
        const st2 = await waitFile(secondFile, '3d');
        assert.equal(createdCount, 1, 'Expected only 1 window ever created');
        assert.equal(BrowserWindow.getAllWindows().length, 1, 'Expected only 1 active window');

        // 3. Switch to 导出模式 and externally open third.litematic
        await run(`setSheetMode(true);`);
        const ext3 = await launchExternalOpen(thirdFile);
        assert.equal(ext3.code, 0, 'Third instance must exit with code 0, got ' + ext3.code);
        const st3 = await waitFile(thirdFile, 'sheet');
        assert.equal(createdCount, 1);
        assert.equal(BrowserWindow.getAllWindows().length, 1);
        assert.equal(fs.existsSync(st3.sheetOut), true, 'Expected showcase PNG for externally opened third file');
        assert.equal(st3.viewReady, false, 'Export mode should not build 3D view on external open');

        console.log(JSON.stringify({
          pass: true,
          windowsCreated: createdCount,
          firstFile: path.basename(st1.file),
          secondLaunchExitCode: ext2.code,
          secondFile: path.basename(st2.file),
          thirdLaunchExitCode: ext3.code,
          thirdFile: path.basename(st3.file),
          thirdSheetExported: path.basename(st3.sheetOut),
        }));
        app.quit();
      } catch (err) {
        console.error(err);
        app.exit(1);
      }
    });
  });

  require(path.join(repo, 'webapp/main.js'));
  setTimeout(() => { console.error('single-instance test timed out'); app.exit(1); }, 120000).unref();
}
