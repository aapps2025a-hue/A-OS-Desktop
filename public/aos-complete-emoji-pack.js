(function () {
  "use strict";

  if (window.AOS_COMPLETE_EMOJI_PACK) return;
  window.AOS_COMPLETE_EMOJI_PACK = true;

  var CATALOG_URL = "./assets/emojis/aos-complete/catalog.json";
  var ORIGINALS_URL = "./assets/emojis/aos-3d/manifest.json";
  var HISTORY_KEY = "aos-clipboard-history";
  var PAGE_SIZE = 210;
  var packPromise = null;
  var overlay = null;
  var lastTarget = null;
  var savedRange = null;
  var state = {
    tab: "emoji",
    group: "All",
    query: "",
    visible: PAGE_SIZE,
    originals: [],
    unicode: [],
    groups: []
  };

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function readHistory() {
    try {
      var value = safeParse(localStorage.getItem(HISTORY_KEY) || "[]", []);
      return Array.isArray(value) ? value.filter(function (item) {
        return item && typeof item.content === "string";
      }).slice(0, 80) : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(content, type) {
    var text = String(content || "");
    if (!text) return;
    try {
      var history = readHistory().filter(function (item) { return item.content !== text; });
      history.unshift({
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        type: type || "text",
        content: text,
        timestamp: Date.now()
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 80)));
    } catch (_) {}
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {
      detail: {message: String(message)}
    }));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {});
    }
    return Promise.resolve();
  }

  function isEditable(element) {
    if (!element || element.disabled || element.readOnly) return false;
    var tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
  }

  function captureTarget() {
    var active = document.activeElement;
    lastTarget = isEditable(active) ? active : null;
    savedRange = null;
    if (lastTarget && lastTarget.isContentEditable) {
      var selection = window.getSelection();
      if (selection && selection.rangeCount) savedRange = selection.getRangeAt(0).cloneRange();
    }
  }

  function insertText(text) {
    var target = lastTarget;
    if (target && document.contains(target) && isEditable(target)) {
      target.focus();
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        var start = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
        var end = typeof target.selectionEnd === "number" ? target.selectionEnd : start;
        target.setRangeText(text, start, end, "end");
        target.dispatchEvent(new Event("input", {bubbles: true}));
      } else {
        var selection = window.getSelection();
        if (selection && savedRange) {
          selection.removeAllRanges();
          selection.addRange(savedRange);
        }
        document.execCommand("insertText", false, text);
        target.dispatchEvent(new Event("input", {bubbles: true}));
      }
    }
    copyText(text);
    saveHistory(text, "emoji");
    notify("Copied " + text + " to the A-OS clipboard.");
    closePicker(true);
  }

  function loadPack() {
    if (packPromise) return packPromise;
    var completePromise = window.AOS_COMPLETE_EMOJI_CATALOG
      ? Promise.resolve(window.AOS_COMPLETE_EMOJI_CATALOG)
      : fetch(CATALOG_URL, {cache: "force-cache"}).then(function (response) {
          if (!response.ok) throw new Error("Complete emoji catalog could not be loaded.");
          return response.json();
        });
    var originalsPromise = window.AOS_ORIGINAL_EMOJI_MANIFEST
      ? Promise.resolve(window.AOS_ORIGINAL_EMOJI_MANIFEST)
      : fetch(ORIGINALS_URL, {cache: "force-cache"}).then(function (response) {
          if (!response.ok) throw new Error("A-OS Originals catalog could not be loaded.");
          return response.json();
        });
    packPromise = Promise.all([completePromise, originalsPromise]).then(function (results) {
      var complete = results[0];
      var originals = results[1];
      state.unicode = (complete.items || []).map(function (item) {
        return {
          id: item.id,
          symbol: item.symbol,
          name: item.name,
          group: item.group,
          subgroup: item.subgroup,
          src: "./assets/emojis/aos-complete/svg/" + item.file
        };
      });
      state.originals = (originals.items || []).map(function (item, index) {
        return {
          id: "aos-original-" + index,
          symbol: item.symbol,
          name: item.name,
          group: "A-OS Originals",
          subgroup: "A-OS designed emoji",
          src: "./assets/emojis/aos-3d/" + item.file
        };
      });
      state.groups = ["A-OS Originals", "All"].concat(complete.groups || []);
      return state;
    }).catch(function (error) {
      packPromise = null;
      throw error;
    });
    return packPromise;
  }

  function button(className, label, title) {
    var element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    if (title) element.title = title;
    return element;
  }

  function filteredItems() {
    var twemojiOnly = localStorage.getItem("aos-active-emoji-pack") === "Twitter / Twemoji";
    var all = twemojiOnly ? state.unicode : state.originals.concat(state.unicode);
    var group = state.group;
    var query = state.query.trim().toLowerCase();
    return all.filter(function (item) {
      if (group !== "All" && item.group !== group) return false;
      if (!query) return true;
      return [item.symbol, item.name, item.group, item.subgroup].join(" ").toLowerCase().indexOf(query) !== -1;
    });
  }

  function renderCategories(container) {
    container.textContent = "";
    var twemojiOnly = localStorage.getItem("aos-active-emoji-pack") === "Twitter / Twemoji";
    state.groups.filter(function (group) { return !twemojiOnly || group !== "A-OS Originals"; }).forEach(function (group) {
      var chip = button("aos-complete-emoji-category", group);
      chip.setAttribute("aria-pressed", String(group === state.group));
      chip.addEventListener("click", function () {
        state.group = group;
        state.visible = PAGE_SIZE;
        renderPickerBody();
      });
      container.appendChild(chip);
    });
  }

  function makeEmojiButton(item) {
    var itemButton = button("aos-complete-emoji-item", "", item.name);
    itemButton.setAttribute("aria-label", item.name);
    var image = document.createElement("img");
    image.src = item.src;
    image.alt = item.symbol;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", function () {
      image.remove();
      itemButton.textContent = item.symbol;
    }, {once: true});
    itemButton.appendChild(image);
    itemButton.addEventListener("click", function () { insertText(item.symbol); });
    return itemButton;
  }

  function renderEmojiView(body, footer) {
    var categories = document.createElement("div");
    categories.className = "aos-complete-emoji-categories";
    renderCategories(categories);
    body.appendChild(categories);

    var search = document.createElement("input");
    search.className = "aos-complete-emoji-search";
    search.type = "search";
    search.placeholder = "Search all emoji";
    search.autocomplete = "off";
    search.value = state.query;
    search.setAttribute("aria-label", "Search all emoji");
    search.addEventListener("input", function () {
      state.query = search.value;
      state.visible = PAGE_SIZE;
      renderEmojiGrid(body, footer, categories, search);
    });
    body.appendChild(search);
    renderEmojiGrid(body, footer, categories, search);
  }

  function renderEmojiGrid(body, footer, categories, search) {
    body.querySelectorAll(".aos-complete-emoji-grid, .aos-complete-emoji-empty, .aos-complete-emoji-more").forEach(function (node) {
      node.remove();
    });
    var results = filteredItems();
    var shown = results.slice(0, state.visible);
    var grid = document.createElement("div");
    grid.className = "aos-complete-emoji-grid";
    grid.setAttribute("role", "grid");
    var fragment = document.createDocumentFragment();
    shown.forEach(function (item) { fragment.appendChild(makeEmojiButton(item)); });
    grid.appendChild(fragment);
    body.appendChild(grid);

    if (!results.length) {
      var empty = document.createElement("p");
      empty.className = "aos-complete-emoji-empty";
      empty.textContent = "No emoji match this search.";
      body.appendChild(empty);
    } else if (shown.length < results.length) {
      var more = button("aos-complete-emoji-more", "Show more");
      more.addEventListener("click", function () {
        state.visible += PAGE_SIZE;
        renderEmojiGrid(body, footer, categories, search);
      });
      body.appendChild(more);
    }
    var twemojiOnly = localStorage.getItem("aos-active-emoji-pack") === "Twitter / Twemoji";
    footer.textContent = shown.length + " of " + results.length + " shown | " +
      (twemojiOnly ? "Twitter / Twemoji 14.0.2" : (state.originals.length + state.unicode.length) + " emoji installed locally");
  }

  function renderClipboardView(body, footer) {
    var history = readHistory();
    var list = document.createElement("div");
    list.className = "aos-complete-clipboard-list";
    if (!history.length) {
      var empty = document.createElement("p");
      empty.className = "aos-complete-emoji-empty";
      empty.textContent = "The A-OS clipboard is empty.";
      list.appendChild(empty);
    }
    history.forEach(function (item) {
      var itemButton = button("aos-complete-clipboard-item", item.content, "Copy clipboard item");
      itemButton.addEventListener("click", function () { insertText(item.content); });
      list.appendChild(itemButton);
    });
    body.appendChild(list);
    footer.textContent = history.length + " clipboard item" + (history.length === 1 ? "" : "s");
  }

  function renderPickerBody() {
    if (!overlay) return;
    var body = overlay.querySelector(".aos-complete-emoji-body");
    var footer = overlay.querySelector(".aos-complete-emoji-footer");
    var tabs = overlay.querySelectorAll(".aos-complete-emoji-tab");
    body.textContent = "";
    tabs.forEach(function (tab) {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === state.tab));
    });
    if (state.tab === "clipboard") renderClipboardView(body, footer);
    else renderEmojiView(body, footer);
  }

  function buildPicker() {
    overlay = document.createElement("div");
    overlay.className = "aos-complete-emoji-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) closePicker(true);
    });

    var picker = document.createElement("section");
    picker.className = "aos-complete-emoji-picker";
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-modal", "true");
    picker.setAttribute("aria-label", "A-OS emoji and clipboard");

    var header = document.createElement("header");
    var title = document.createElement("strong");
    title.textContent = "Emoji & Clipboard";
    var close = button("aos-complete-emoji-close", "\u00d7", "Close");
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", function () { closePicker(true); });
    header.append(title, close);

    var tabBar = document.createElement("div");
    tabBar.className = "aos-complete-emoji-tabs";
    tabBar.setAttribute("role", "tablist");
    [["emoji", "Emoji"], ["clipboard", "Clipboard"]].forEach(function (entry) {
      var tab = button("aos-complete-emoji-tab", entry[1]);
      tab.dataset.tab = entry[0];
      tab.setAttribute("role", "tab");
      tab.addEventListener("click", function () {
        state.tab = entry[0];
        renderPickerBody();
      });
      tabBar.appendChild(tab);
    });

    var body = document.createElement("div");
    body.className = "aos-complete-emoji-body";
    var footer = document.createElement("footer");
    footer.className = "aos-complete-emoji-footer";
    picker.append(header, tabBar, body, footer);
    overlay.appendChild(picker);
    document.body.appendChild(overlay);
    document.body.classList.add("aos-complete-emoji-open");
    renderPickerBody();
    window.setTimeout(function () {
      var search = overlay && overlay.querySelector(".aos-complete-emoji-search");
      if (search) search.focus();
    }, 0);
  }

  function openPicker(tab) {
    if (overlay) {
      if (tab) state.tab = tab;
      renderPickerBody();
      return;
    }
    captureTarget();
    state.tab = tab || "emoji";
    state.group = "All";
    state.query = "";
    state.visible = PAGE_SIZE;
    loadPack().then(buildPicker).catch(function (error) {
      notify(error && error.message ? error.message : "The emoji pack could not be loaded.");
    });
  }

  function closePicker(closeLegacyPicker) {
    if (overlay) overlay.remove();
    overlay = null;
    document.body.classList.remove("aos-complete-emoji-open");
    if (closeLegacyPicker) {
      window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    }
    if (lastTarget && document.contains(lastTarget)) lastTarget.focus();
  }

  window.addEventListener("keydown", function (event) {
    var trigger = (event.ctrlKey || event.metaKey || event.shiftKey) && event.code === "Period";
    if (trigger) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPicker("emoji");
      return;
    }
    if (event.key === "Escape" && overlay) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePicker(false);
    }
  }, true);

  window.addEventListener("aos-open-quick-palette", function (event) {
    var tab = event && event.detail && event.detail.tab === "clipboard" ? "clipboard" : "emoji";
    openPicker(tab);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPack, {once: true});
  } else {
    loadPack();
  }
})();
