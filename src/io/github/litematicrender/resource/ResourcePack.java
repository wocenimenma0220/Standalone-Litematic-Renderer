package io.github.litematicrender.resource;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** 单个资源包支持目录和 ZIP，统一通过 PackSource 读取命名空间资源。 */
public final class ResourcePack implements AutoCloseable {
    public final String id;
    public final PackSource source;
    public final boolean imported;
    private final Set<String> namespaces = new HashSet<>();
    private final Map<String, byte[]> cache = new HashMap<>();
    private boolean closed;

    private ResourcePack(String id, PackSource source, boolean imported) throws IOException {
        this.id = id;
        this.source = source;
        this.imported = imported;
        this.scanNamespaces();
    }

    public static ResourcePack ofDirectory(String id, Path root) throws IOException {
        return new ResourcePack(id, new DirSource(root), true);
    }

    public static ResourcePack ofZip(String id, Path zipFile) throws IOException {
        return new ResourcePack(id, new ZipSource(zipFile), true);
    }


    public static ResourcePack vanilla(Path vanillaRoot) throws IOException {
        return new ResourcePack("vanilla", new DirSource(vanillaRoot), false);
    }

    private void scanNamespaces() throws IOException {
        this.namespaces.clear();
        List<String> entries = this.source.listEntries("assets/");
        for (String entry : entries) {

            String rest = entry.substring("assets/".length());
            int slash = rest.indexOf('/');
            if (slash > 0) {
                this.namespaces.add(rest.substring(0, slash).toLowerCase(Locale.ROOT));
            }
        }
    }

    public Set<String> namespaces() {
        return Set.copyOf(this.namespaces);
    }

    public boolean hasNamespace(String ns) {
        return this.namespaces.contains(ns.toLowerCase(Locale.ROOT));
    }


    public synchronized byte[] read(String namespace, String path) {
        if (this.closed) return null;
        String key = namespace + ":" + path;
        byte[] cached = this.cache.get(key);
        if (cached != null) return cached;
        String full = "assets/" + namespace + "/" + path;
        byte[] data = this.source.read(full);
        if (data != null) {
            // 大文件不进入内存缓存。
            if (data.length <= 4 * 1024 * 1024) this.cache.put(key, data);
        }
        return data;
    }

    public Optional<byte[]> readOptional(String namespace, String path) {
        byte[] data = this.read(namespace, path);
        return data == null ? Optional.empty() : Optional.of(data);
    }

    public boolean exists(String namespace, String path) {
        return this.read(namespace, path) != null;
    }


    public List<String> listResources(String namespace, String dir, String suffix) {
        List<String> result = new ArrayList<>();
        String prefix = "assets/" + namespace + "/" + (dir.isEmpty() ? "" : dir + "/");
        for (String entry : this.source.listEntries(prefix)) {
            if (entry.startsWith(prefix) && (suffix == null || entry.endsWith(suffix))) {
                result.add(entry.substring(prefix.length()));
            }
        }
        return result;
    }


    public List<String[]> listAllNamespaced(String dir, String suffix) {
        Map<String, List<String>> byNs = new LinkedHashMap<>();
        for (String entry : this.source.listEntries("assets/")) {
            String rest = entry.substring("assets/".length());
            int slash = rest.indexOf('/');
            if (slash <= 0) continue;
            String ns = rest.substring(0, slash).toLowerCase(Locale.ROOT);
            String rel = rest.substring(slash + 1);
            if (!rel.startsWith(dir + "/")) continue;
            if (suffix != null && !rel.endsWith(suffix)) continue;
            byNs.computeIfAbsent(ns, k -> new ArrayList<>()).add(rel);
        }
        List<String[]> result = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : byNs.entrySet()) {
            for (String rel : e.getValue()) result.add(new String[]{e.getKey(), rel});
        }
        return result;
    }

    public String packDescription() {
        return this.id;
    }

    @Override
    public synchronized void close() {
        this.closed = true;
        this.cache.clear();
        try {
            this.source.close();
        } catch (IOException ignored) {}
    }

    // ------------------------------------------------------------------
    public interface PackSource extends AutoCloseable {
        byte[] read(String path);
        List<String> listEntries(String prefix);
        @Override void close() throws IOException;
    }

    private static final class DirSource implements PackSource {
        private final Path root;
        private List<String> assetEntries;

        DirSource(Path root) { this.root = root; }

        @Override
        public byte[] read(String path) {
            try {
                Path file = this.root.resolve(path);
                if (Files.isRegularFile(file)) {
                    return Files.readAllBytes(file);
                }
            } catch (IOException ignored) {}
            return null;
        }

        @Override
        public List<String> listEntries(String prefix) {
            // 资源包是会话快照；重新加载时重新验证内容指纹，包括新增文件和同元数据修改。

            if(assetEntries!=null&&prefix.equals("assets/"))return assetEntries;
            List<String> result = new ArrayList<>();
            Path base = this.root.resolve(prefix);
            if (!Files.isDirectory(base)) return result;
            // 复用目录遍历得到的文件属性，避免 Windows 下逐文件重复查询。
            try (var stream = Files.find(base, Integer.MAX_VALUE, (file, attributes) -> attributes.isRegularFile()
                    || attributes.isSymbolicLink() && Files.isRegularFile(file))) {
                stream.forEach(file -> {
                    String rel = this.root.relativize(file).toString().replace('\\', '/');
                    result.add(rel);
                });
            } catch (IOException ignored) {}
            if(prefix.equals("assets/"))assetEntries=List.copyOf(result);
            return result;
        }

        @Override
        public void close() {assetEntries=null;}
    }

    private static final class ZipSource implements PackSource {
        private final Path zipPath;
        private ZipFile zipFile;
        private boolean failed;

        ZipSource(Path zipPath) { this.zipPath = zipPath; }

        private ZipFile zip() throws IOException {
            if (this.zipFile == null) {
                if (this.failed) throw new IOException("zip failed to load: " + this.zipPath);
                try {
                    this.zipFile = new ZipFile(this.zipPath.toFile());
                } catch (IOException e) {
                    this.failed = true;
                    throw e;
                }
            }
            return this.zipFile;
        }

        @Override
        public byte[] read(String path) {
            try {
                ZipEntry entry = this.zip().getEntry(path);
                if (entry == null) return null;
                try (InputStream in = this.zipFile.getInputStream(entry)) {
                    return in.readAllBytes();
                }
            } catch (IOException e) {
                return null;
            }
        }

        @Override
        public List<String> listEntries(String prefix) {
            List<String> result = new ArrayList<>();
            try {
                ZipFile zf = this.zip();
                Enumeration<? extends ZipEntry> entries = zf.entries();
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    if (entry.isDirectory()) continue;
                    String name = entry.getName().replace('\\', '/');
                    if (name.startsWith(prefix)) result.add(name);
                }
            } catch (IOException ignored) {}
            return result;
        }

        @Override
        public void close() throws IOException {
            if (this.zipFile != null) {
                this.zipFile.close();
                this.zipFile = null;
            }
        }
    }
}
