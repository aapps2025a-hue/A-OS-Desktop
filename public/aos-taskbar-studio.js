(function () {
  "use strict";

  if (window.AOS_TASKBAR_STUDIO) return;

  var LAYOUT_KEY = "aos-taskbar-layout";
  var SIZE_KEY = "aos-taskbar-size";
  var ORDER_KEY = "aos-taskbar-order";
  var SHORTCUTS_KEY = "aos-taskbar-desktop-shortcuts";
  var BROWSER_PINS_KEY = "aos-taskbar-browser-pins";
  var WIDGET_POSITIONS_KEY = "aos-widget-safe-positions";
  var QUICK_ORDER_KEY = "aos-quick-settings-order";
  var QUICK_FILE_PINS_KEY = "aos-quick-settings-file-pins";
  var FILES_LAST_LOCATION_KEY = "aos-files-last-location";
  var LAYOUT_CLASS_PREFIX = "aos-taskbar-layout-";
  var LAYOUTS = [
    {id: "floating-segmented", name: "Floating split"},
    {id: "floating-unified", name: "Floating dock"},
    {id: "wide-segmented", name: "Wide split"},
    {id: "wide-centered", name: "Wide centred"},
    {id: "wide-classic", name: "Wide classic"}
  ];
  var draggingApp = null;
  var pointerSort = null;
  var quickPointerSort = null;
  var pendingFileLocation = null;
  var scheduled = false;
  var resolvingWidgets = false;
  var statusTimer = 0;
  var lastOverlayAnchor = null;
  var lastOverlayAnchorTime = 0;

  function readJson(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
  }

  function taskbarLayout() {
    var saved = localStorage.getItem(LAYOUT_KEY) || "floating-unified";
    return LAYOUTS.some(function (layout) { return layout.id === saved; }) ? saved : "floating-unified";
  }

  function taskbarSize() {
    return clamp(localStorage.getItem(SIZE_KEY) || 68, 52, 96);
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: message}}));
  }

  function shelfAppButtons(shelf) {
    return Array.from(shelf.children).filter(function (item) {
      return item instanceof HTMLButtonElement && item.matches(".shelf-icon, .astore-shelf-button, .aos-filedrop-taskbar") && Boolean(item.getAttribute("aria-label"));
    });
  }

  function shelfControlKey(item) {
    if (!(item instanceof HTMLElement)) return "";
    if (item.matches(".launcher-button")) return "control:launcher";
    if (item.matches(".search-pill")) return "control:search";
    if (item.matches(".status")) return "control:status";
    if (item.matches('[aria-label="AI shortcut"]')) return "control:ai";
    if (item.matches(".shelf-emoji")) return "control:quick";
    if (item.matches(".aos-device-status-corner")) return "control:device-status";
    return "";
  }

  function isShelfApp(item) {
    return item instanceof HTMLButtonElement && item.matches(".shelf-icon, .astore-shelf-button, .aos-filedrop-taskbar") && Boolean(item.getAttribute("aria-label"));
  }

  function shelfItemKey(item) {
    return isShelfApp(item) ? "app:" + item.getAttribute("aria-label") : shelfControlKey(item);
  }

  function shelfReorderItems(shelf) {
    return Array.from(shelf.children).filter(function (item) { return Boolean(shelfItemKey(item)); });
  }

  function iconSource(button) {
    var image = button && button.querySelector("img");
    return image ? image.src : new URL("./assets/icons/OS Logo.png", document.baseURI).href;
  }

  function applyTaskbarOrder(shelf) {
    var saved = readJson(ORDER_KEY, []);
    if (!Array.isArray(saved) || !saved.length) return;
    var items = shelfReorderItems(shelf);
    var original = new Map(items.map(function (item, index) { return [item, index]; }));
    items.sort(function (first, second) {
      var firstIndex = saved.indexOf(shelfItemKey(first));
      var secondIndex = saved.indexOf(shelfItemKey(second));
      if (firstIndex < 0 && isShelfApp(first)) firstIndex = saved.indexOf(first.getAttribute("aria-label"));
      if (secondIndex < 0 && isShelfApp(second)) secondIndex = saved.indexOf(second.getAttribute("aria-label"));
      if (firstIndex < 0) firstIndex = saved.length + original.get(first);
      if (secondIndex < 0) secondIndex = saved.length + original.get(second);
      return firstIndex - secondIndex;
    });
    var current = shelfReorderItems(shelf);
    if (items.every(function (item, index) { return current[index] === item; })) return;
    var anchor = shelf.querySelector(":scope > .aos-taskbar-resize-handle");
    items.forEach(function (item) { shelf.insertBefore(item, anchor || null); });
  }

  function saveTaskbarOrder(shelf) {
    writeJson(ORDER_KEY, shelfReorderItems(shelf).map(shelfItemKey));
  }

  function clearInsertionGap(container) {
    if (!container) return;
    container.querySelectorAll(".aos-insert-before, .aos-insert-after").forEach(function (item) {
      item.classList.remove("aos-insert-before", "aos-insert-after");
    });
  }

  function showInsertionGap(container, target, before) {
    clearInsertionGap(container);
    if (target) target.classList.add(before ? "aos-insert-before" : "aos-insert-after");
  }

  function appFromLabel(label) {
    return Array.from(document.querySelectorAll(".shelf button[aria-label]")).find(function (button) {
      return button.getAttribute("aria-label") === label;
    });
  }

  function readShortcuts() {
    var shortcuts = readJson(SHORTCUTS_KEY, []);
    return Array.isArray(shortcuts) ? shortcuts : [];
  }

  function saveShortcuts(shortcuts) {
    writeJson(SHORTCUTS_KEY, shortcuts.slice(0, 80));
  }

  function rectFromElement(element, desktopRect) {
    var bounds = element.getBoundingClientRect();
    return {
      left: bounds.left - desktopRect.left,
      top: bounds.top - desktopRect.top,
      right: bounds.right - desktopRect.left,
      bottom: bounds.bottom - desktopRect.top,
      width: bounds.width,
      height: bounds.height
    };
  }

  function overlaps(first, second, padding) {
    var gap = Number(padding) || 0;
    return first.left < second.right + gap && first.right + gap > second.left && first.top < second.bottom + gap && first.bottom + gap > second.top;
  }

  function shortcutPosition(desktop, preferredX, preferredY, ignoredId) {
    var desktopRect = desktop.getBoundingClientRect();
    var width = 76;
    var height = 86;
    var reserved = [];
    desktop.querySelectorAll(".desktop-files > button, .desk-shortcut, #aos-desktop-widgets-layer > div, .shelf").forEach(function (element) {
      if (ignoredId && element.dataset && element.dataset.aosTaskbarShortcut === ignoredId) return;
      var rect = rectFromElement(element, desktopRect);
      if (rect.width && rect.height) reserved.push(rect);
    });
    var maximumX = Math.max(8, desktopRect.width - width - 8);
    var maximumY = Math.max(8, desktopRect.height - height - 8);
    var start = {
      left: clamp(Math.round((preferredX - desktopRect.left - width / 2) / 12) * 12, 8, maximumX),
      top: clamp(Math.round((preferredY - desktopRect.top - height / 2) / 12) * 12, 8, maximumY)
    };
    var candidates = [start];
    for (var y = 12; y <= maximumY; y += 18) {
      for (var x = 12; x <= maximumX; x += 18) candidates.push({left: x, top: y});
    }
    return candidates.find(function (candidate) {
      var rect = {left: candidate.left, top: candidate.top, right: candidate.left + width, bottom: candidate.top + height};
      return !reserved.some(function (item) { return overlaps(rect, item, 7); });
    }) || start;
  }

  function createDesktopShortcut(label, icon, clientX, clientY) {
    var desktop = document.querySelector(".desktop");
    if (!desktop || !label) return null;
    var shortcuts = readShortcuts();
    var existing = shortcuts.find(function (shortcut) { return shortcut.label === label; });
    var id = existing ? existing.id : "taskbar-shortcut-" + Date.now().toString(36);
    var position = shortcutPosition(desktop, Number(clientX) || 90, Number(clientY) || 150, id);
    var value = {id: id, label: label, icon: icon || "", x: position.left, y: position.top};
    if (existing) Object.assign(existing, value); else shortcuts.push(value);
    saveShortcuts(shortcuts);
    renderDesktopShortcuts(desktop);
    resolveWidgets();
    notify(label + " was added to the desktop");
    return value;
  }

  function renderDesktopShortcuts(desktop) {
    desktop = desktop || document.querySelector(".desktop");
    if (!desktop) return;
    var container = desktop.querySelector(".desktop-files");
    if (!container) return;
    var shortcuts = readShortcuts();
    container.querySelectorAll(".aos-taskbar-desktop-shortcut").forEach(function (button) {
      if (!shortcuts.some(function (shortcut) { return shortcut.id === button.dataset.aosTaskbarShortcut; })) button.remove();
    });
    shortcuts.forEach(function (shortcut) {
      var button = container.querySelector('[data-aos-taskbar-shortcut="' + CSS.escape(shortcut.id) + '"]');
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "aos-taskbar-desktop-shortcut";
        button.dataset.aosTaskbarShortcut = shortcut.id;
        button.draggable = true;
        button.addEventListener("click", function () {
          var label = button.dataset.aosAppLabel || "App";
          var app = appFromLabel(label);
          if (app) app.click(); else notify(label + " is not available on this desktop");
        });
        button.addEventListener("dragstart", function (event) {
          draggingApp = {label: button.dataset.aosAppLabel, icon: button.dataset.aosAppIcon, source: null, shortcutId: button.dataset.aosTaskbarShortcut};
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData("text/x-aos-app", button.dataset.aosAppLabel);
        });
        button.addEventListener("dragend", function () { draggingApp = null; });
        button.innerHTML = '<span><img alt=""></span><b></b>';
        container.appendChild(button);
      }
      button.dataset.aosAppLabel = shortcut.label;
      button.dataset.aosAppIcon = shortcut.icon || "";
      button.setAttribute("aria-label", shortcut.label);
      button.style.left = Math.round(shortcut.x) + "px";
      button.style.top = Math.round(shortcut.y) + "px";
      var image = button.querySelector("img");
      var label = button.querySelector("b");
      var source = shortcut.icon || "./assets/icons/OS Logo.png";
      if (image.getAttribute("src") !== source) image.src = source;
      if (label.textContent !== shortcut.label) label.textContent = shortcut.label;
    });
  }

  function addShortcutFile(label, icon) {
    var files = readJson("aos-files", []);
    if (!Array.isArray(files)) files = [];
    var name = label + ".aoslink";
    var existing = files.find(function (file) { return file && file.name === name && !file.__deletedAt; });
    if (!existing) {
      files.push({
        id: crypto.randomUUID ? crypto.randomUUID() : "aoslink-" + Date.now(),
        name: name,
        type: "file",
        parent: "root",
        content: JSON.stringify({type: "aos-app", app: label, icon: icon || ""}),
        mime: "application/x-aos-app-shortcut",
        icon: "OS Logo.png"
      });
      writeJson("aos-files", files);
      window.dispatchEvent(new CustomEvent("aos-files-change"));
    }
    notify(existing ? name + " is already in Files" : name + " was added to Files");
  }

  function readBrowserPins() {
    var pins = readJson(BROWSER_PINS_KEY, []);
    return Array.isArray(pins) ? pins : [];
  }

  function addBrowserPin(label, icon) {
    var pins = readBrowserPins();
    if (!pins.some(function (pin) { return pin.label === label; })) pins.push({label: label, icon: icon || ""});
    writeJson(BROWSER_PINS_KEY, pins.slice(0, 24));
    enhanceBrowserPins();
    notify(label + " was pinned in OSInternet");
  }

  function enhanceBrowserPins() {
    var pins = readBrowserPins();
    document.querySelectorAll(".system-window").forEach(function (windowElement) {
      var title = windowElement.querySelector(":scope > header b, :scope > header strong");
      if (!title || title.textContent.trim() !== "OSInternet") return;
      var bookmarks = windowElement.querySelector(".browser-bookmarks");
      if (!bookmarks) return;
      bookmarks.querySelectorAll(".aos-app-browser-pin").forEach(function (button) {
        if (!pins.some(function (pin) { return pin.label === button.dataset.aosAppLabel; })) button.remove();
      });
      pins.forEach(function (pin) {
        var button = Array.from(bookmarks.querySelectorAll(".aos-app-browser-pin")).find(function (item) {
          return item.dataset.aosAppLabel === pin.label;
        });
        if (button) return;
        button = document.createElement("button");
        button.type = "button";
        button.className = "aos-app-browser-pin";
        button.dataset.aosAppLabel = pin.label;
        button.textContent = pin.label;
        button.title = "Open " + pin.label + " in A-OS";
        button.addEventListener("click", function () {
          var label = button.dataset.aosAppLabel;
          var app = appFromLabel(label);
          if (app) app.click(); else notify(label + " is not installed");
        });
        bookmarks.appendChild(button);
      });
    });
  }

  function destinationForDrop(target) {
    var shelfButton = target.closest && target.closest(".shelf button[aria-label]");
    if (shelfButton) return shelfButton.getAttribute("aria-label");
    var windowElement = target.closest && target.closest(".system-window");
    if (!windowElement) return "";
    var title = windowElement.querySelector(":scope > header b, :scope > header strong");
    return title ? title.textContent.trim() : "";
  }

  function completeSpecialDrop(destination) {
    if (!draggingApp || !draggingApp.isApp) return false;
    if (destination === "Files") {
      addShortcutFile(draggingApp.label, draggingApp.icon);
      return true;
    }
    if (destination === "OSInternet") {
      addBrowserPin(draggingApp.label, draggingApp.icon);
      return true;
    }
    return false;
  }

  function bindShelfItem(item, shelf) {
    if (item.dataset.aosTaskbarDrag === "ready") return;
    item.dataset.aosTaskbarDrag = "ready";
    item.dataset.aosTaskbarItem = shelfItemKey(item);
    item.draggable = true;
    item.addEventListener("dragstart", function (event) {
      var app = isShelfApp(item);
      draggingApp = {
        isApp: app,
        label: app ? item.getAttribute("aria-label") : shelfControlKey(item).replace("control:", ""),
        icon: app ? iconSource(item) : "",
        source: item,
        key: shelfItemKey(item)
      };
      item.classList.add("aos-taskbar-dragging");
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData("text/x-aos-taskbar-item", draggingApp.key);
      if (app) event.dataTransfer.setData("text/x-aos-app", draggingApp.label);
    });
    item.addEventListener("dragend", function () {
      item.classList.remove("aos-taskbar-dragging");
      document.querySelectorAll(".aos-taskbar-drop-target").forEach(function (item) { item.classList.remove("aos-taskbar-drop-target"); });
      clearInsertionGap(shelf);
      saveTaskbarOrder(shelf);
      draggingApp = null;
    });
    installPointerSort(item, shelf);
  }

  function dragDescription(item) {
    var app = isShelfApp(item);
    return {
      isApp: app,
      label: app ? item.getAttribute("aria-label") : shelfControlKey(item).replace("control:", ""),
      icon: app ? iconSource(item) : "",
      source: item,
      key: shelfItemKey(item)
    };
  }

  function movePointerSortedItem(event, shelf) {
    if (!pointerSort || !pointerSort.active) return;
    var point = document.elementFromPoint(event.clientX, event.clientY);
    var target = point && point.closest && point.closest("[data-aos-taskbar-drag='ready']");
    if (target && target.parentElement === shelf && target !== pointerSort.item) {
      var bounds = target.getBoundingClientRect();
      var desktop = shelf.closest(".desktop");
      var vertical = desktop.classList.contains("shelf-left") || desktop.classList.contains("shelf-right");
      var before = vertical ? event.clientY < bounds.top + bounds.height / 2 : event.clientX < bounds.left + bounds.width / 2;
      showInsertionGap(shelf, target, before);
      shelf.insertBefore(pointerSort.item, before ? target : target.nextSibling);
      return;
    }
    var shelfBounds = shelf.getBoundingClientRect();
    if (event.clientX >= shelfBounds.left && event.clientX <= shelfBounds.right && event.clientY >= shelfBounds.top && event.clientY <= shelfBounds.bottom) {
      var anchor = shelf.querySelector(":scope > .aos-taskbar-resize-handle");
      shelf.insertBefore(pointerSort.item, anchor || null);
    }
  }

  function finishPointerSort(event) {
    if (!pointerSort || event.pointerId !== pointerSort.pointerId) return;
    var current = pointerSort;
    window.removeEventListener("pointermove", pointerSort.move, true);
    window.removeEventListener("pointerup", finishPointerSort, true);
    window.removeEventListener("pointercancel", finishPointerSort, true);
    if (current.active) {
      current.item.classList.remove("aos-taskbar-dragging", "aos-taskbar-pointer-dragging");
      clearInsertionGap(current.shelf);
      current.item.dataset.aosSuppressClick = "true";
      saveTaskbarOrder(current.shelf);
      window.setTimeout(function () { delete current.item.dataset.aosSuppressClick; }, 120);
    }
    pointerSort = null;
    draggingApp = null;
  }

  function installPointerSort(item, shelf) {
    if (item.dataset.aosPointerSort === "ready") return;
    item.dataset.aosPointerSort = "ready";
    item.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.pointerType === "touch" && event.isPrimary === false) return;
      var startX = event.clientX;
      var startY = event.clientY;
      pointerSort = {
        item: item,
        shelf: shelf,
        pointerId: event.pointerId,
        active: false,
        move: function (moveEvent) {
          if (!pointerSort || moveEvent.pointerId !== pointerSort.pointerId) return;
          var distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (!pointerSort.active && distance < 7) return;
          if (!pointerSort.active) {
            pointerSort.active = true;
            draggingApp = dragDescription(item);
            item.classList.add("aos-taskbar-dragging", "aos-taskbar-pointer-dragging");
            if (document.activeElement && item.contains(document.activeElement)) document.activeElement.blur();
          }
          moveEvent.preventDefault();
          movePointerSortedItem(moveEvent, shelf);
        }
      };
      window.addEventListener("pointermove", pointerSort.move, true);
      window.addEventListener("pointerup", finishPointerSort, true);
      window.addEventListener("pointercancel", finishPointerSort, true);
    });
    item.addEventListener("click", function (event) {
      if (item.dataset.aosSuppressClick !== "true") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function installShelfDragAndDrop(shelf) {
    shelfReorderItems(shelf).forEach(function (item) { bindShelfItem(item, shelf); });
    if (shelf.dataset.aosTaskbarDrop === "ready") return;
    shelf.dataset.aosTaskbarDrop = "ready";
    shelf.addEventListener("dragover", function (event) {
      if (!draggingApp) return;
      event.preventDefault();
      var target = event.target.closest("[data-aos-taskbar-drag='ready']");
      if (!target || target.parentElement !== shelf) return;
      if (draggingApp.isApp && target instanceof HTMLButtonElement && ["Files", "OSInternet"].indexOf(target.getAttribute("aria-label")) !== -1 && target !== draggingApp.source) {
        target.classList.add("aos-taskbar-drop-target");
        return;
      }
      if (!draggingApp.source || target === draggingApp.source) return;
      var bounds = target.getBoundingClientRect();
      var vertical = shelf.closest(".desktop").classList.contains("shelf-left") || shelf.closest(".desktop").classList.contains("shelf-right");
      var before = vertical ? event.clientY < bounds.top + bounds.height / 2 : event.clientX < bounds.left + bounds.width / 2;
      showInsertionGap(shelf, target, before);
      shelf.insertBefore(draggingApp.source, before ? target : target.nextSibling);
    });
    shelf.addEventListener("dragleave", function (event) {
      var target = event.target.closest && event.target.closest(".aos-taskbar-drop-target");
      if (target) target.classList.remove("aos-taskbar-drop-target");
    });
    shelf.addEventListener("drop", function (event) {
      if (!draggingApp) return;
      event.preventDefault();
      var destination = destinationForDrop(event.target);
      if (!completeSpecialDrop(destination)) saveTaskbarOrder(shelf);
      document.querySelectorAll(".aos-taskbar-drop-target").forEach(function (item) { item.classList.remove("aos-taskbar-drop-target"); });
      clearInsertionGap(shelf);
    });
  }

  function quickTileKey(button) {
    var label = button.querySelector("b");
    return String(label ? label.textContent : button.getAttribute("aria-label") || "").trim().toLowerCase();
  }

  function quickTileButtons(grid) {
    return Array.from(grid.children).filter(function (item) {
      return item instanceof HTMLButtonElement && Boolean(quickTileKey(item));
    });
  }

  function saveQuickTileOrder(grid) {
    writeJson(QUICK_ORDER_KEY, quickTileButtons(grid).map(quickTileKey));
  }

  function applyQuickTileOrder(grid) {
    var saved = readJson(QUICK_ORDER_KEY, []);
    if (!Array.isArray(saved) || !saved.length) return;
    var buttons = quickTileButtons(grid);
    var original = new Map(buttons.map(function (button, index) { return [button, index]; }));
    buttons.sort(function (first, second) {
      var firstIndex = saved.indexOf(quickTileKey(first));
      var secondIndex = saved.indexOf(quickTileKey(second));
      if (firstIndex < 0) firstIndex = saved.length + original.get(first);
      if (secondIndex < 0) secondIndex = saved.length + original.get(second);
      return firstIndex - secondIndex;
    });
    var current = quickTileButtons(grid);
    if (buttons.every(function (button, index) { return current[index] === button; })) return;
    buttons.forEach(function (button) { grid.appendChild(button); });
  }

  function finishQuickPointerSort(event) {
    if (!quickPointerSort || event.pointerId !== quickPointerSort.pointerId) return;
    var current = quickPointerSort;
    window.removeEventListener("pointermove", current.move, true);
    window.removeEventListener("pointerup", finishQuickPointerSort, true);
    window.removeEventListener("pointercancel", finishQuickPointerSort, true);
    clearInsertionGap(current.grid);
    if (current.active) {
      current.item.classList.remove("aos-quick-tile-dragging");
      current.item.dataset.aosSuppressQuickClick = "true";
      saveQuickTileOrder(current.grid);
      window.setTimeout(function () { delete current.item.dataset.aosSuppressQuickClick; }, 140);
    }
    quickPointerSort = null;
  }

  function bindQuickTile(button, grid) {
    if (button.dataset.aosQuickDrag === "ready") return;
    button.dataset.aosQuickDrag = "ready";
    button.draggable = true;
    button.addEventListener("dragstart", function (event) {
      button.classList.add("aos-quick-tile-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/x-aos-quick-tile", quickTileKey(button));
      grid.dataset.aosDraggingQuickTile = quickTileKey(button);
    });
    button.addEventListener("dragend", function () {
      button.classList.remove("aos-quick-tile-dragging");
      delete grid.dataset.aosDraggingQuickTile;
      clearInsertionGap(grid);
      saveQuickTileOrder(grid);
    });
    button.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.pointerType === "touch" && event.isPrimary === false) return;
      var startX = event.clientX;
      var startY = event.clientY;
      quickPointerSort = {
        item: button,
        grid: grid,
        pointerId: event.pointerId,
        active: false,
        move: function (moveEvent) {
          if (!quickPointerSort || moveEvent.pointerId !== quickPointerSort.pointerId) return;
          if (!quickPointerSort.active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 7) return;
          quickPointerSort.active = true;
          button.classList.add("aos-quick-tile-dragging");
          var target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
          target = target && target.closest && target.closest(".quick-tiles > button");
          if (target && target !== button && target.parentElement === grid) {
            var bounds = target.getBoundingClientRect();
            var before = moveEvent.clientX < bounds.left + bounds.width / 2;
            showInsertionGap(grid, target, before);
            grid.insertBefore(button, before ? target : target.nextSibling);
          }
          moveEvent.preventDefault();
        }
      };
      window.addEventListener("pointermove", quickPointerSort.move, true);
      window.addEventListener("pointerup", finishQuickPointerSort, true);
      window.addEventListener("pointercancel", finishQuickPointerSort, true);
    });
    button.addEventListener("click", function (event) {
      if (button.dataset.aosSuppressQuickClick !== "true") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function installQuickTileSorting(grid) {
    applyQuickTileOrder(grid);
    quickTileButtons(grid).forEach(function (button) { bindQuickTile(button, grid); });
    if (grid.dataset.aosQuickDrop === "ready") return;
    grid.dataset.aosQuickDrop = "ready";
    grid.addEventListener("dragover", function (event) {
      if (!grid.dataset.aosDraggingQuickTile) return;
      var source = quickTileButtons(grid).find(function (button) {
        return quickTileKey(button) === grid.dataset.aosDraggingQuickTile;
      });
      var target = event.target.closest(".quick-tiles > button");
      if (!source || !target || source === target) return;
      event.preventDefault();
      var bounds = target.getBoundingClientRect();
      var before = event.clientX < bounds.left + bounds.width / 2;
      showInsertionGap(grid, target, before);
      grid.insertBefore(source, before ? target : target.nextSibling);
    });
    grid.addEventListener("drop", function (event) {
      if (!grid.dataset.aosDraggingQuickTile) return;
      event.preventDefault();
      delete grid.dataset.aosDraggingQuickTile;
      clearInsertionGap(grid);
      saveQuickTileOrder(grid);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function storedFiles() {
    var files = readJson("aos-files", []);
    return Array.isArray(files) ? files : [];
  }

  function findFilesWindow() {
    return Array.from(document.querySelectorAll(".system-window")).find(function (windowElement) {
      var title = windowElement.querySelector(":scope > header b, :scope > header strong");
      return title && title.textContent.trim() === "Files";
    });
  }

  function clickFilesPlace(root, names) {
    var button = Array.from(root.querySelectorAll("button")).find(function (item) {
      return names.indexOf(item.textContent.trim()) !== -1;
    });
    if (button) button.click();
    return Boolean(button);
  }

  function fileFolderChain(folderId, files) {
    var chain = [];
    var current = folderId;
    var safety = 0;
    while (["home", "root", "documents", "downloads"].indexOf(current) === -1 && safety++ < 40) {
      var folder = files.find(function (item) { return item && item.id === current && item.type === "folder"; });
      if (!folder) break;
      chain.unshift(folder);
      current = folder.parent || "home";
    }
    return {base: current, chain: chain};
  }

  function performPendingFileNavigation(attempt) {
    if (!pendingFileLocation) return;
    var root = findFilesWindow();
    if (!root || root.hidden || getComputedStyle(root).display === "none") {
      if ((attempt || 0) < 18) window.setTimeout(function () { performPendingFileNavigation((attempt || 0) + 1); }, 120);
      return;
    }
    var request = pendingFileLocation;
    pendingFileLocation = null;
    var files = storedFiles();
    var route = fileFolderChain(request.folder || "home", files);
    var baseNames = route.base === "root" ? ["OS", "Root"] : route.base === "documents" ? ["Documents"] : route.base === "downloads" ? ["Downloads"] : ["Home"];
    clickFilesPlace(root, baseNames);
    var index = 0;
    function next() {
      if (index < route.chain.length) {
        var folder = route.chain[index++];
        var button = Array.from(root.querySelectorAll("button")).find(function (item) {
          var name = item.querySelector("b");
          return name && name.textContent.trim() === folder.name;
        });
        if (button) button.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true, view: window}));
        window.setTimeout(next, 90);
        return;
      }
      if (request.fileId) {
        var file = files.find(function (item) { return item && item.id === request.fileId; });
        if (file) {
          var fileButton = Array.from(root.querySelectorAll("button")).find(function (item) {
            var name = item.querySelector("b");
            return name && name.textContent.trim() === file.name;
          });
          if (fileButton) fileButton.click();
        }
      }
    }
    window.setTimeout(next, 100);
  }

  function openFilesLocation(folder, fileId) {
    pendingFileLocation = {folder: folder || "home", fileId: fileId || ""};
    writeJson(FILES_LAST_LOCATION_KEY, pendingFileLocation);
    var root = findFilesWindow();
    var filesButton = appFromLabel("Files");
    if (!root || root.hidden || getComputedStyle(root).display === "none") {
      if (filesButton) filesButton.click();
    }
    window.setTimeout(function () { performPendingFileNavigation(0); }, 80);
  }

  function resolveFilesAddress(address) {
    var parts = String(address || "").replace(/\\/g, "/").trim().split("/").filter(Boolean);
    var usersIndex = parts.findIndex(function (part) { return part.toLowerCase() === "users"; });
    if (usersIndex >= 0) parts = parts.slice(usersIndex + 2);
    if (!parts.length) return {folder: "home", fileId: ""};
    var first = parts.shift().toLowerCase();
    var known = ["home", "os", "root", "documents", "downloads"];
    var current = first === "os" || first === "root" ? "root" : first === "documents" ? "documents" : first === "downloads" ? "downloads" : "home";
    if (known.indexOf(first) === -1) parts.unshift(first);
    var files = storedFiles();
    var fileId = "";
    parts.forEach(function (part, index) {
      var choices = current === "home" ? ["root", "documents", "downloads"] : [current];
      var match = files.find(function (item) {
        return item && choices.indexOf(item.parent) !== -1 && String(item.name).toLowerCase() === part.toLowerCase();
      }) || files.find(function (item) { return item && String(item.name).toLowerCase() === part.toLowerCase(); });
      if (!match) return;
      if (match.type === "folder") current = match.id;
      else if (index === parts.length - 1) { fileId = match.id; current = match.parent || current; }
    });
    return {folder: current, fileId: fileId};
  }

  function handleFilesNavigate(event) {
    var detail = event.detail || {};
    if (detail.path && !detail.folder) detail = resolveFilesAddress(detail.path);
    openFilesLocation(detail.folder || "home", detail.fileId || "");
  }

  function renderQuickFilePins(section) {
    var pins = readJson(QUICK_FILE_PINS_KEY, []);
    if (!Array.isArray(pins)) pins = [];
    var files = storedFiles();
    var signature = JSON.stringify(pins) + ":" + files.map(function (file) {
      return file.id + ":" + file.name + ":" + file.parent;
    }).join("|");
    if (section.dataset.aosPinsSignature === signature) return;
    section.dataset.aosPinsSignature = signature;
    var pinned = pins.map(function (id) {
      return files.find(function (file) { return file && file.id === id; });
    }).filter(Boolean);
    section.innerHTML = '<header><span><b>File pins</b><small>Open files and folders at their location</small></span><button type="button" data-aqs-add-pin aria-label="Add a file pin">+</button></header>' +
      '<div class="aos-quick-file-pin-list">' + (pinned.length ? pinned.map(function (file) {
        var icon = file.icon && file.icon.indexOf("data:") === 0 ? file.icon : "./assets/icons/" + encodeURIComponent(file.icon || (file.type === "folder" ? "Files.png" : "Unnamed app.png"));
        return '<div class="aos-quick-file-pin"><button type="button" data-aqs-open-pin="' + escapeHtml(file.id) + '"><img src="' + escapeHtml(icon) + '" alt=""><span><b>' + escapeHtml(file.name) + '</b><small>' + (file.type === "folder" ? "Folder" : "File") + '</small></span></button><button type="button" data-aqs-remove-pin="' + escapeHtml(file.id) + '" aria-label="Remove ' + escapeHtml(file.name) + '">×</button></div>';
      }).join("") : '<p>No file pins yet.</p>') + '</div><div class="aos-quick-file-picker" hidden></div>';
  }

  function renderQuickFilePicker(section) {
    var picker = section.querySelector(".aos-quick-file-picker");
    if (!picker) return;
    var pins = readJson(QUICK_FILE_PINS_KEY, []);
    if (!Array.isArray(pins)) pins = [];
    var files = storedFiles().filter(function (file) {
      return file && pins.indexOf(file.id) === -1;
    }).slice(0, 24);
    picker.innerHTML = '<b>Choose a file or folder</b>' + (files.length ? files.map(function (file) {
      return '<button type="button" data-aqs-pick-pin="' + escapeHtml(file.id) + '"><span>' + (file.type === "folder" ? "Folder" : "File") + '</span><b>' + escapeHtml(file.name) + '</b></button>';
    }).join("") : '<p>Everything is already pinned.</p>');
  }

  function installQuickFilePins(quick) {
    var tiles = quick.querySelector(".quick-tiles");
    if (!tiles) return;
    var section = quick.querySelector(".aos-quick-file-pins");
    if (!section) {
      section = document.createElement("section");
      section.className = "aos-quick-file-pins";
      tiles.insertAdjacentElement("afterend", section);
      section.addEventListener("click", function (event) {
        var add = event.target.closest("[data-aqs-add-pin]");
        var open = event.target.closest("[data-aqs-open-pin]");
        var remove = event.target.closest("[data-aqs-remove-pin]");
        var pick = event.target.closest("[data-aqs-pick-pin]");
        if (add) {
          var picker = section.querySelector(".aos-quick-file-picker");
          renderQuickFilePicker(section);
          picker.hidden = !picker.hidden;
        } else if (open) {
          var file = storedFiles().find(function (item) { return item && item.id === open.dataset.aqsOpenPin; });
          if (file) openFilesLocation(file.type === "folder" ? file.id : file.parent, file.type === "file" ? file.id : "");
        } else if (remove || pick) {
          var pins = readJson(QUICK_FILE_PINS_KEY, []);
          if (!Array.isArray(pins)) pins = [];
          if (remove) pins = pins.filter(function (id) { return id !== remove.dataset.aqsRemovePin; });
          if (pick && pins.indexOf(pick.dataset.aqsPickPin) === -1) pins.push(pick.dataset.aqsPickPin);
          writeJson(QUICK_FILE_PINS_KEY, pins.slice(0, 8));
          delete section.dataset.aosPinsSignature;
          renderQuickFilePins(section);
        }
      });
    }
    renderQuickFilePins(section);
  }

  function enhanceQuickSettings() {
    document.querySelectorAll(".quick").forEach(function (quick) {
      var grid = quick.querySelector(".quick-tiles");
      if (grid) installQuickTileSorting(grid);
      installQuickFilePins(quick);
    });
  }

  function enhanceFilesWindow() {
    var root = findFilesWindow();
    if (!root) return;
    var pathSpan = Array.from(root.querySelectorAll("span")).find(function (span) {
      return /^[A-Z]:\/\//i.test(span.textContent.trim());
    });
    if (!pathSpan) return;
    var bar = pathSpan.parentElement;
    if (!bar) return;
    bar.classList.add("aos-files-location-bar");
    var input = bar.querySelector(".aos-files-location-input");
    if (!input) {
      input = document.createElement("input");
      input.type = "text";
      input.className = "aos-files-location-input";
      input.setAttribute("aria-label", "File location");
      input.spellcheck = false;
      input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        var resolved = resolveFilesAddress(input.value);
        openFilesLocation(resolved.folder, resolved.fileId);
      });
      input.addEventListener("focus", function () { input.select(); });
      bar.appendChild(input);
    }
    if (document.activeElement !== input && input.value !== pathSpan.textContent.trim()) input.value = pathSpan.textContent.trim();
    var current = resolveFilesAddress(pathSpan.textContent.trim());
    if (root.dataset.aosFilesLocationReady !== "true") {
      root.dataset.aosFilesLocationReady = "true";
      var saved = readJson(FILES_LAST_LOCATION_KEY, null);
      if (saved && saved.folder && current.folder === "home" && saved.folder !== "home") {
        pendingFileLocation = saved;
        window.setTimeout(function () { performPendingFileNavigation(0); }, 80);
        return;
      }
    }
    writeJson(FILES_LAST_LOCATION_KEY, current);
  }

  function installDesktopDrop(desktop) {
    if (desktop.dataset.aosTaskbarDrop === "ready") return;
    desktop.dataset.aosTaskbarDrop = "ready";
    desktop.addEventListener("dragover", function (event) {
      if (!draggingApp || !draggingApp.isApp || event.target.closest(".shelf")) return;
      event.preventDefault();
    });
    desktop.addEventListener("drop", function (event) {
      if (!draggingApp || !draggingApp.isApp || event.target.closest(".shelf")) return;
      event.preventDefault();
      var destination = destinationForDrop(event.target);
      if (completeSpecialDrop(destination)) return;
      if (event.target.closest("#aos-desktop-widgets-layer")) return;
      if (draggingApp.shortcutId) {
        var shortcuts = readShortcuts();
        var shortcut = shortcuts.find(function (item) { return item.id === draggingApp.shortcutId; });
        if (shortcut) {
          var position = shortcutPosition(desktop, event.clientX, event.clientY, shortcut.id);
          shortcut.x = position.left;
          shortcut.y = position.top;
          saveShortcuts(shortcuts);
          renderDesktopShortcuts(desktop);
          resolveWidgets();
        }
      } else {
        createDesktopShortcut(draggingApp.label, draggingApp.icon, event.clientX, event.clientY);
      }
    });
  }

  function updateStatus(status) {
    if (!status) return;
    status.classList.add("aos-status-modern");
    status.title = "Control Centre";
    var date = status.querySelector(".aos-status-date");
    if (!date) {
      date = document.createElement("span");
      date.className = "aos-status-date";
      date.innerHTML = "<b></b><small></small>";
      var account = status.querySelector("img");
      status.insertBefore(date, account || null);
    }
    var now = new Date();
    var weekday = new Intl.DateTimeFormat([], {weekday: "short"}).format(now);
    var calendarDate = new Intl.DateTimeFormat([], {month: "short", day: "numeric"}).format(now);
    if (date.querySelector("b").textContent !== weekday) date.querySelector("b").textContent = weekday;
    if (date.querySelector("small").textContent !== calendarDate) date.querySelector("small").textContent = calendarDate;
    if (!status.querySelector(".aos-status-battery")) {
      var battery = document.createElement("span");
      battery.className = "aos-status-battery";
      battery.setAttribute("aria-label", "Battery status");
      battery.innerHTML = "<i><i></i></i><small>--</small>";
      status.insertBefore(battery, date);
      if (navigator.getBattery) navigator.getBattery().then(function (manager) {
        function renderBattery() {
          var level = Math.round(manager.level * 100);
          battery.style.setProperty("--aos-battery", level + "%");
          battery.querySelector("small").textContent = level + "%";
          battery.setAttribute("aria-label", "Battery " + level + "%" + (manager.charging ? ", charging" : ""));
        }
        renderBattery();
        manager.addEventListener("levelchange", renderBattery);
        manager.addEventListener("chargingchange", renderBattery);
      }).catch(function () { battery.hidden = true; });
      else battery.hidden = true;
    }
  }

  function visible(element) {
    if (!element) return false;
    var bounds = element.getBoundingClientRect();
    var style = window.getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function defaultOverlayAnchor(overlay, shelf) {
    if (overlay.matches(".aos-sys-search")) return shelf.querySelector(":scope > .search-pill");
    if (overlay.matches(".sparkle-embed")) return shelf.querySelector(':scope > [aria-label="AI shortcut"]');
    if (overlay.matches(".quick")) return shelf.querySelector(":scope > .status");
    return null;
  }

  function overlayAnchor(overlay, shelf) {
    if (lastOverlayAnchor && lastOverlayAnchor.isConnected && lastOverlayAnchor.closest(".shelf") === shelf && Date.now() - lastOverlayAnchorTime < 900) {
      var key = shelfItemKey(lastOverlayAnchor);
      if (overlay.matches(".quick") && ["control:status", "control:ai", "control:quick"].indexOf(key) !== -1) return lastOverlayAnchor;
      if (overlay.matches(".sparkle-embed") && key === "control:ai") return lastOverlayAnchor;
      if (overlay.matches(".aos-sys-search") && key === "control:search") return lastOverlayAnchor;
    }
    return defaultOverlayAnchor(overlay, shelf);
  }

  function positionTaskbarOverlay(overlay) {
    if (!visible(overlay)) return;
    var desktop = overlay.closest(".desktop") || document.querySelector(".desktop");
    var shelf = desktop && desktop.querySelector(":scope > .shelf");
    var anchor = shelf && overlayAnchor(overlay, shelf);
    if (!desktop || !shelf || !visible(anchor)) return;
    var anchorRect = anchor.getBoundingClientRect();
    var gap = 10;
    var margin = 8;
    var statusBar = document.querySelector(".aos-status-bar-visible .aos-system-statusbar");
    var minimumTop = statusBar && visible(statusBar) ? statusBar.getBoundingClientRect().bottom + 6 : margin;
    var position = desktop.classList.contains("shelf-top") ? "top" : desktop.classList.contains("shelf-left") ? "left" : desktop.classList.contains("shelf-right") ? "right" : "bottom";

    overlay.classList.add("aos-taskbar-anchored-overlay");
    overlay.style.position = "fixed";
    overlay.style.right = "auto";
    overlay.style.bottom = "auto";
    overlay.style.maxHeight = position === "bottom" ? Math.max(240, anchorRect.top - minimumTop - gap) + "px" : Math.max(240, window.innerHeight - minimumTop - margin) + "px";

    var width = overlay.offsetWidth;
    var height = overlay.offsetHeight;
    var left;
    var top;
    if (position === "top") {
      left = anchorRect.left + anchorRect.width / 2 - width / 2;
      top = anchorRect.bottom + gap;
    } else if (position === "left") {
      left = anchorRect.right + gap;
      top = anchorRect.top + anchorRect.height / 2 - height / 2;
    } else if (position === "right") {
      left = anchorRect.left - width - gap;
      top = anchorRect.top + anchorRect.height / 2 - height / 2;
    } else {
      left = anchorRect.left + anchorRect.width / 2 - width / 2;
      top = anchorRect.top - height - gap;
    }
    overlay.style.left = Math.round(clamp(left, margin, Math.max(margin, window.innerWidth - width - margin))) + "px";
    overlay.style.top = Math.round(clamp(top, minimumTop, Math.max(minimumTop, window.innerHeight - height - margin))) + "px";
    overlay.dataset.aosTaskbarAnchor = shelfItemKey(anchor);
  }

  function positionTaskbarOverlays() {
    document.querySelectorAll(".aos-sys-search, .quick, .sparkle-embed").forEach(positionTaskbarOverlay);
  }

  function installResizeHandle(desktop, shelf) {
    var handle = shelf.querySelector(":scope > .aos-taskbar-resize-handle");
    if (handle) return;
    handle = document.createElement("span");
    handle.className = "aos-taskbar-resize-handle";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", "Resize taskbar");
    handle.title = "Drag to resize the taskbar · Double-click to reset";
    shelf.appendChild(handle);
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      var startSize = taskbarSize();
      var startX = event.clientX;
      var startY = event.clientY;
      var position = desktop.classList.contains("shelf-top") ? "top" : desktop.classList.contains("shelf-left") ? "left" : desktop.classList.contains("shelf-right") ? "right" : "bottom";
      handle.dataset.resizing = "true";
      handle.setPointerCapture(event.pointerId);
      function move(pointerEvent) {
        var delta = position === "bottom" ? startY - pointerEvent.clientY : position === "top" ? pointerEvent.clientY - startY : position === "left" ? pointerEvent.clientX - startX : startX - pointerEvent.clientX;
        applySize(startSize + delta, false);
      }
      function finish(pointerEvent) {
        handle.releasePointerCapture(pointerEvent.pointerId);
        handle.dataset.resizing = "false";
        localStorage.setItem(SIZE_KEY, String(Math.round(Number(getComputedStyle(desktop).getPropertyValue("--aos-taskbar-size").replace("px", "")) || taskbarSize())));
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        resolveWidgets();
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
    handle.addEventListener("dblclick", function () { applySize(68, true); });
  }

  function applySize(value, save) {
    var size = clamp(value, 52, 96);
    var icon = clamp(size - 17, 40, 78);
    var image = clamp(icon - 8, 32, 68);
    if (save !== false) localStorage.setItem(SIZE_KEY, String(Math.round(size)));
    document.querySelectorAll(".desktop").forEach(function (desktop) {
      desktop.style.setProperty("--aos-taskbar-size", Math.round(size) + "px");
      desktop.style.setProperty("--aos-taskbar-icon-size", Math.round(icon) + "px");
      desktop.style.setProperty("--aos-taskbar-image-size", Math.round(image) + "px");
    });
    document.querySelectorAll("[data-aos-taskbar-size]").forEach(function (input) {
      if (document.activeElement !== input) input.value = String(Math.round(size));
      var label = input.closest(".aos-taskbar-size-setting");
      var output = label && label.querySelector("small");
      if (output) output.textContent = Math.round(size) + " px · drag the taskbar edge too";
    });
  }

  function setLayout(layout) {
    if (!LAYOUTS.some(function (item) { return item.id === layout; })) return;
    localStorage.setItem(LAYOUT_KEY, layout);
    applyPreferences();
    resolveWidgets();
  }

  function applyPreferences() {
    var layout = taskbarLayout();
    applySize(taskbarSize(), false);
    document.querySelectorAll(".desktop").forEach(function (desktop) {
      Array.from(desktop.classList).forEach(function (className) {
        if (className.indexOf(LAYOUT_CLASS_PREFIX) === 0) desktop.classList.remove(className);
      });
      desktop.classList.add(LAYOUT_CLASS_PREFIX + layout);
      var shelf = desktop.querySelector(":scope > .shelf");
      if (shelf) {
        applyTaskbarOrder(shelf);
        installShelfDragAndDrop(shelf);
        installResizeHandle(desktop, shelf);
        updateStatus(shelf.querySelector(":scope > .status"));
      }
      installDesktopDrop(desktop);
      renderDesktopShortcuts(desktop);
    });
    document.querySelectorAll("[data-aos-taskbar-layout]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.aosTaskbarLayout === layout ? "true" : "false");
    });
  }

  function addSettingsControls() {
    document.querySelectorAll("label.select-setting").forEach(function (material) {
      var heading = material.querySelector("b");
      if (!heading || heading.textContent.trim() !== "Taskbar material") return;
      var parent = material.parentElement;
      if (!parent || parent.querySelector(".aos-taskbar-layout-setting")) return;
      var section = document.createElement("section");
      section.className = "aos-taskbar-layout-setting";
      section.innerHTML = '<header><span><b>Taskbar layouts</b><small>Your five A-OS designs</small></span></header>' +
        '<div class="aos-taskbar-layout-grid">' + LAYOUTS.map(function (layout) {
          return '<button type="button" class="aos-taskbar-layout-choice" data-aos-taskbar-layout="' + layout.id + '"><span class="aos-taskbar-mini" data-preview="' + layout.id + '"><i></i><i></i><i></i><i></i><i></i></span><span>' + layout.name + '</span></button>';
        }).join("") + '</div>' +
        '<label class="aos-taskbar-size-setting"><span><b>Taskbar size</b><small>' + Math.round(taskbarSize()) + ' px · drag the taskbar edge too</small></span><input type="range" min="52" max="96" step="1" value="' + Math.round(taskbarSize()) + '" data-aos-taskbar-size aria-label="Taskbar size"></label>';
      section.addEventListener("click", function (event) {
        var button = event.target.closest("[data-aos-taskbar-layout]");
        if (button) setLayout(button.dataset.aosTaskbarLayout);
      });
      section.querySelector("[data-aos-taskbar-size]").addEventListener("input", function (event) { applySize(event.target.value, true); });
      material.insertAdjacentElement("afterend", section);
    });
  }

  function widgetKey(widget, index) {
    var title = widget.querySelector(".truncate");
    return String(title ? title.textContent.trim() : "Widget") + ":" + index;
  }

  function resolveWidgets() {
    if (resolvingWidgets) {
      window.requestAnimationFrame(resolveWidgets);
      return;
    }
    var layers = Array.from(document.querySelectorAll("#aos-desktop-widgets-layer"));
    if (!layers.length) return;
    resolvingWidgets = true;
    try {
      var saved = readJson(WIDGET_POSITIONS_KEY, {});
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
      layers.forEach(function (layer, layerIndex) {
        var desktop = layer.closest(".desktop") || Array.from(document.querySelectorAll(".desktop")).find(function (candidate) {
          var bounds = candidate.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        });
        if (!desktop || layer.dataset.aosWidgetDragging === "true") return;
        var desktopRect = desktop.getBoundingClientRect();
        if (!desktopRect.width || !desktopRect.height) return;
        var widgets = Array.from(layer.children).filter(function (item) { return item instanceof HTMLElement && item.offsetWidth && item.offsetHeight; });
        var reserved = [];
        desktop.querySelectorAll(".desktop-files > button, .desk-shortcut, .wallmark img, .shelf").forEach(function (element) {
          var rect = rectFromElement(element, desktopRect);
          if (rect.width && rect.height) reserved.push(rect);
        });
        var placed = [];
        widgets.forEach(function (widget, index) {
          var width = widget.offsetWidth;
          var height = widget.offsetHeight;
          var maximumX = Math.max(8, desktopRect.width - width - 8);
          var maximumY = Math.max(8, desktopRect.height - height - 8);
          var key = layerIndex + ":" + widgetKey(widget, index);
          var current = saved[key] || {x: parseFloat(widget.style.left) || 12, y: parseFloat(widget.style.top) || 12};
          var preferred = {left: clamp(current.x, 8, maximumX), top: clamp(current.y, 8, maximumY)};
          var candidates = [preferred];
          for (var y = 12; y <= maximumY; y += 18) {
            for (var x = 12; x <= maximumX; x += 18) candidates.push({left: x, top: y});
          }
          var chosen = candidates.find(function (candidate) {
            var candidateRect = {left: candidate.left, top: candidate.top, right: candidate.left + width, bottom: candidate.top + height};
            return !reserved.concat(placed).some(function (item) { return overlaps(candidateRect, item, 8); });
          }) || preferred;
          var placedRect = {left: chosen.left, top: chosen.top, right: chosen.left + width, bottom: chosen.top + height, width: width, height: height};
          placed.push(placedRect);
          widget.dataset.aosWidgetSafe = "true";
          if (Math.abs((parseFloat(widget.style.left) || 0) - chosen.left) > .5) widget.style.left = Math.round(chosen.left) + "px";
          if (Math.abs((parseFloat(widget.style.top) || 0) - chosen.top) > .5) widget.style.top = Math.round(chosen.top) + "px";
          saved[key] = {x: Math.round(chosen.left), y: Math.round(chosen.top)};
        });
      });
      writeJson(WIDGET_POSITIONS_KEY, saved);
    } finally {
      resolvingWidgets = false;
    }
  }

  function bindWidgetLayer() {
    document.querySelectorAll("#aos-desktop-widgets-layer").forEach(function (layer) {
      if (layer.dataset.aosCollisionReady === "true") return;
      layer.dataset.aosCollisionReady = "true";
      layer.addEventListener("pointerdown", function (event) {
        if (!event.target.closest("#aos-desktop-widgets-layer > div")) return;
        layer.dataset.aosWidgetDragging = "true";
      });
      window.addEventListener("pointerup", function () {
        if (layer.dataset.aosWidgetDragging !== "true") return;
        layer.dataset.aosWidgetDragging = "false";
        window.setTimeout(resolveWidgets, 0);
      }, true);
    });
    resolveWidgets();
  }

  function openAosLink(event) {
    var button = event.target.closest && event.target.closest("button");
    if (!button || !/\.aoslink$/i.test(button.textContent.trim())) return;
    var windowElement = button.closest(".system-window");
    var title = windowElement && windowElement.querySelector(":scope > header b, :scope > header strong");
    if (!title || title.textContent.trim() !== "Files") return;
    var name = button.textContent.trim().split("\n")[0].trim();
    var file = readJson("aos-files", []).find(function (item) { return item && item.name === name; });
    if (!file) return;
    try {
      var shortcut = JSON.parse(file.content || "{}");
      if (shortcut.type !== "aos-app") return;
      event.preventDefault();
      event.stopPropagation();
      var app = appFromLabel(shortcut.app);
      if (app) app.click(); else notify(shortcut.app + " is not installed");
    } catch (_) {}
  }

  function enhance() {
    applyPreferences();
    addSettingsControls();
    enhanceBrowserPins();
    enhanceQuickSettings();
    enhanceFilesWindow();
    bindWidgetLayer();
    positionTaskbarOverlays();
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      enhance();
    });
  }

  document.addEventListener("dblclick", openAosLink, true);
  window.addEventListener("aos-files-navigate", handleFilesNavigate);
  window.addEventListener("aos-files-open-location", handleFilesNavigate);
  window.addEventListener("aos-files-change", scheduleEnhance);
  document.addEventListener("click", function (event) {
    var control = event.target.closest && event.target.closest(".shelf > .search-pill, .shelf > .status, .shelf > [aria-label='AI shortcut'], .shelf > .shelf-bird");
    if (!control) return;
    lastOverlayAnchor = control;
    lastOverlayAnchorTime = Date.now();
    window.requestAnimationFrame(positionTaskbarOverlays);
    window.setTimeout(positionTaskbarOverlays, 80);
  }, true);
  new MutationObserver(scheduleEnhance).observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("resize", function () { applyPreferences(); resolveWidgets(); positionTaskbarOverlays(); });
  window.addEventListener("storage", function (event) {
    if ([LAYOUT_KEY, SIZE_KEY, ORDER_KEY, SHORTCUTS_KEY, BROWSER_PINS_KEY, QUICK_ORDER_KEY, QUICK_FILE_PINS_KEY, FILES_LAST_LOCATION_KEY].indexOf(event.key) !== -1) scheduleEnhance();
  });
  statusTimer = window.setInterval(function () {
    document.querySelectorAll(".shelf > .status").forEach(updateStatus);
  }, 60000);

  window.AOS_TASKBAR_STUDIO = {
    layouts: LAYOUTS.slice(),
    apply: applyPreferences,
    setLayout: setLayout,
    setSize: function (size) { applySize(size, true); resolveWidgets(); },
    createDesktopShortcut: createDesktopShortcut,
    addShortcutFile: addShortcutFile,
    addBrowserPin: addBrowserPin,
    resolveWidgets: resolveWidgets,
    positionOverlays: positionTaskbarOverlays
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance, {once: true});
  else enhance();
})();
