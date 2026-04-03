import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = ".jizzrug-cache";

function contentHash(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function cacheDir(outDir) {
  return path.join(outDir, CACHE_DIR);
}

function cachePath(outDir, sourcePath) {
  const key = sourcePath.replaceAll(path.sep, "__");
  return path.join(cacheDir(outDir), key + ".hash");
}

export function isCached(sourcePath, outDir) {
  const hashFile = cachePath(outDir, sourcePath);
  if (!fs.existsSync(hashFile)) return false;
  try {
    const stored = fs.readFileSync(hashFile, "utf8").trim();
    const current = contentHash(fs.readFileSync(sourcePath, "utf8"));
    return stored === current;
  } catch {
    return false;
  }
}

export function writeCache(sourcePath, outDir) {
  const dir = cacheDir(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(sourcePath, "utf8");
  fs.writeFileSync(cachePath(outDir, sourcePath), contentHash(source), "utf8");
}

export function invalidateCache(sourcePath, outDir) {
  const hashFile = cachePath(outDir, sourcePath);
  try {
    fs.unlinkSync(hashFile);
  } catch {
    // already gone
  }
}

export { contentHash };
