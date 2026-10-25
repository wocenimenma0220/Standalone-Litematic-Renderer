'use strict';

/** Java 查找顺序：内置 runtime、工作区 JDK、JAVA_HOME、系统 PATH；类路径固定为项目 bin。 */

const fs = require('node:fs');
const path = require('node:path');

function javaExeName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function isJavaExe(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}


function asJavaHome(dir) {
  if (!dir) return null;
  const exe = path.join(dir, 'bin', javaExeName());
  return isJavaExe(exe) ? exe : null;
}

function findJdkBeside(home) {

  const parent = path.resolve(home, '..', '..');
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = entries
    .filter((e) => e.isDirectory() && /^jdk/i.test(e.name))
    .map((e) => path.join(parent, e.name))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const exe = asJavaHome(dir);
    if (exe) return exe;
  }
  return null;
}


function resolveRuntime(home) {
  const classes = path.join(home, 'bin');
  const classpath = classes;

  const bundled = asJavaHome(path.join(home, 'runtime'));
  if (bundled) return { javaExe: bundled, classpath, source: 'bundled runtime/' };

  const beside = findJdkBeside(home);
  if (beside) return { javaExe: beside, classpath, source: 'workspace JDK' };

  const fromEnv = asJavaHome(process.env.JAVA_HOME);
  if (fromEnv) return { javaExe: fromEnv, classpath, source: 'JAVA_HOME' };

  return { javaExe: javaExeName(), classpath, source: 'PATH' };
}

module.exports = { resolveRuntime };
