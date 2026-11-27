(function () {
  "use strict";

  var SEARCH_ID = "aos-sys-search";
  var STATUS_KEY = "aos-show-system-status-bar";
  var PIN_KEY = "aos-sys-search-pinned";
  var searchRoot = null;
  var searchInput = null;
  var resultsRoot = null;
  var wikipediaTimer = 0;
  var wikipediaController = null;
  var statusTimer = 0;

  function asset(name) {
    return new URL("./assets/icons/" + name, document.baseURI).href;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>\"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[character];
    });
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function pinned() {
    return localStorage.getItem(PIN_KEY) === "true";
  }

  function hostDesktop() {
    return document.querySelector(".desktop") || document.body;
  }

  function appEntries() {
    var entries = [];
    var seen = new Set();
    var selector = ".shelf .shelf-icon[aria-label], .desk-shortcut, .launcher button";
    document.querySelectorAll(selector).forEach(function (button) {
      var name = String(button.getAttribute("aria-label") || button.textContent || "").trim();
      var key = normalize(name);
      if (!key || seen.has(key) || /account|launcher|quick button|ai shortcut/i.test(name)) return;
      var image = button.querySelector("img");
      seen.add(key);
      entries.push({
        type: "App",
        name: name,
        detail: "Open application",
        icon: image && image.src ? image.src : asset("System.png"),
        action: function () { button.click(); }
      });
    });
    return entries;
  }

  function fileEntries() {
    var files = [];
    try {
      files = JSON.parse(localStorage.getItem("aos-files") || "[]");
    } catch (_) {}
    return Array.isArray(files) ? files.map(function (file) {
      return {
        type: file.type === "folder" ? "Folder" : "File",
        name: file.name || "Untitled",
        detail: file.parent === "root" ? "Desktop" : (file.parent || "A-OS Files"),
        icon: file.icon && /^(data:|https?:)/i.test(file.icon) ? file.icon : asset(file.icon || (file.type === "folder" ? "Files.png" : "Text Editor.png")),
        action: function () { openApp("Files"); }
      };
    }) : [];
  }

  function openApp(name) {
    var target = Array.from(document.querySelectorAll(".shelf [aria-label], .launcher button, .desk-shortcut")).find(function (button) {
      return normalize(button.getAttribute("aria-label") || button.textContent) === normalize(name);
    });
    if (target) target.click();
    closeSearchUnlessPinned();
  }

  function openUrl(url) {
    var browserButton = document.querySelector('.shelf [aria-label="OSInternet"]');
    if (browserButton) browserButton.click();
    window.setTimeout(function () {
      var address = document.querySelector('input[aria-label="Address and search bar"]');
      if (!address) {
        window.open(url, "_blank", "noopener");
        return;
      }
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(address, url);
      address.dispatchEvent(new Event("input", {bubbles: true}));
      address.dispatchEvent(new Event("change", {bubbles: true}));
      address.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", code: "Enter", bubbles: true}));
      var openButton = address.parentElement && address.parentElement.querySelector('button[aria-label="Open address"]');
      if (openButton) openButton.click();
    }, 180);
    closeSearchUnlessPinned();
  }

  function resultButton(entry) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "aos-sys-search-result";
    button.innerHTML = '<img src="' + escapeHtml(entry.icon) + '" alt=""><span><b>' + escapeHtml(entry.name) + '</b><small>' + escapeHtml(entry.detail) + '</small></span><em>' + escapeHtml(entry.type) + "</em>";
    button.addEventListener("click", entry.action);
    return button;
  }

  function section(title, entries) {
    if (!entries.length) return null;
    var root = document.createElement("section");
    root.className = "aos-sys-search-section";
    root.innerHTML = "<h2>" + escapeHtml(title) + "</h2>";
    entries.forEach(function (entry) { root.appendChild(resultButton(entry)); });
    return root;
  }

  function renderLocalResults(query) {
    if (!resultsRoot) return;
    var needle = normalize(query);
    var apps = appEntries().filter(function (entry) { return !needle || normalize(entry.name).includes(needle); });
    var files = fileEntries().filter(function (entry) { return !needle || normalize(entry.name).includes(needle); });
    resultsRoot.replaceChildren();

    var appsSection = section(needle ? "Apps" : "Quick access", apps.slice(0, needle ? 8 : 5));
    var filesSection = section("Files and folders", files.slice(0, 8));
    if (appsSection) resultsRoot.appendChild(appsSection);
    if (filesSection) resultsRoot.appendChild(filesSection);

    if (!appsSection && !filesSection) {
      var empty = document.createElement("div");
      empty.className = "aos-sys-search-empty";
      empty.innerHTML = '<img src="' + asset("Search.svg") + '" alt=""><b>No local results</b><span>SYS Search can still check Wikipedia.</span>';
      resultsRoot.appendChild(empty);
    }
  }

  function addWikipediaResult(data) {
    if (!resultsRoot || !data || !data.title) return;
    var root = document.createElement("section");
    root.className = "aos-sys-search-section";
    var article = document.createElement("article");
    article.className = "aos-sys-search-wikipedia";
    article.innerHTML = "<h3>" + escapeHtml(data.title) + "</h3><p>" + escapeHtml(data.extract || "Wikipedia result") + "</p>";
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open in OSInternet";
    button.addEventListener("click", function () {
      openUrl(data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page || "https://en.wikipedia.org/wiki/" + encodeURIComponent(data.title));
    });
    article.appendChild(button);
    root.innerHTML = "<h2>Wikipedia</h2>";
    root.appendChild(article);
    resultsRoot.appendChild(root);
  }

  function scheduleWikipedia(query) {
    window.clearTimeout(wikipediaTimer);
    if (wikipediaController) wikipediaController.abort();
    var clean = String(query || "").trim();
    if (clean.length < 2 || !navigator.onLine) return;
    wikipediaTimer = window.setTimeout(function () {
      wikipediaController = new AbortController();
      fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(clean), {
        headers: {Accept: "application/json"},
        signal: wikipediaController.signal
      }).then(function (response) {
        if (!response.ok) throw new Error("No Wikipedia result");
        return response.json();
      }).then(addWikipediaResult).catch(function (error) {
        if (error.name !== "AbortError") console.info("SYS Search: Wikipedia is unavailable.");
      });
    }, 420);
  }

  function renderSearch() {
    var query = searchInput ? searchInput.value : "";
    renderLocalResults(query);
    scheduleWikipedia(query);
  }

  function updatePinState() {
    if (!searchRoot) return;
    var pinButton = searchRoot.querySelector("[data-sys-search-pin]");
    pinButton.setAttribute("aria-pressed", pinned() ? "true" : "false");
    pinButton.title = pinned() ? "Unpin SYS Search" : "Pin SYS Search";
    searchRoot.querySelector("[data-sys-search-pin-label]").textContent = pinned() ? "Unpin Search" : "Pin Search";
  }

  function createSearch() {
    if (searchRoot && searchRoot.isConnected) return searchRoot;
    searchRoot = document.createElement("section");
    searchRoot.id = SEARCH_ID;
    searchRoot.className = "aos-sys-search";
    searchRoot.hidden = true;
    searchRoot.setAttribute("role", "dialog");
    searchRoot.setAttribute("aria-label", "SYS Search");
    searchRoot.innerHTML = '<header><div class="aos-sys-search-brand"><img src="' + asset("Search.svg") + '" alt=""><span><strong>SYS Search</strong><small>Apps, files and Wikipedia</small></span></div><button type="button" class="aos-sys-search-icon-button" data-sys-search-pin aria-label="Pin SYS Search">&#9679;</button><button type="button" class="aos-sys-search-icon-button" data-sys-search-close aria-label="Close SYS Search">&times;</button></header><label class="aos-sys-search-field"><img src="' + asset("Search.svg") + '" alt=""><input type="search" autocomplete="off" placeholder="Search apps, system files, and Wikipedia"><kbd>Ctrl Space</kbd></label><div class="aos-sys-search-results" aria-live="polite"></div><footer><span>SYS Search keeps local results on this device.</span><button type="button" data-sys-search-pin-label>Pin Search</button></footer>';
    searchInput = searchRoot.querySelector("input");
    resultsRoot = searchRoot.querySelector(".aos-sys-search-results");
    searchInput.addEventListener("input", renderSearch);
    searchRoot.querySelector("[data-sys-search-close]").addEventListener("click", hideSearch);
    searchRoot.querySelector("[data-sys-search-pin]").addEventListener("click", togglePin);
    searchRoot.querySelector("[data-sys-search-pin-label]").addEventListener("click", togglePin);
    hostDesktop().appendChild(searchRoot);
    updatePinState();
    renderSearch();
    return searchRoot;
  }

  function togglePin() {
    localStorage.setItem(PIN_KEY, pinned() ? "false" : "true");
    updatePinState();
  }

  function showSearch() {
    var root = createSearch();
    root.hidden = false;
    renderSearch();
    window.requestAnimationFrame(function () { searchInput.focus(); });
  }

  function hideSearch() {
    if (searchRoot) searchRoot.hidden = true;
  }

  function closeSearchUnlessPinned() {
    if (!pinned()) hideSearch();
  }

  function statusBarVisible() {
    return localStorage.getItem(STATUS_KEY) === "true";
  }

  function formatStatusTime() {
    return new Intl.DateTimeFormat(undefined, {weekday: "short", hour: "2-digit", minute: "2-digit"}).format(new Date());
  }

  function createStatusBar(desktop) {
    var existing = desktop.querySelector(".aos-system-statusbar");
    if (existing) return existing;
    var bar = document.createElement("nav");
    bar.className = "aos-system-statusbar";
    bar.setAttribute("aria-label", "A-OS system status bar");
    bar.innerHTML = '<img src="' + asset("OS Logo.png") + '" alt="A-OS"><button type="button" data-status-action="openbox">OpenBox</button><button type="button" data-status-action="files">File</button><button type="button" data-status-action="edit">Edit</button><button type="button" data-status-action="apps">Apps</button><button type="button" data-status-action="exit">Exit</button><span class="aos-system-statusbar-spacer"></span><span class="aos-system-statusbar-output"><span data-status-network>Online</span><time></time></span>';
    bar.addEventListener("click", function (event) {
      var action = event.target.closest("[data-status-action]");
      if (!action) return;
      if (action.dataset.statusAction === "files") openApp("Files");
      if (action.dataset.statusAction === "apps") {
        var launcher = document.querySelector(".launcher-button");
        if (launcher) launcher.click();
      }
      if (action.dataset.statusAction === "openbox") {
        var terminal = document.querySelector('.shelf [aria-label="Terminal"]');
        if (terminal) terminal.click();
      }
      if (action.dataset.statusAction === "edit") showSearch();
      if (action.dataset.statusAction === "exit") {
        var account = document.querySelector('.shelf [aria-label$="Account"]');
        if (account) account.click();
      }
    });
    desktop.appendChild(bar);
    return bar;
  }

  function applyStatusBar() {
    document.querySelectorAll(".desktop").forEach(function (desktop) {
      var bar = createStatusBar(desktop);
      desktop.classList.toggle("aos-status-bar-visible", statusBarVisible());
      var time = bar.querySelector("time");
      var network = bar.querySelector("[data-status-network]");
      var timeText = formatStatusTime();
      var networkText = navigator.onLine ? "Online" : "Offline";
      if (time && time.textContent !== timeText) time.textContent = timeText;
      if (network && network.textContent !== networkText) network.textContent = networkText;
    });
  }

  function toggleStatusBar() {
    localStorage.setItem(STATUS_KEY, statusBarVisible() ? "false" : "true");
    applyStatusBar();
    enhanceDesktopActions();
  }

  function enhanceDesktopActions() {
    document.querySelectorAll(".desktop-context-menu").forEach(function (menu) {
      var existing = menu.querySelector("[data-aos-status-bar-toggle]");
      if (existing) {
        var label = existing.querySelector("b");
        var labelText = statusBarVisible() ? "Hide Status Bar" : "Show Status Bar";
        if (label && label.textContent !== labelText) label.textContent = labelText;
        return;
      }
      var footer = menu.querySelector("footer");
      if (!footer) return;
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.aosStatusBarToggle = "true";
      button.setAttribute("role", "menuitem");
      button.innerHTML = '<span><img src="' + asset("System.png") + '" alt=""></span><b>' + (statusBarVisible() ? "Hide Status Bar" : "Show Status Bar") + "</b><small>5</small>";
      button.addEventListener("click", function () {
        toggleStatusBar();
        var close = menu.querySelector('header button[aria-label="Close menu"]');
        if (close) close.click();
      });
      footer.insertAdjacentElement("beforebegin", button);
    });
  }

  function attachSearchButton(button) {
    if (button.dataset.aosSysSearchReady === "true") return;
    button.dataset.aosSysSearchReady = "true";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", SEARCH_ID);
  }

  function enhance() {
    document.querySelectorAll(".search-pill").forEach(attachSearchButton);
    applyStatusBar();
    enhanceDesktopActions();
    if (searchRoot && !searchRoot.closest(".desktop")) hostDesktop().appendChild(searchRoot);
  }

  document.addEventListener("click", function (event) {
    var searchButton = event.target.closest && event.target.closest(".search-pill");
    if (searchButton) {
      event.preventDefault();
      event.stopPropagation();
      showSearch();
      return;
    }
    if (!pinned() && searchRoot && !searchRoot.hidden && !event.target.closest(".aos-sys-search")) hideSearch();
  }, true);

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
      event.preventDefault();
      if (searchRoot && !searchRoot.hidden) hideSearch();
      else showSearch();
    }
    if (event.key === "Escape" && searchRoot && !searchRoot.hidden) hideSearch();
  });

  window.addEventListener("online", applyStatusBar);
  window.addEventListener("offline", applyStatusBar);
  window.addEventListener("storage", function (event) {
    if (event.key === STATUS_KEY) applyStatusBar();
    if (event.key === PIN_KEY) updatePinState();
  });

  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      enhance();
    });
  }).observe(document.documentElement, {childList: true, subtree: true});

  statusTimer = window.setInterval(applyStatusBar, 30000);
  window.addEventListener("pagehide", function () { window.clearInterval(statusTimer); }, {once: true});
  enhance();
})();
