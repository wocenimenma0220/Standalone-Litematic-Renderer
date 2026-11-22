using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("投影预览 安装程序")]
[assembly: AssemblyProduct("投影预览")]
[assembly: AssemblyCompany("LiteKinda")]
[assembly: AssemblyDescription("Minecraft 投影预览 Windows 安装向导")]

internal static class SetupProgram
{
    private const string Magic = "LVPACK01";
    private const string UninstallKeyName = "LiteKindaProjectionPreview";
    private const string ProgId = "LiteKinda.ProjectionPreview";
    private const string RegisteredAppName = "LiteKindaProjectionPreview";
    private const int SHCNE_ASSOCCHANGED = 0x08000000;
    private const uint SHCNF_IDLIST = 0x0000;

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    private sealed class RegPaths
    {
        public readonly string RegRoot;
        public readonly bool IsRealSystem;
        public readonly string UninstallSubKey;
        public readonly string ClassesRoot;
        public readonly string CapabilitiesSubKey;
        public readonly string RegisteredAppsSubKey;

        public RegPaths(string regRoot)
        {
            string clean = NormalizeRegRoot(regRoot);
            RegRoot = clean;
            IsRealSystem = string.IsNullOrEmpty(clean);
            if (IsRealSystem)
            {
                UninstallSubKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + UninstallKeyName;
                ClassesRoot = @"Software\Classes";
                CapabilitiesSubKey = @"Software\LiteKinda\ProjectionPreview\Capabilities";
                RegisteredAppsSubKey = @"Software\RegisteredApplications";
            }
            else
            {
                UninstallSubKey = clean + @"\Uninstall\" + UninstallKeyName;
                ClassesRoot = clean + @"\Classes";
                CapabilitiesSubKey = clean + @"\LiteKinda\ProjectionPreview\Capabilities";
                RegisteredAppsSubKey = clean + @"\RegisteredApplications";
            }
        }
    }

    private static string NormalizeRegRoot(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        string clean = raw.Trim().Replace('/', '\\').Trim('\\');
        if (clean.IndexOf("..", StringComparison.Ordinal) >= 0) throw new ArgumentException("无效的注册表路径");
        if (!clean.StartsWith(@"Software\", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("--reg-root 必须位于 Software\\ 下");
        }
        return clean;
    }

    private sealed class SubStream : Stream
    {
        private readonly FileStream _inner;
        private readonly long _start;
        private readonly long _length;
        private long _pos;

        public SubStream(FileStream inner, long start, long length)
        {
            _inner = inner;
            _start = start;
            _length = length;
            _pos = 0;
        }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return _length; } }
        public override long Position
        {
            get { return _pos; }
            set { _pos = Math.Max(0, Math.Min(_length, value)); }
        }

        public override void Flush() { }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = _length - _pos;
            if (remaining <= 0) return 0;
            int toRead = (int)Math.Min(count, remaining);
            _inner.Seek(_start + _pos, SeekOrigin.Begin);
            int read = _inner.Read(buffer, offset, toRead);
            _pos += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long next = _pos;
            if (origin == SeekOrigin.Begin) next = offset;
            else if (origin == SeekOrigin.Current) next = _pos + offset;
            else if (origin == SeekOrigin.End) next = _length + offset;
            if (next < 0) next = 0;
            if (next > _length) next = _length;
            _pos = next;
            return _pos;
        }

        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }

    private struct PayloadSlice
    {
        public bool HasPayload;
        public long Offset;
        public long Length;
    }

    private static PayloadSlice InspectSelfPayload(string exePath)
    {
        PayloadSlice slice = new PayloadSlice();
        using (FileStream fs = File.OpenRead(exePath))
        {
            if (fs.Length < 24) return slice;
            fs.Seek(-24, SeekOrigin.End);
            byte[] footer = new byte[24];
            if (fs.Read(footer, 0, 24) != 24) return slice;
            string sig = Encoding.ASCII.GetString(footer, 16, 8);
            if (!string.Equals(sig, Magic, StringComparison.Ordinal)) return slice;
            long offset = BitConverter.ToInt64(footer, 0);
            long length = BitConverter.ToInt64(footer, 8);
            if (offset <= 0 || length <= 0 || offset + length != fs.Length - 24) return slice;
            slice.HasPayload = true;
            slice.Offset = offset;
            slice.Length = length;
            return slice;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        string selfExe = Assembly.GetEntryAssembly().Location;
        PayloadSlice slice = InspectSelfPayload(selfExe);

        bool silent = false;
        bool explicitUninstall = false;
        bool repair = false;
        bool desktopShortcut = true;
        bool startMenuShortcut = true;
        bool associateFiles = true;
        bool launchAfter = true;
        bool explicitDir = false;
        string targetDir = DefaultInstallDir();
        string regRoot = "";

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase)) explicitUninstall = true;
            else if (string.Equals(a, "--repair", StringComparison.OrdinalIgnoreCase)) repair = true;
            else if (string.Equals(a, "--no-shortcuts", StringComparison.OrdinalIgnoreCase)) { desktopShortcut = false; startMenuShortcut = false; }
            else if (string.Equals(a, "--no-assoc", StringComparison.OrdinalIgnoreCase)) associateFiles = false;
            else if (string.Equals(a, "--no-launch", StringComparison.OrdinalIgnoreCase)) launchAfter = false;
            else if (string.Equals(a, "--dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { targetDir = Path.GetFullPath(args[++i]); explicitDir = true; }
            else if (string.Equals(a, "--reg-root", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) regRoot = args[++i];
        }

        RegPaths regPaths = new RegPaths(regRoot);

        if (repair)
        {
            string installRoot = explicitDir ? targetDir : Path.GetDirectoryName(selfExe);
            return RunRepair(installRoot, selfExe, slice, silent, desktopShortcut, startMenuShortcut, associateFiles, regPaths);
        }

        bool uninstall = explicitUninstall || !slice.HasPayload;
        if (uninstall)
        {
            string installRoot = Path.GetDirectoryName(selfExe);
            if (!silent && args.Length == 0 && !File.Exists(Path.Combine(installRoot, "install-manifest.json")))
            {
                MessageBox.Show("此安装程序未包含安装包数据，无法单独安装。", "投影预览", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            return RunUninstall(installRoot, silent, desktopShortcut || startMenuShortcut, regPaths);
        }

        if (silent)
        {
            try
            {
                InstallOptions opts = new InstallOptions
                {
                    SelfExe = selfExe,
                    Slice = slice,
                    TargetDir = targetDir,
                    DesktopShortcut = desktopShortcut,
                    StartMenuShortcut = startMenuShortcut,
                    AssociateFiles = associateFiles,
                    RegPaths = regPaths,
                };
                PerformInstall(opts, null);
                if (launchAfter && File.Exists(Path.Combine(targetDir, "投影预览.exe")))
                {
                    Process.Start(new ProcessStartInfo(Path.Combine(targetDir, "投影预览.exe")) { WorkingDirectory = targetDir });
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                return 2;
            }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm(selfExe, slice, targetDir, regPaths));
        return 0;
    }

    private static string DefaultInstallDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\投影预览");
    }

    private sealed class InstallOptions
    {
        public string SelfExe;
        public PayloadSlice Slice;
        public string TargetDir;
        public bool DesktopShortcut;
        public bool StartMenuShortcut;
        public bool AssociateFiles;
        public RegPaths RegPaths;
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        try { return Path.GetFullPath(path.Trim()).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar); }
        catch (Exception) { return ""; }
    }

    private static bool PathsEqual(string a, string b)
    {
        string na = NormalizePath(a);
        string nb = NormalizePath(b);
        return !string.IsNullOrEmpty(na) && string.Equals(na, nb, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPathUnderRoot(string candidatePath, string rootDir)
    {
        string cand = NormalizePath(candidatePath);
        string root = NormalizePath(rootDir);
        if (string.IsNullOrEmpty(cand) || string.IsNullOrEmpty(root)) return false;
        if (string.Equals(cand, root, StringComparison.OrdinalIgnoreCase)) return true;
        return cand.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static string ExtractExeFromCommand(string command)
    {
        if (string.IsNullOrWhiteSpace(command)) return "";
        string s = command.Trim();
        if (s.StartsWith("\"", StringComparison.Ordinal))
        {
            int end = s.IndexOf('"', 1);
            return end > 1 ? s.Substring(1, end - 1) : "";
        }
        int exeIdx = s.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        if (exeIdx >= 0) return s.Substring(0, exeIdx + 4).Trim();
        int sp = s.IndexOf(' ');
        return sp > 0 ? s.Substring(0, sp) : s;
    }

    private static string ResolveInstalledVersion(string installDir)
    {
        try
        {
            var ser = new JavaScriptSerializer();
            string manifestPath = Path.Combine(installDir, "install-manifest.json");
            if (File.Exists(manifestPath))
            {
                var m = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath, Encoding.UTF8));
                if (m != null)
                {
                    string v = m.ContainsKey("installedVersion") ? Convert.ToString(m["installedVersion"]) : "";
                    if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
                    v = m.ContainsKey("displayVersion") ? Convert.ToString(m["displayVersion"]) : "";
                    if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
                }
            }
            string pkgPath = Path.Combine(installDir, @"webapp\package.json");
            if (File.Exists(pkgPath))
            {
                var pkg = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(pkgPath, Encoding.UTF8));
                if (pkg != null && pkg.ContainsKey("version"))
                {
                    string v = Convert.ToString(pkg["version"]);
                    if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
                }
            }
        }
        catch (Exception) { }
        return SetupMeta.Display;
    }

    private static long ComputeDirectorySizeKb(string dir)
    {
        long bytes = 0;
        try
        {
            foreach (string sub in new[] { "bin", "runtime", "assets", "webapp" })
            {
                string full = Path.Combine(dir, sub);
                if (!Directory.Exists(full)) continue;
                foreach (string file in Directory.GetFiles(full, "*", SearchOption.AllDirectories))
                {
                    try { bytes += new FileInfo(file).Length; } catch (Exception) { }
                }
            }
        }
        catch (Exception) { }
        return Math.Max(1, bytes / 1024);
    }

    private static void StopProcessesUnderDir(string dir)
    {
        string prefix = dir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (string procName in new[] { "投影预览", "electron", "java" })
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName(procName))
                {
                    try
                    {
                        string exe = p.MainModule != null ? p.MainModule.FileName : "";
                        if (!string.IsNullOrEmpty(exe) && exe.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        {
                            p.Kill();
                            p.WaitForExit(5000);
                        }
                    }
                    catch (Exception) { }
                    finally { p.Dispose(); }
                }
            }
            catch (Exception) { }
        }
    }

    private static void EnsureDirWritable(string dir)
    {
        Directory.CreateDirectory(dir);
        string probe = Path.Combine(dir, ".write-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllText(probe, "ok");
        File.Delete(probe);
    }

    private static void PerformInstall(InstallOptions opts, Action<int, int, string> onProgress)
    {
        string destRoot = Path.GetFullPath(opts.TargetDir);
        EnsureDirWritable(destRoot);
        StopProcessesUnderDir(destRoot);

        string destPrefix = destRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        long extractedBytes = 0;
        using (FileStream fs = File.OpenRead(opts.SelfExe))
        using (SubStream sub = new SubStream(fs, opts.Slice.Offset, opts.Slice.Length))
        using (ZipArchive archive = new ZipArchive(sub, ZipArchiveMode.Read))
        {
            int total = archive.Entries.Count;
            int done = 0;
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                done++;
                if (string.IsNullOrEmpty(entry.FullName) || entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                {
                    if (onProgress != null) onProgress(done, total, entry.FullName);
                    continue;
                }
                string rel = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string target = Path.GetFullPath(Path.Combine(destRoot, rel));
                if (!target.StartsWith(destPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("安装包路径越界: " + entry.FullName);
                }
                string parent = Path.GetDirectoryName(target);
                if (!Directory.Exists(parent)) Directory.CreateDirectory(parent);
                entry.ExtractToFile(target, true);
                extractedBytes += Math.Max(0, entry.Length);
                if (onProgress != null && (done % 25 == 0 || done == total))
                {
                    onProgress(done, total, rel);
                }
            }
        }

        // Write clean stub EXE (header .. payloadOffset) as uninstaller executable
        string uninstallerExe = Path.Combine(destRoot, "卸载投影预览.exe");
        using (FileStream src = File.OpenRead(opts.SelfExe))
        using (FileStream dst = File.Create(uninstallerExe))
        {
            byte[] buf = new byte[65536];
            long remaining = opts.Slice.Offset;
            while (remaining > 0)
            {
                int r = src.Read(buf, 0, (int)Math.Min(buf.Length, remaining));
                if (r <= 0) break;
                dst.Write(buf, 0, r);
                remaining -= r;
            }
        }

        // Clear any stale pending patch marker when reinstalling cleanly
        try
        {
            string pending = Path.Combine(destRoot, @"updates\pending-update.json");
            if (File.Exists(pending)) File.Delete(pending);
        }
        catch (Exception) { }

        // Write installer distribution manifest (never shipped inside portable ZIP)
        var manifest = new Dictionary<string, object>
        {
            { "distribution", "installer" },
            { "installedVersion", SetupMeta.Version },
            { "displayVersion", SetupMeta.Display },
            { "runtimeSignature", SetupMeta.RuntimeSignature },
            { "repo", SetupMeta.Repo },
            { "installDir", destRoot },
            { "installedAt", DateTime.UtcNow.ToString("o") },
        };
        var ser = new JavaScriptSerializer();
        File.WriteAllText(Path.Combine(destRoot, "install-manifest.json"), ser.Serialize(manifest), new UTF8Encoding(false));

        RegPaths paths = opts.RegPaths ?? new RegPaths("");
        long estimatedKb = Math.Max(1, extractedBytes / 1024);
        RegisterInstallIntegration(destRoot, uninstallerExe, SetupMeta.Display, estimatedKb,
            opts.DesktopShortcut, opts.StartMenuShortcut, opts.AssociateFiles, paths);
    }

    private static void RegisterInstallIntegration(string destRoot, string uninstallerExe, string displayVersion,
        long estimatedKb, bool desktopShortcut, bool startMenuShortcut, bool associateFiles, RegPaths paths)
    {
        string appExe = Path.Combine(destRoot, "投影预览.exe");
        if (paths.IsRealSystem && desktopShortcut)
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            CreateShortcut(Path.Combine(desktop, "投影预览.lnk"), appExe, destRoot, "Minecraft Litematica 投影查看与导出");
        }
        if (paths.IsRealSystem && startMenuShortcut)
        {
            string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "投影预览");
            Directory.CreateDirectory(programs);
            CreateShortcut(Path.Combine(programs, "投影预览.lnk"), appExe, destRoot, "Minecraft Litematica 投影查看与导出");
            CreateShortcut(Path.Combine(programs, "卸载 投影预览.lnk"), uninstallerExe, destRoot, "卸载 投影预览", "--uninstall");
        }
        if (associateFiles)
        {
            RegisterFileAssociations(paths, appExe);
        }
        RegisterUninstallEntry(paths, destRoot, appExe, uninstallerExe, displayVersion, estimatedKb);
    }

    private static void CreateShortcut(string lnkPath, string targetExe, string workingDir, string description, string arguments = "")
    {
        dynamic shell = null;
        dynamic shortcut = null;
        try
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            shell = Activator.CreateInstance(shellType);
            shortcut = shell.CreateShortcut(lnkPath);
            shortcut.TargetPath = targetExe;
            shortcut.WorkingDirectory = workingDir;
            shortcut.IconLocation = targetExe + ",0";
            shortcut.Description = description;
            if (!string.IsNullOrEmpty(arguments)) shortcut.Arguments = arguments;
            shortcut.Save();
        }
        finally
        {
            if (shortcut != null) { try { Marshal.FinalReleaseComObject(shortcut); } catch { } }
            if (shell != null) { try { Marshal.FinalReleaseComObject(shell); } catch { } }
        }
    }

    private static string GetShortcutTargetPath(string lnkPath)
    {
        if (!File.Exists(lnkPath)) return "";
        dynamic shell = null;
        dynamic shortcut = null;
        try
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return "";
            shell = Activator.CreateInstance(shellType);
            shortcut = shell.CreateShortcut(lnkPath);
            return Convert.ToString(shortcut.TargetPath) ?? "";
        }
        catch (Exception) { return ""; }
        finally
        {
            if (shortcut != null) { try { Marshal.FinalReleaseComObject(shortcut); } catch { } }
            if (shell != null) { try { Marshal.FinalReleaseComObject(shell); } catch { } }
        }
    }

    private static void RegisterUninstallEntry(RegPaths paths, string installDir, string appExe, string uninstallerExe, string displayVersion, long estimatedKb)
    {
        string version = string.IsNullOrWhiteSpace(displayVersion) ? SetupMeta.Display : displayVersion;
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(paths.UninstallSubKey))
        {
            key.SetValue("DisplayName", "投影预览");
            key.SetValue("DisplayVersion", version);
            key.SetValue("Publisher", "LiteKinda");
            key.SetValue("DisplayIcon", appExe + ",0");
            key.SetValue("InstallLocation", installDir);
            key.SetValue("UninstallString", "\"" + uninstallerExe + "\" --uninstall");
            key.SetValue("QuietUninstallString", "\"" + uninstallerExe + "\" --uninstall --silent");
            key.SetValue("EstimatedSize", (int)Math.Max(1, Math.Min(int.MaxValue, estimatedKb)), RegistryValueKind.DWord);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    private static void RegisterFileAssociations(RegPaths paths, string appExe)
    {
        string[] exts = new[] { ".litematic", ".nbt", ".schem" };
        using (RegistryKey prog = Registry.CurrentUser.CreateSubKey(paths.ClassesRoot + @"\" + ProgId))
        {
            prog.SetValue("", "Minecraft 投影或结构文件");
            prog.SetValue("FriendlyTypeName", "Minecraft 投影或结构文件");
            using (RegistryKey icon = prog.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + appExe + "\",0");
            using (RegistryKey openKey = prog.CreateSubKey(@"shell\open"))
            {
                openKey.SetValue("FriendlyAppName", "投影预览");
                using (RegistryKey cmd = openKey.CreateSubKey("command")) cmd.SetValue("", "\"" + appExe + "\" \"%1\"");
            }
        }
        using (RegistryKey appReg = Registry.CurrentUser.CreateSubKey(paths.ClassesRoot + @"\Applications\投影预览.exe"))
        {
            appReg.SetValue("FriendlyAppName", "投影预览");
            using (RegistryKey icon = appReg.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + appExe + "\",0");
            using (RegistryKey cmd = appReg.CreateSubKey(@"shell\open\command")) cmd.SetValue("", "\"" + appExe + "\" \"%1\"");
            using (RegistryKey sup = appReg.CreateSubKey("SupportedTypes"))
            {
                foreach (string ext in exts) sup.SetValue(ext, "");
            }
        }
        using (RegistryKey cap = Registry.CurrentUser.CreateSubKey(paths.CapabilitiesSubKey))
        {
            cap.SetValue("ApplicationName", "投影预览");
            cap.SetValue("ApplicationDescription", "Minecraft Litematica 投影三维预览、双视角展示图导出与微时序实验工具");
            using (RegistryKey fa = cap.CreateSubKey("FileAssociations"))
            {
                foreach (string ext in exts) fa.SetValue(ext, ProgId);
            }
        }
        using (RegistryKey regApps = Registry.CurrentUser.CreateSubKey(paths.RegisteredAppsSubKey))
        {
            regApps.SetValue(RegisteredAppName, paths.CapabilitiesSubKey);
        }
        foreach (string ext in exts)
        {
            using (RegistryKey extKey = Registry.CurrentUser.CreateSubKey(paths.ClassesRoot + @"\" + ext))
            {
                extKey.SetValue("", ProgId);
                using (RegistryKey owp = extKey.CreateSubKey("OpenWithProgids")) owp.SetValue(ProgId, "");
            }
        }
        if (paths.IsRealSystem) SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
    }

    private static int RunRepair(string installRoot, string selfExe, PayloadSlice slice, bool silent,
        bool desktopShortcut, bool startMenuShortcut, bool associateFiles, RegPaths paths)
    {
        string normalizedRoot = NormalizePath(installRoot);
        string appExe = Path.Combine(normalizedRoot, "投影预览.exe");
        if (string.IsNullOrEmpty(normalizedRoot) || !File.Exists(appExe))
        {
            string msg = "未在指定目录找到「投影预览.exe」，无法修复系统注册：\r\n" + installRoot;
            if (!silent) MessageBox.Show(msg, "投影预览 — 修复失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else Console.Error.WriteLine(msg);
            return 1;
        }

        string uninstallerExe = Path.Combine(normalizedRoot, "卸载投影预览.exe");
        if (!File.Exists(uninstallerExe) && slice.HasPayload)
        {
            using (FileStream src = File.OpenRead(selfExe))
            using (FileStream dst = File.Create(uninstallerExe))
            {
                byte[] buf = new byte[65536];
                long remaining = slice.Offset;
                while (remaining > 0)
                {
                    int r = src.Read(buf, 0, (int)Math.Min(buf.Length, remaining));
                    if (r <= 0) break;
                    dst.Write(buf, 0, r);
                    remaining -= r;
                }
            }
        }
        if (!File.Exists(uninstallerExe)) uninstallerExe = selfExe;

        string version = ResolveInstalledVersion(normalizedRoot);
        string manifestPath = Path.Combine(normalizedRoot, "install-manifest.json");
        var ser = new JavaScriptSerializer();
        Dictionary<string, object> manifest = null;
        if (File.Exists(manifestPath))
        {
            try { manifest = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath, Encoding.UTF8)); }
            catch (Exception) { }
        }
        if (manifest == null) manifest = new Dictionary<string, object>();
        manifest["distribution"] = "installer";
        manifest["installedVersion"] = version;
        manifest["displayVersion"] = version;
        if (!manifest.ContainsKey("runtimeSignature")) manifest["runtimeSignature"] = SetupMeta.RuntimeSignature;
        if (!manifest.ContainsKey("repo")) manifest["repo"] = SetupMeta.Repo;
        manifest["installDir"] = normalizedRoot;
        if (!manifest.ContainsKey("installedAt")) manifest["installedAt"] = DateTime.UtcNow.ToString("o");
        File.WriteAllText(manifestPath, ser.Serialize(manifest), new UTF8Encoding(false));

        long estimatedKb = ComputeDirectorySizeKb(normalizedRoot);
        RegisterInstallIntegration(normalizedRoot, uninstallerExe, version, estimatedKb,
            desktopShortcut, startMenuShortcut, associateFiles, paths);

        if (!silent)
        {
            MessageBox.Show("已修复「投影预览」的应用注册、默认文件关联与快捷方式。", "修复完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        return 0;
    }

    private static string ReadRegistryDefaultValue(string subKey)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(subKey, false))
            {
                return k != null ? Convert.ToString(k.GetValue("")) ?? "" : "";
            }
        }
        catch (Exception) { return ""; }
    }

    private static int RunUninstall(string installRoot, bool silent, bool removeShortcuts, RegPaths paths)
    {
        if (!silent)
        {
            DialogResult res = MessageBox.Show(
                "确定要卸载「投影预览」吗？\r\n安装目录：" + installRoot,
                "卸载 投影预览",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (res != DialogResult.Yes) return 0;
        }

        StopProcessesUnderDir(installRoot);

        // 只清理归属于当前安装目录的注册表项和快捷方式，避免多目录/测试卸载误删现役安装。
        bool uninstallOwned = false;
        try
        {
            using (RegistryKey uk = Registry.CurrentUser.OpenSubKey(paths.UninstallSubKey, false))
            {
                if (uk != null)
                {
                    string installLoc = Convert.ToString(uk.GetValue("InstallLocation")) ?? "";
                    string uninstCmd = Convert.ToString(uk.GetValue("UninstallString")) ?? "";
                    uninstallOwned = !string.IsNullOrWhiteSpace(installLoc)
                        ? PathsEqual(installLoc, installRoot)
                        : IsPathUnderRoot(ExtractExeFromCommand(uninstCmd), installRoot);
                }
            }
        }
        catch (Exception) { }

        if (uninstallOwned)
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(paths.UninstallSubKey, false); } catch (Exception) { }
        }

        string progCmd = ReadRegistryDefaultValue(paths.ClassesRoot + @"\" + ProgId + @"\shell\open\command");
        string progExe = ExtractExeFromCommand(progCmd);
        bool progOwned = !string.IsNullOrEmpty(progExe) ? IsPathUnderRoot(progExe, installRoot) : uninstallOwned;

        if (progOwned)
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(paths.ClassesRoot + @"\" + ProgId, false); } catch (Exception) { }
            foreach (string ext in new[] { ".litematic", ".nbt", ".schem" })
            {
                try
                {
                    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(paths.ClassesRoot + @"\" + ext, true))
                    {
                        if (k != null && string.Equals(Convert.ToString(k.GetValue("")), ProgId, StringComparison.Ordinal))
                        {
                            k.DeleteValue("", false);
                        }
                    }
                    using (RegistryKey owp = Registry.CurrentUser.OpenSubKey(paths.ClassesRoot + @"\" + ext + @"\OpenWithProgids", true))
                    {
                        if (owp != null) owp.DeleteValue(ProgId, false);
                    }
                }
                catch (Exception) { }
            }
            try
            {
                using (RegistryKey regApps = Registry.CurrentUser.OpenSubKey(paths.RegisteredAppsSubKey, true))
                {
                    if (regApps != null && PathsEqual(Convert.ToString(regApps.GetValue(RegisteredAppName)), paths.CapabilitiesSubKey))
                    {
                        regApps.DeleteValue(RegisteredAppName, false);
                    }
                }
                Registry.CurrentUser.DeleteSubKeyTree(paths.CapabilitiesSubKey, false);
            }
            catch (Exception) { }
            if (paths.IsRealSystem) SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
        }

        string appCmd = ReadRegistryDefaultValue(paths.ClassesRoot + @"\Applications\投影预览.exe\shell\open\command");
        string appRegExe = ExtractExeFromCommand(appCmd);
        if ((!string.IsNullOrEmpty(appRegExe) && IsPathUnderRoot(appRegExe, installRoot)) || (string.IsNullOrEmpty(appRegExe) && progOwned))
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(paths.ClassesRoot + @"\Applications\投影预览.exe", false); } catch (Exception) { }
        }

        if (paths.IsRealSystem && removeShortcuts)
        {
            try
            {
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "投影预览.lnk");
                if (IsPathUnderRoot(GetShortcutTargetPath(desktopLnk), installRoot)) File.Delete(desktopLnk);

                string startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "投影预览");
                string startAppLnk = Path.Combine(startDir, "投影预览.lnk");
                string startUninstLnk = Path.Combine(startDir, "卸载 投影预览.lnk");
                if (IsPathUnderRoot(GetShortcutTargetPath(startAppLnk), installRoot) ||
                    IsPathUnderRoot(GetShortcutTargetPath(startUninstLnk), installRoot))
                {
                    if (Directory.Exists(startDir)) Directory.Delete(startDir, true);
                }
            }
            catch (Exception) { }
        }

        // Defer folder cleanup until after uninstaller exe exits cleanly
        try
        {
            string tempDir = Path.GetTempPath();
            string cleanCmd = "/c timeout /t 2 /nobreak >nul & rmdir /s /q \"" + installRoot + "\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cleanCmd)
            {
                WorkingDirectory = tempDir,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
        }
        catch (Exception) { }

        if (!silent)
        {
            MessageBox.Show("「投影预览」已卸载完成。", "卸载完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        return 0;
    }

    private sealed class SetupForm : Form
    {
        private readonly string _selfExe;
        private readonly PayloadSlice _slice;
        private readonly RegPaths _regPaths;
        private readonly TextBox _dirBox;
        private readonly CheckBox _chkDesktop;
        private readonly CheckBox _chkStartMenu;
        private readonly CheckBox _chkAssoc;
        private readonly CheckBox _chkLaunch;
        private readonly ProgressBar _progress;
        private readonly Label _status;
        private readonly Button _installBtn;
        private readonly Button _browseBtn;

        public SetupForm(string selfExe, PayloadSlice slice, string initialDir, RegPaths regPaths)
        {
            _selfExe = selfExe;
            _slice = slice;
            _regPaths = regPaths ?? new RegPaths("");

            Text = "投影预览 " + SetupMeta.Display + " 安装向导";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 340);
            BackColor = Color.FromArgb(24, 24, 26);
            ForeColor = Color.FromArgb(240, 240, 242);
            Font = new Font("Microsoft YaHei UI", 9F);
            try { Icon = Icon.ExtractAssociatedIcon(selfExe); } catch { }

            Label title = new Label
            {
                Text = "投影预览 " + SetupMeta.Display,
                Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold),
                Location = new Point(20, 16),
                AutoSize = true,
                ForeColor = Color.White,
            };
            Label sub = new Label
            {
                Text = "安装版支持应用内检测并自动校验增量补丁更新（更新时不丢失设置与导出目录）。",
                Location = new Point(20, 46),
                Size = new Size(480, 24),
                ForeColor = Color.FromArgb(170, 174, 184),
            };
            Label dirLabel = new Label { Text = "安装位置：", Location = new Point(20, 82), AutoSize = true };
            _dirBox = new TextBox
            {
                Text = initialDir,
                Location = new Point(20, 104),
                Size = new Size(388, 24),
                BackColor = Color.FromArgb(34, 35, 40),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
            };
            _browseBtn = new Button
            {
                Text = "浏览…",
                Location = new Point(416, 102),
                Size = new Size(84, 28),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(49, 50, 58),
                ForeColor = Color.White,
            };
            _browseBtn.FlatAppearance.BorderColor = Color.FromArgb(80, 82, 92);
            _browseBtn.Click += delegate
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.SelectedPath = _dirBox.Text;
                    fbd.Description = "选择「投影预览」安装目录";
                    if (fbd.ShowDialog(this) == DialogResult.OK)
                    {
                        string chosen = fbd.SelectedPath;
                        if (!chosen.EndsWith("投影预览", StringComparison.OrdinalIgnoreCase))
                        {
                            chosen = Path.Combine(chosen, "投影预览");
                        }
                        _dirBox.Text = chosen;
                    }
                }
            };

            _chkDesktop = new CheckBox { Text = "创建桌面快捷方式", Checked = true, Location = new Point(22, 142), AutoSize = true };
            _chkStartMenu = new CheckBox { Text = "创建「开始」菜单快捷方式", Checked = true, Location = new Point(22, 168), AutoSize = true };
            _chkAssoc = new CheckBox { Text = "关联 .litematic / .nbt / .schem 文件（双击直接打开）", Checked = true, Location = new Point(22, 194), AutoSize = true };
            _chkLaunch = new CheckBox { Text = "安装完成后立即启动 投影预览", Checked = true, Location = new Point(22, 220), AutoSize = true };

            _progress = new ProgressBar { Location = new Point(20, 254), Size = new Size(480, 18), Minimum = 0, Maximum = 100 };
            _status = new Label { Text = "准备就绪。", Location = new Point(20, 278), Size = new Size(340, 22), ForeColor = Color.FromArgb(165, 170, 180) };

            _installBtn = new Button
            {
                Text = "开始安装",
                Location = new Point(390, 294),
                Size = new Size(110, 32),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(60, 133, 39),
                ForeColor = Color.White,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
            };
            _installBtn.FlatAppearance.BorderColor = Color.FromArgb(90, 196, 63);
            _installBtn.Click += async delegate { await StartInstallAsync(); };

            Controls.AddRange(new Control[] { title, sub, dirLabel, _dirBox, _browseBtn, _chkDesktop, _chkStartMenu, _chkAssoc, _chkLaunch, _progress, _status, _installBtn });
        }

        private async Task StartInstallAsync()
        {
            string targetDir = (_dirBox.Text ?? "").Trim();
            if (string.IsNullOrEmpty(targetDir))
            {
                MessageBox.Show(this, "请指定有效的安装目录。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _installBtn.Enabled = false;
            _browseBtn.Enabled = false;
            _dirBox.Enabled = false;
            _status.Text = "正在写入文件…";

            InstallOptions opts = new InstallOptions
            {
                SelfExe = _selfExe,
                Slice = _slice,
                TargetDir = targetDir,
                DesktopShortcut = _chkDesktop.Checked,
                StartMenuShortcut = _chkStartMenu.Checked,
                AssociateFiles = _chkAssoc.Checked,
                RegPaths = _regPaths,
            };
            try
            {
                await Task.Run(delegate
                {
                    PerformInstall(opts, delegate(int done, int total, string rel)
                    {
                        int pct = total > 0 ? Math.Min(100, (int)(done * 100L / total)) : 0;
                        try
                        {
                            BeginInvoke((Action)delegate
                            {
                                _progress.Value = pct;
                                _status.Text = "正在安装 (" + done + "/" + total + ") " + Path.GetFileName(rel);
                            });
                        }
                        catch (Exception) { }
                    });
                });
                _progress.Value = 100;
                _status.Text = "安装完成！";
                if (_chkLaunch.Checked)
                {
                    string exe = Path.Combine(targetDir, "投影预览.exe");
                    if (File.Exists(exe)) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = targetDir });
                }
                else
                {
                    MessageBox.Show(this, "安装成功！可从桌面或开始菜单启动「投影预览」。", "安装完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                Close();
            }
            catch (Exception ex)
            {
                _installBtn.Enabled = true;
                _browseBtn.Enabled = true;
                _dirBox.Enabled = true;
                _status.Text = "安装失败：" + ex.Message;
                MessageBox.Show(this, "安装失败：\r\n" + ex.Message, "安装错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
