package io.github.litematicrender.serve;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** 内容标识不依赖修改时间、目录顺序或会话对象。 */
final class CacheFingerprint {
    private CacheFingerprint(){}
    private static final ThreadLocal<byte[]> BUFFER=ThreadLocal.withInitial(()->new byte[65536]);
    private static final ThreadLocal<MessageDigest> SHA256=ThreadLocal.withInitial(CacheFingerprint::digest);
    static MessageDigest digest(){try{return MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException e){throw new AssertionError(e);}}
    static String hex(MessageDigest digest){return HexFormat.of().formatHex(digest.digest());}
    static String file(Path file)throws IOException {return file(file,Thread.currentThread());}
    private static String file(Path file,Thread caller)throws IOException {
        var digest=SHA256.get();digest.reset();byte[] buffer=BUFFER.get();
        try(var input=Files.newInputStream(file)){for(int n;(n=input.read(buffer))!=-1;){if(Thread.currentThread().isInterrupted()||caller.isInterrupted())throw new InterruptedIOException("缓存校验已取消");digest.update(buffer,0,n);}}
        return hex(digest);
    }
    static String tree(Path root)throws IOException {
        if(!Files.exists(root))return "absent";
        if(!Files.isDirectory(root))return file(root);
        record Entry(String rel,Path path){}
        List<Entry> files;
        try(var paths=Files.find(root,Integer.MAX_VALUE,(path,attributes)->attributes.isRegularFile()||attributes.isSymbolicLink()&&Files.isRegularFile(path))){
            files=paths.map(p->new Entry(root.relativize(p).toString().replace('\\','/'),p)).sorted(Comparator.comparing(Entry::rel)).toList();
        }
        String[] hashes=new String[files.size()];
        if(files.size()>=64){
            Thread caller=Thread.currentThread();
            try{
                java.util.stream.IntStream.range(0,files.size()).parallel().forEach(i->{
                    try{hashes[i]=file(files.get(i).path(),caller);}catch(IOException e){throw new UncheckedIOException(e);}
                });
            }catch(UncheckedIOException failure){throw failure.getCause();}
        }else{
            for(int i=0;i<files.size();i++)hashes[i]=file(files.get(i).path(),Thread.currentThread());
        }
        var digest=digest();
        for(int i=0;i<files.size();i++){digest.update(files.get(i).rel().getBytes(StandardCharsets.UTF_8));digest.update((byte)0);digest.update(hashes[i].getBytes(StandardCharsets.US_ASCII));}
        return hex(digest);
    }
    static String resources(Path vanilla,List<Path> builtins,List<Path> imports)throws IOException {
        var parts=new ArrayList<String>();parts.add("resources-v1");parts.add(tree(vanilla.resolve("assets")));parts.add(tree(vanilla.resolve("pack.mcmeta")));
        for(Path pack:builtins)parts.add(tree(pack));parts.add("user-packs");for(Path pack:imports)parts.add(tree(pack));return parts(parts.toArray(String[]::new));
    }
    static String parts(String... parts){var digest=digest();for(String part:parts){digest.update(part.getBytes(StandardCharsets.UTF_8));digest.update((byte)0);}return hex(digest);}
}
