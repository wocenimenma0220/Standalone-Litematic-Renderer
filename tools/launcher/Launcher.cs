// 便携版根目录启动器。
// 使用一个窗口程序统一承担图形启动和命令行导出。

// 安装根目录始终由 EXE 自身位置决定，不依赖调用方工作目录。

// 必须删除 ELECTRON_RUN_AS_NODE 环境变量，避免 Electron 被当成纯 Node 启动。


// 子进程输出写入 logs/launcher.log，异常退出时展示诊断末尾。

// 命令行模式调用内置 Java，优先沿用调用方输出句柄，无句柄时再附加控制台。

// 图形模式启动前，按调用方工作目录将相对文件参数转为绝对路径。


using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

[assembly: AssemblyTitle("投影预览")]
[assembly: AssemblyProduct("投影预览")]
[assembly: AssemblyCompany("LiteKinda")]
[assembly: AssemblyDescription("Minecraft 投影预览")]

internal static class Launcher
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetEnvironmentStringsW();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool FreeEnvironmentStringsW(IntPtr environment);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetEnvironmentVariableW(string name, string value);

    // 只合并当前启动器进程中的重复 PATH/Path 环境条目，避免 Framework 构造子进程环境失败。


    private static void NormalizeInheritedEnvironment()
    {
        IntPtr block = GetEnvironmentStringsW();
        if (block == IntPtr.Zero) return;
        var entries = new Dictionary<string, List<KeyValuePair<string, string>>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            IntPtr cursor = block;
            while (true)
            {
                string entry = Marshal.PtrToStringUni(cursor);
                if (string.IsNullOrEmpty(entry)) break;
                cursor = IntPtr.Add(cursor, (entry.Length + 1) * 2);
                int split = entry.IndexOf('=');
                if (split <= 0) continue;
                string name = entry.Substring(0, split), value = entry.Substring(split + 1);
                List<KeyValuePair<string, string>> group;
                if (!entries.TryGetValue(name, out group))
                {
                    group = new List<KeyValuePair<string, string>>();
                    entries.Add(name, group);
                }
                group.Add(new KeyValuePair<string, string>(name, value));
            }
        }
        finally { FreeEnvironmentStringsW(block); }
        foreach (var group in entries.Values)
        {
            if (group.Count < 2) continue;
            foreach (var entry in group) SetEnvironmentVariableW(entry.Key, null);
            if (!SetEnvironmentVariableW(group[0].Key, group[0].Value))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }


    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = false)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetStdHandle(int nStdHandle, IntPtr hHandle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess,
        uint dwShareMode, ref SECURITY_ATTRIBUTES lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const uint GENERIC_READ = 0x80000000u;
    private const uint GENERIC_WRITE = 0x40000000u;
    private const uint FILE_SHARE_READ = 0x00000001u;
    private const uint FILE_SHARE_WRITE = 0x00000002u;
    private const uint OPEN_EXISTING = 3u;

    private const uint MB_OK = 0x00000000u;
    private const uint MB_ICONERROR = 0x00000010u;
    private const uint MB_SETFOREGROUND = 0x00010000u;
    private const uint ATTACH_PARENT_PROCESS = 0xFFFFFFFFu;


    private static string _root;


    [STAThread]
    private static int Main(string[] rawArgs)
    {
        _root = ResolveRoot();

        // 读取完整原始命令行参数，避免带等号或类似开关的路径被重新解释。

        string[] argv = StripExeName(Environment.GetCommandLineArgs());
        bool cli = argv.Length > 0 && string.Equals(argv[0], "--cli", StringComparison.OrdinalIgnoreCase);


        string callerCwd = Directory.GetCurrentDirectory();

        try
        {
            NormalizeInheritedEnvironment();


            if (!cli)
            {
                bool explicitApply = false;
                int waitPid = 0;
                var passThrough = new List<string>();
                for (int i = 0; i < argv.Length; i++)
                {
                    if (string.Equals(argv[i], "--apply-update", StringComparison.OrdinalIgnoreCase))
                    {
                        explicitApply = true;
                        continue;
                    }
                    if (string.Equals(argv[i], "--wait-pid", StringComparison.OrdinalIgnoreCase) && i + 1 < argv.Length)
                    {
                        int.TryParse(argv[++i], out waitPid);
                        continue;
                    }
                    passThrough.Add(argv[i]);
                }
                argv = passThrough.ToArray();
                ApplyPendingUpdateIfPresent(waitPid, explicitApply);
            }

            return cli ? RunCli(argv) : RunGui(AbsolutizeArguments(argv, callerCwd));
        }
        catch (Exception ex)
        {
            return Fail(cli, "Unexpected launcher failure", ex.ToString(), -1);
        }
    }


    // 安装根目录使用 AppDomain.BaseDirectory，兼容不同宿主方式且不受工作目录影响。


    private static string ResolveRoot()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        if (string.IsNullOrEmpty(dir))
        {
            Assembly asm = Assembly.GetEntryAssembly();
            if (asm != null && !string.IsNullOrEmpty(asm.Location))
            {
                dir = Path.GetDirectoryName(asm.Location);
            }
        }
        if (string.IsNullOrEmpty(dir)) dir = Directory.GetCurrentDirectory();
        return dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static string[] StripExeName(string[] commandLineArgs)
    {
        if (commandLineArgs == null || commandLineArgs.Length <= 1) return new string[0];
        string[] rest = new string[commandLineArgs.Length - 1];
        Array.Copy(commandLineArgs, 1, rest, 0, rest.Length);
        return rest;
    }


    // 只将调用方目录中实际存在的相对文件参数转为绝对路径；开关和资源名称原样传递。




    private static string[] AbsolutizeArguments(string[] argv, string callerCwd)
    {
        string[] result = new string[argv.Length];
        for (int i = 0; i < argv.Length; i++)
        {
            string a = argv[i];
            result[i] = a;
            if (string.IsNullOrEmpty(a)) continue;
            if (a[0] == '-') continue;
            if (Path.IsPathRooted(a)) continue;
            try
            {
                string candidate = Path.GetFullPath(Path.Combine(callerCwd, a));
                if (File.Exists(candidate) || Directory.Exists(candidate)) result[i] = candidate;
            }
            catch (ArgumentException) {   }
            catch (NotSupportedException) { }
            catch (PathTooLongException) { }
        }
        return result;
    }


    private static int RunGui(string[] argv)
    {
        string electron = Path.Combine(_root, @"webapp\node_modules\electron\dist\electron.exe");
        string appDir = Path.Combine(_root, "webapp");

        if (!File.Exists(electron))
        {
            return Fail(false, "投影预览 — engine missing",
                "Electron was not found at:\r\n\r\n" + electron + "\r\n\r\n" +
                "The package looks incomplete. Re-extract the whole zip; the folder must contain " +
                "webapp\\, runtime\\, bin\\ and assets\\ next to this exe.", 2);
        }
        if (!Directory.Exists(appDir))
        {
            return Fail(false, "投影预览 — shell missing",
                "The Electron app directory was not found at:\r\n\r\n" + appDir, 2);
        }

        ProcessStartInfo psi = new ProcessStartInfo(electron);
        psi.UseShellExecute = false;
        psi.WorkingDirectory = _root;

        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;


        // 环境变量必须删除，不能仅设为空；Electron 原生代码可能只检查其是否存在。

        psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        // -----------------------------------------------------------------------------

        psi.StandardOutputEncoding = System.Text.Encoding.UTF8;
        psi.StandardErrorEncoding = System.Text.Encoding.UTF8;
        psi.Arguments = BuildArguments(appDir, argv);


        string tail = "";
        int code;
        try
        {
            code = Launch(electron, psi, out tail);
        }
        catch (Exception ex)
        {
            return Fail(false, "投影预览 — could not start",
                "Failed to start Electron:\r\n\r\n" + electron + "\r\n\r\n" + ex.Message, -1);
        }

        if (code != 0)
        {
            return Fail(false, "投影预览 — exited with code " + code,
                "Electron exited with code " + code + ".\r\n\r\n" +
                (tail.Length > 0 ? "Last output:\r\n\r\n" + tail : "No diagnostic output was captured.") +
                "\r\n\r\nFull log: " + LogPath(), code);
        }
        return 0;
    }


    private static string BuildArguments(string appDir, string[] argv)
    {
        string args = Quote(appDir);
        for (int i = 0; i < argv.Length; i++)
        {
            args += " " + Quote(argv[i]);
        }
        return args;
    }


    private static int RunCli(string[] argv)
    {
        string java = Path.Combine(_root, @"runtime\bin\java.exe");
        if (!File.Exists(java))
        {
            // Development fallback, mirroring 命令行渲染.bat.
            string sibling = Path.GetFullPath(Path.Combine(_root, @"..\..\jdk-25.0.4.1+1\bin\java.exe"));
            if (File.Exists(sibling)) java = sibling;
        }
        if (!File.Exists(java))
        {
            return Fail(true, "java runtime missing",
                "Neither runtime\\bin\\java.exe nor a workspace JDK was found under:\r\n\r\n" + _root, 2);
        }

        ProcessStartInfo psi = new ProcessStartInfo(java);
        psi.UseShellExecute = false;
        psi.WorkingDirectory = _root;

        // 始终重定向子进程输出，再转发到本进程；不重定向时 .NET 可能不继承标准句柄。


        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;


        psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");

        string args = "-Xmx4g -Dfile.encoding=UTF-8 -Djava.net.useSystemProxies=true " +
                      Quote("-Dlitematicrender.home=" + _root + Path.DirectorySeparatorChar) +
                      " -cp " + Quote(Path.Combine(_root, "bin")) +
                      " io.github.litematicrender.Main --render";
        for (int i = 1; i < argv.Length; i++) args += " " + Quote(argv[i]);
        psi.Arguments = args;


        EnsureConsoleForCli();

        try
        {
            string unused;
            return Launch(java, psi, out unused, true);
        }
        catch (Exception ex)
        {
            return Fail(true, "could not start java", ex.Message, -1);
        }
    }


    // 优先使用调用方的管道或文件输出，仅在没有继承句柄时附加控制台，避免劫持输出。


    private static void EnsureConsoleForCli()
    {
        IntPtr inherited = GetStdHandle(STD_OUTPUT_HANDLE);
        if (inherited != IntPtr.Zero && inherited != new IntPtr(-1))
        {
            return;
        }

        if (!AttachConsole(ATTACH_PARENT_PROCESS)) return;

        // 无继承句柄时使用 CONOUT$ 为转发安装输出目标。

        SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;
        IntPtr conout = CreateFileW("CONOUT$", GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE, ref sa, OPEN_EXISTING, 0u, IntPtr.Zero);
        if (conout == new IntPtr(-1)) return;

        SetStdHandle(STD_OUTPUT_HANDLE, conout);
        SetStdHandle(STD_ERROR_HANDLE, conout);

        try
        {
            StreamWriter so = new StreamWriter(Console.OpenStandardOutput());
            so.AutoFlush = true;
            Console.SetOut(so);
            StreamWriter se = new StreamWriter(Console.OpenStandardError());
            se.AutoFlush = true;
            Console.SetError(se);
        }
        catch (IOException) {   }
    }


    private static int Launch(string exe, ProcessStartInfo psi, out string tail)
    {
        return Launch(exe, psi, out tail, false);
    }


    // 实时转发子进程输出，同时保留日志文件记录。


    private static int Launch(string exe, ProcessStartInfo psi, out string tail, bool relay)
    {
        System.Text.StringBuilder captured = new System.Text.StringBuilder();
        TextWriter consoleOut = relay ? Console.Out : null;
        TextWriter consoleErr = relay ? Console.Error : null;

        Process p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            lock (captured) { captured.AppendLine(e.Data); Trim(captured); }
            if (consoleOut != null)
            {
                try { consoleOut.WriteLine(e.Data); } catch (IOException) { }
            }
        };
        p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            lock (captured) { captured.AppendLine(e.Data); Trim(captured); }
            if (consoleErr != null)
            {
                try { consoleErr.WriteLine(e.Data); } catch (IOException) { }
            }
        };

        Log("start: " + exe);
        Log("args : " + psi.Arguments);
        Log("cwd  : " + psi.WorkingDirectory);
        Log("ELECTRON_RUN_AS_NODE present in child env: " +
            (psi.EnvironmentVariables.ContainsKey("ELECTRON_RUN_AS_NODE") ? "YES (bug)" : "no"));

        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();
        p.WaitForExit();   // 再次等待进程完成，以确保异步输出读取已经排空。

        tail = captured.ToString().Trim();
        if (tail.Length > 0) Log(tail);
        Log("exit : " + p.ExitCode);
        return p.ExitCode;
    }


    private static void Trim(System.Text.StringBuilder sb)
    {
        if (sb.Length > 8000) sb.Remove(0, sb.Length - 6000);
    }

    // 使用 Windows CommandLineToArgvW 对应规则转义参数。
    private static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return arg;

        System.Text.StringBuilder sb = new System.Text.StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        for (int i = 0; i < arg.Length; i++)
        {
            char c = arg[i];
            if (c == '\\') { backslashes++; continue; }
            if (c == '"')
            {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
            }
            else
            {
                sb.Append('\\', backslashes);
                sb.Append(c);
            }
            backslashes = 0;
        }
        sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }


    private static string LogPath()
    {
        return Path.Combine(_root, @"logs\launcher.log");
    }

    private static void Log(string line)
    {
        try
        {
            string path = LogPath();
            string dir = Path.GetDirectoryName(path);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(path,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + line + Environment.NewLine);
        }
        catch (Exception) {   }
    }


    private static void ApplyPendingUpdateIfPresent(int waitPid, bool explicitRequest)
    {
        string pendingFile = Path.Combine(_root, @"updates\pending-update.json");
        if (!File.Exists(pendingFile)) return;

        string backupDir = null;
        try
        {
            var serializer = new JavaScriptSerializer();
            var pending = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(pendingFile, System.Text.Encoding.UTF8));
            if (pending == null) { TryDeleteFile(pendingFile); return; }

            string manifestPath = Path.Combine(_root, "install-manifest.json");
            if (!File.Exists(manifestPath))
            {
                Log("skip update apply: portable distribution without install-manifest.json");
                TryDeleteFile(pendingFile);
                return;
            }
            var manifest = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath, System.Text.Encoding.UTF8));
            string dist = manifest != null && manifest.ContainsKey("distribution") ? Convert.ToString(manifest["distribution"]) : "";
            if (!string.Equals(dist, "installer", StringComparison.OrdinalIgnoreCase))
            {
                Log("skip update apply: distribution is not installer");
                TryDeleteFile(pendingFile);
                return;
            }

            string payloadDir = pending.ContainsKey("payloadDir") ? Convert.ToString(pending["payloadDir"]) : "";
            string toVersion = pending.ContainsKey("toVersion") ? Convert.ToString(pending["toVersion"]) : "";
            if (string.IsNullOrEmpty(payloadDir) || !Directory.Exists(payloadDir))
            {
                Log("skip update apply: missing payload directory " + payloadDir);
                TryDeleteFile(pendingFile);
                return;
            }

            WaitForProcessExit(waitPid, 20000);
            WaitForOwnElectronExit(8000);

            string stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            backupDir = Path.Combine(_root, @"updates\backup\" + stamp);
            Directory.CreateDirectory(backupDir);

            string payloadBin = Path.Combine(payloadDir, "bin");
            string payloadWebapp = Path.Combine(payloadDir, "webapp");
            string payloadAssets = Path.Combine(payloadDir, "assets");

            string targetBin = Path.Combine(_root, "bin");
            string targetWebapp = Path.Combine(_root, "webapp");
            string targetAssets = Path.Combine(_root, "assets");

            if (Directory.Exists(payloadBin))
            {
                if (Directory.Exists(targetBin)) CopyDirectory(targetBin, Path.Combine(backupDir, "bin"), null);
                ReplaceDirectoryContents(payloadBin, targetBin, null);
            }
            if (Directory.Exists(payloadWebapp))
            {
                var preserve = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "node_modules" };
                if (Directory.Exists(targetWebapp)) CopyDirectory(targetWebapp, Path.Combine(backupDir, "webapp"), preserve);
                ReplaceDirectoryContents(payloadWebapp, targetWebapp, preserve);
            }
            if (Directory.Exists(payloadAssets))
            {
                if (Directory.Exists(targetAssets)) BackupOverwrittenFiles(payloadAssets, targetAssets, Path.Combine(backupDir, "assets"));
                CopyDirectory(payloadAssets, targetAssets, null);
            }

            manifest["installedVersion"] = toVersion;
            if (!string.IsNullOrEmpty(toVersion)) manifest["displayVersion"] = toVersion;
            manifest["updatedAt"] = DateTime.UtcNow.ToString("o");
            File.WriteAllText(manifestPath, serializer.Serialize(manifest), new System.Text.UTF8Encoding(false));

            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\LiteKindaProjectionPreview", true))
                {
                    if (key != null && !string.IsNullOrEmpty(toVersion))
                    {
                        string regDir = Convert.ToString(key.GetValue("InstallLocation")) ?? "";
                        string normReg = string.IsNullOrWhiteSpace(regDir) ? "" : Path.GetFullPath(regDir.Trim()).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                        string normRoot = Path.GetFullPath(_root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                        if (string.IsNullOrEmpty(normReg) || string.Equals(normReg, normRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            key.SetValue("DisplayVersion", toVersion);
                        }
                    }
                }
            }
            catch (Exception) { }

            TryDeleteFile(pendingFile);
            TryDeleteDirectory(Path.Combine(_root, @"updates\staging"));
            PruneOldBackups(Path.Combine(_root, @"updates\backup"), 1);
            Log("patch applied cleanly -> version " + toVersion);
        }
        catch (Exception ex)
        {
            Log("update apply failed: " + ex);
            try
            {
                if (!string.IsNullOrEmpty(backupDir) && Directory.Exists(backupDir))
                {
                    string bBin = Path.Combine(backupDir, "bin");
                    string bWebapp = Path.Combine(backupDir, "webapp");
                    string bAssets = Path.Combine(backupDir, "assets");
                    if (Directory.Exists(bBin)) ReplaceDirectoryContents(bBin, Path.Combine(_root, "bin"), null);
                    if (Directory.Exists(bWebapp)) ReplaceDirectoryContents(bWebapp, Path.Combine(_root, "webapp"), new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "node_modules" });
                    if (Directory.Exists(bAssets)) CopyDirectory(bAssets, Path.Combine(_root, "assets"), null);
                    Log("rollback from backup completed");
                }
            }
            catch (Exception rex)
            {
                Log("rollback failed: " + rex);
            }
            TryDeleteFile(pendingFile);
            if (explicitRequest)
            {
                try
                {
                    MessageBoxW(IntPtr.Zero, "应用更新补丁失败，已保留或恢复原版本：\r\n\r\n" + ex.Message,
                        "投影预览 — 更新失败", MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
                }
                catch (Exception) { }
            }
        }
    }

    private static void WaitForProcessExit(int pid, int timeoutMs)
    {
        if (pid <= 0) return;
        try
        {
            using (Process proc = Process.GetProcessById(pid))
            {
                proc.WaitForExit(timeoutMs);
            }
        }
        catch (Exception) { }
    }

    private static void WaitForOwnElectronExit(int timeoutMs)
    {
        string prefix = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        int waited = 0;
        while (waited < timeoutMs)
        {
            bool any = false;
            try
            {
                foreach (Process p in Process.GetProcessesByName("electron"))
                {
                    try
                    {
                        string exe = p.MainModule != null ? p.MainModule.FileName : "";
                        if (!string.IsNullOrEmpty(exe) && exe.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        {
                            any = true;
                            break;
                        }
                    }
                    catch (Exception) { }
                    finally { p.Dispose(); }
                }
            }
            catch (Exception) { }
            if (!any) return;
            Thread.Sleep(200);
            waited += 200;
        }
    }

    private static void BackupOverwrittenFiles(string srcDir, string currentDir, string backupDir)
    {
        foreach (string srcFile in Directory.GetFiles(srcDir, "*", SearchOption.AllDirectories))
        {
            string rel = srcFile.Substring(srcDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string existing = Path.Combine(currentDir, rel);
            if (!File.Exists(existing)) continue;
            string dest = Path.Combine(backupDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            File.Copy(existing, dest, true);
        }
    }

    private static void ReplaceDirectoryContents(string srcDir, string dstDir, HashSet<string> preserveTopDirs)
    {
        if (Directory.Exists(dstDir))
        {
            foreach (string file in Directory.GetFiles(dstDir)) File.Delete(file);
            foreach (string sub in Directory.GetDirectories(dstDir))
            {
                string name = Path.GetFileName(sub);
                if (preserveTopDirs != null && preserveTopDirs.Contains(name)) continue;
                Directory.Delete(sub, true);
            }
        }
        CopyDirectory(srcDir, dstDir, preserveTopDirs);
    }

    private static void CopyDirectory(string srcDir, string dstDir, HashSet<string> skipTopDirs)
    {
        Directory.CreateDirectory(dstDir);
        foreach (string file in Directory.GetFiles(srcDir))
        {
            File.Copy(file, Path.Combine(dstDir, Path.GetFileName(file)), true);
        }
        foreach (string sub in Directory.GetDirectories(srcDir))
        {
            string name = Path.GetFileName(sub);
            if (skipTopDirs != null && skipTopDirs.Contains(name)) continue;
            CopyDirectory(sub, Path.Combine(dstDir, name), null);
        }
    }

    private static void PruneOldBackups(string backupRoot, int keep)
    {
        if (!Directory.Exists(backupRoot)) return;
        var dirs = new List<DirectoryInfo>(new DirectoryInfo(backupRoot).GetDirectories());
        dirs.Sort((a, b) => b.CreationTimeUtc.CompareTo(a.CreationTimeUtc));
        for (int i = keep; i < dirs.Count; i++) TryDeleteDirectory(dirs[i].FullName);
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (Exception) { }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch (Exception) { }
    }

    // 图形模式使用消息框报告错误，命令行模式写入标准错误。


    private static int Fail(bool console, string caption, string detail, int code)
    {
        Log("FAIL [" + caption + "] " + detail);
        if (console)
        {
            EnsureConsoleForCli();
            try
            {
                Console.Error.WriteLine();
                Console.Error.WriteLine("[ERROR] " + caption);
                Console.Error.WriteLine(detail);
            }
            catch (IOException) { }
        }
        else
        {
            try
            {
                MessageBoxW(IntPtr.Zero, detail, caption,
                    MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
            }
            catch (Exception) { }
        }
        return code;
    }
}
