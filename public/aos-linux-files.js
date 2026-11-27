(function () {
  "use strict";

  if (window.AOS_LINUX_FILES) return;

  var native = Boolean(window.AOS_NATIVE_BRIDGE);
  var syncing = false;
  var lastValue = "";
  var writeSignatures = new Map();
  var timer = 0;

  function readFiles() {
    try {
      var value = JSON.parse(localStorage.getItem("aos-files") || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function saveFiles(files) {
    syncing = true;
    localStorage.setItem("aos-files", JSON.stringify(files));
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("aos-files-change"));
    syncing = false;
  }

  function signature(file) {
    var content = String(file.content == null ? "" : file.content);
    return [file.name, file.type, file.parent, content.length, content.slice(0, 96), content.slice(-96)].join("|");
  }

  function eligible(file, files, depth) {
    if (!file || file.__deletedAt || /^os-/i.test(String(file.id || ""))) return false;
    if (file.nativePath || ["root", "desktop", "documents", "downloads"].includes(String(file.parent || "root"))) return true;
    if (!Array.isArray(files) || (depth || 0) > 12) return false;
    var parent = files.find(function (item) { return item.type === "folder" && String(item.id) === String(file.parent); });
    return Boolean(parent && eligible(parent, files, (depth || 0) + 1));
  }

  function cleanName(value) {
    return String(value || "Untitled").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[ .]+$/g, "").slice(0, 240) || "Untitled";
  }

  function destinationFor(file, files) {
    if (file.nativePath) return file.nativePath;
    var parent = String(file.parent || "root");
    var roots = {root: "Desktop", desktop: "Desktop", documents: "Documents", downloads: "Downloads"};
    if (roots[parent]) return roots[parent] + "/" + cleanName(file.name);
    var folder = files.find(function (item) { return String(item.id) === parent && item.type === "folder"; });
    return folder && folder.nativePath ? folder.nativePath.replace(/\/$/, "") + "/" + cleanName(file.name) : "";
  }

  async function writeFile(file, allFiles) {
    var files = allFiles || readFiles();
    if (!native || !eligible(file, files)) return;
    var nextSignature = signature(file);
    if (writeSignatures.get(String(file.id)) === nextSignature) return;
    var result = await window.AOS_NATIVE_BRIDGE.post("/__aos/files/write", {
      id: String(file.id || ""),
      name: String(file.name || "Untitled"),
      type: file.type === "folder" ? "folder" : "file",
      parent: String(file.parent || "root"),
      nativePath: String(destinationFor(file, files)),
      mime: String(file.mime || "application/octet-stream"),
      content: String(file.content == null ? "" : file.content)
    });
    writeSignatures.set(String(file.id), nextSignature);
    if (result.path && file.nativePath !== result.path) {
      file.nativePath = result.path;
      files = readFiles();
      var target = files.find(function (item) { return String(item.id) === String(file.id); });
      if (target) {
        target.nativePath = result.path;
        saveFiles(files);
      }
    }
  }

  async function syncWrites() {
    if (!native || syncing) return;
    var raw = localStorage.getItem("aos-files") || "[]";
    if (raw === lastValue) return;
    lastValue = raw;
    var allFiles = readFiles();
    var files = allFiles.filter(function (file) { return eligible(file, allFiles); }).sort(function (left, right) {
      return (left.type === "folder" ? 0 : 1) - (right.type === "folder" ? 0 : 1);
    });
    for (var index = 0; index < files.length; index += 1) {
      try { await writeFile(files[index], allFiles); }
      catch (error) { console.warn("A-OS Files could not mirror " + files[index].name + ":", error.message); }
    }
  }

  async function importNativeFiles() {
    if (!native) return [];
    var response = await window.AOS_NATIVE_BRIDGE.request("/__aos/files");
    var incoming = Array.isArray(response.files) ? response.files : [];
    var files = readFiles();
    var byPath = new Map(files.filter(function (file) { return file.nativePath; }).map(function (file) { return [file.nativePath, file]; }));
    incoming.forEach(function (file) {
      var existing = byPath.get(file.nativePath);
      if (existing) Object.assign(existing, file, {id: existing.id});
      else files.push(file);
      writeSignatures.set(String((existing || file).id), signature(existing || file));
    });
    if (incoming.length) saveFiles(files);
    lastValue = "";
    return incoming;
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(syncWrites, 350);
  }

  window.addEventListener("aos-files-change", schedule);
  window.addEventListener("storage", function (event) {
    if (!event.key || event.key === "aos-files") schedule();
  });
  if (native) {
    window.setTimeout(function () {
      importNativeFiles().then(syncWrites).catch(function (error) {
        console.warn("A-OS Linux file integration is unavailable:", error.message);
      });
    }, 1800);
    window.setInterval(schedule, 2500);
  }

  window.AOS_LINUX_FILES = {refresh: importNativeFiles, write: writeFile, get enabled() { return native; }};
})();
