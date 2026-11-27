(function () {
  "use strict";

  if (window.AOS_SCREENSHOT_STUDIO) return;

  var overlay = null;
  var editor = null;
  var editorCanvas = null;
  var editorContext = null;
  var baseImage = null;
  var history = [];
  var drawing = false;
  var lastPoint = null;
  var tool = "brush";

  function icon(name) {
    return new URL("./assets/icons/" + name, document.baseURI).href;
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: message}}));
  }

  function removeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function selectionBounds(start, end) {
    return {
      left: Math.round(Math.min(start.x, end.x)),
      top: Math.round(Math.min(start.y, end.y)),
      width: Math.round(Math.abs(end.x - start.x)),
      height: Math.round(Math.abs(end.y - start.y))
    };
  }

  async function capture(bounds) {
    removeOverlay();
    if (typeof window.html2canvas !== "function") throw new Error("The screenshot engine is still loading. Try Ctrl+S again.");
    await new Promise(function (resolve) { window.requestAnimationFrame(function () { window.requestAnimationFrame(resolve); }); });
    var source = document.querySelector(".desktop") || document.body;
    var sourceBounds = source.getBoundingClientRect();
    var canvas = await window.html2canvas(source, {
      allowTaint: false,
      backgroundColor: null,
      logging: false,
      scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      useCORS: true,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight
    });
    var scaleX = canvas.width / Math.max(1, sourceBounds.width);
    var scaleY = canvas.height / Math.max(1, sourceBounds.height);
    var crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(bounds.width * scaleX));
    crop.height = Math.max(1, Math.round(bounds.height * scaleY));
    crop.getContext("2d").drawImage(
      canvas,
      Math.max(0, Math.round((bounds.left - sourceBounds.left) * scaleX)),
      Math.max(0, Math.round((bounds.top - sourceBounds.top) * scaleY)),
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    );
    openEditor(crop);
  }

  function startSelection() {
    if (overlay || (editor && !editor.hidden)) return;
    overlay = document.createElement("section");
    overlay.className = "aos-screenshot-selector";
    overlay.innerHTML = '<div class="aos-screenshot-help"><img src="' + icon("Screenshot.svg") + '" alt=""><span><b>Select an area</b><small>Drag to crop · Esc to cancel</small></span></div><div class="aos-screenshot-selection" hidden><span></span></div>';
    document.body.appendChild(overlay);
    var box = overlay.querySelector(".aos-screenshot-selection");
    var size = box.querySelector("span");
    var start = null;

    overlay.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      start = {x: event.clientX, y: event.clientY};
      box.hidden = false;
      try { overlay.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    overlay.addEventListener("pointermove", function (event) {
      if (!start) return;
      var bounds = selectionBounds(start, {x: event.clientX, y: event.clientY});
      box.style.left = bounds.left + "px";
      box.style.top = bounds.top + "px";
      box.style.width = bounds.width + "px";
      box.style.height = bounds.height + "px";
      size.textContent = bounds.width + " × " + bounds.height;
    });
    overlay.addEventListener("pointerup", function (event) {
      if (!start) return;
      var bounds = selectionBounds(start, {x: event.clientX, y: event.clientY});
      start = null;
      if (bounds.width < 12 || bounds.height < 12) {
        box.hidden = true;
        return;
      }
      capture(bounds).catch(function (error) {
        removeOverlay();
        window.alert(error.message || String(error));
      });
    });
  }

  function canvasPoint(event) {
    var bounds = editorCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * editorCanvas.width / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) * editorCanvas.height / Math.max(1, bounds.height)
    };
  }

  function snapshot() {
    if (history.length >= 20) history.shift();
    history.push(editorCanvas.toDataURL("image/png"));
  }

  function restore(dataUrl) {
    var image = new Image();
    image.onload = function () {
      editorContext.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
      editorContext.drawImage(image, 0, 0);
    };
    image.src = dataUrl;
  }

  function undo() {
    if (history.length < 2) return;
    history.pop();
    restore(history[history.length - 1]);
  }

  function drawMove(event) {
    if (!drawing || !lastPoint) return;
    var next = canvasPoint(event);
    var colour = editor.querySelector("[data-screenshot-colour]").value;
    var width = Number(editor.querySelector("[data-screenshot-size]").value || 8) * (editorCanvas.width / Math.max(1, editorCanvas.getBoundingClientRect().width));
    editorContext.save();
    editorContext.lineCap = "round";
    editorContext.lineJoin = "round";
    editorContext.lineWidth = Math.max(2, width);
    editorContext.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    editorContext.strokeStyle = colour;
    editorContext.beginPath();
    editorContext.moveTo(lastPoint.x, lastPoint.y);
    editorContext.lineTo(next.x, next.y);
    editorContext.stroke();
    editorContext.restore();
    lastPoint = next;
  }

  function saveToAos(download) {
    var name = "Screenshot " + new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19) + ".png";
    var dataUrl = editorCanvas.toDataURL("image/png");
    var files;
    try { files = JSON.parse(localStorage.getItem("aos-files") || "[]"); } catch (_) { files = []; }
    if (!Array.isArray(files)) files = [];
    files.push({
      id: crypto.randomUUID ? crypto.randomUUID() : "screenshot-" + Date.now(),
      name: name,
      type: "file",
      parent: "downloads",
      content: dataUrl,
      icon: "Images.png",
      mime: "image/png",
      source: "A-OS Screenshot Studio"
    });
    localStorage.setItem("aos-files", JSON.stringify(files));
    window.dispatchEvent(new CustomEvent("aos-files-change"));
    window.dispatchEvent(new Event("storage"));
    if (download) {
      var link = document.createElement("a");
      link.href = dataUrl;
      link.download = name;
      link.click();
    }
    notify(name + " was saved to A-OS Files > Downloads");
  }

  function setTool(next) {
    tool = next;
    editor.querySelectorAll("[data-screenshot-tool]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.screenshotTool === tool));
    });
  }

  function makeDraggable() {
    var titlebar = editor.querySelector(".aos-screenshot-titlebar");
    var drag = null;
    titlebar.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button")) return;
      var bounds = editor.getBoundingClientRect();
      drag = {x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top};
      titlebar.setPointerCapture(event.pointerId);
    });
    titlebar.addEventListener("pointermove", function (event) {
      if (!drag) return;
      editor.style.left = Math.max(0, Math.min(window.innerWidth - 220, drag.left + event.clientX - drag.x)) + "px";
      editor.style.top = Math.max(0, Math.min(window.innerHeight - 80, drag.top + event.clientY - drag.y)) + "px";
      editor.style.transform = "none";
    });
    titlebar.addEventListener("pointerup", function () { drag = null; });
  }

  function ensureEditor() {
    if (editor) return;
    editor = document.createElement("section");
    editor.className = "system-window aos-screenshot-window";
    editor.hidden = true;
    editor.setAttribute("data-app", "Screenshot Studio");
    editor.innerHTML = '<header class="aos-screenshot-titlebar"><img src="' + icon("Screenshot.svg") + '" alt=""><span><b>Screenshot Studio</b><small>Crop and paint</small></span><div class="aos-screenshot-controls"><button type="button" data-screenshot-minimize aria-label="Minimize">−</button><button type="button" data-screenshot-close aria-label="Close">×</button></div></header><div class="aos-screenshot-toolbar"><div class="aos-screenshot-tools"><button type="button" data-screenshot-tool="brush" aria-pressed="true">Brush</button><button type="button" data-screenshot-tool="eraser" aria-pressed="false">Eraser</button><button type="button" data-screenshot-undo>Undo</button></div><label>Colour<input type="color" value="#167fbd" data-screenshot-colour></label><label>Size<input type="range" min="2" max="36" value="8" data-screenshot-size></label><span></span><button type="button" data-screenshot-new>New crop</button><button type="button" class="aos-screenshot-save" data-screenshot-save>Save</button><button type="button" data-screenshot-download>Download</button></div><main class="aos-screenshot-workspace"><div><canvas></canvas></div></main>';
    document.body.appendChild(editor);
    editorCanvas = editor.querySelector("canvas");
    editorContext = editorCanvas.getContext("2d");
    editor.querySelectorAll("[data-screenshot-tool]").forEach(function (button) {
      button.addEventListener("click", function () { setTool(button.dataset.screenshotTool); });
    });
    editor.querySelector("[data-screenshot-undo]").addEventListener("click", undo);
    editor.querySelector("[data-screenshot-save]").addEventListener("click", function () { saveToAos(false); });
    editor.querySelector("[data-screenshot-download]").addEventListener("click", function () { saveToAos(true); });
    editor.querySelector("[data-screenshot-new]").addEventListener("click", function () { editor.hidden = true; startSelection(); });
    editor.querySelector("[data-screenshot-close]").addEventListener("click", function () { editor.hidden = true; });
    editor.querySelector("[data-screenshot-minimize]").addEventListener("click", function () { editor.hidden = true; });
    editorCanvas.addEventListener("pointerdown", function (event) {
      drawing = true;
      lastPoint = canvasPoint(event);
      snapshot();
      try { editorCanvas.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    editorCanvas.addEventListener("pointermove", drawMove);
    editorCanvas.addEventListener("pointerup", function () { drawing = false; lastPoint = null; snapshot(); });
    editorCanvas.addEventListener("pointercancel", function () { drawing = false; lastPoint = null; });
    makeDraggable();
  }

  function openEditor(source) {
    ensureEditor();
    editorCanvas.width = source.width;
    editorCanvas.height = source.height;
    editorContext.clearRect(0, 0, source.width, source.height);
    editorContext.drawImage(source, 0, 0);
    baseImage = source.toDataURL("image/png");
    history = [baseImage];
    editor.hidden = false;
    editor.style.zIndex = String(2147480000);
    setTool("brush");
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && overlay) {
      event.preventDefault();
      removeOverlay();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === "s") {
      event.preventDefault();
      event.stopImmediatePropagation();
      startSelection();
    }
  }, true);

  window.AOS_SCREENSHOT_STUDIO = {capture: startSelection, openEditor: openEditor};
})();
