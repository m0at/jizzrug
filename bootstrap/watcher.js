import fs from "node:fs";
import path from "node:path";

export function watchDir(dir, extensions, callback) {
  const watchers = [];

  function startWatch(watchPath) {
    try {
      const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (extensions.some((ext) => filename.endsWith(ext))) {
          callback(eventType, path.join(watchPath, filename));
        }
      });
      watchers.push(watcher);
    } catch {
      // directory may not exist yet
    }
  }

  if (Array.isArray(dir)) {
    for (const d of dir) startWatch(d);
  } else {
    startWatch(dir);
  }

  return function close() {
    for (const w of watchers) w.close();
  };
}
