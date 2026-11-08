(function () {
  "use strict";

  if (window.AOS_NEW_PREVIEW) return;
  window.AOS_NEW_PREVIEW = true;

  var ACCOUNT_ONLY_KEY = "aos-account-only-mode";
  var ACCOUNT_USERS_KEY = "aos-account-only-users";
  var SESSION_KEY = "aos-aapplications-session";
  var MAX_PASSWORD_FAILURES = 5;
  var LOCKOUT_MS = 30000;
  var accountUnlockInProgress = false;
  var autoLockAppsOpened = false;
  var enhanceQueued = false;

  function parse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function profileName() {
    return localStorage.getItem("aos-profile") || "Person";
  }

  function passwordKey(name) {
    return "aos-profile-password-" + encodeURIComponent(name || profileName());
  }

  function attemptKey() {
    return "aos-login-attempts-" + encodeURIComponent(profileName());
  }

  function attemptState() {
    var state = parse(localStorage.getItem(attemptKey()) || "{}", {});
    return {failures: Number(state.failures || 0), lockUntil: Number(state.lockUntil || 0)};
  }

  function saveAttemptState(state) {
    localStorage.setItem(attemptKey(), JSON.stringify(state));
  }

  function loginForm(login) {
    return Array.from(login.querySelectorAll("form")).find(function (form) {
      var submit = form.querySelector('button[type="submit"]');
      return submit && submit.textContent.trim() === "Continue";
    }) || null;
  }

  function loginStatus(form) {
    var status = form.querySelector(".aos-login-attempt-status");
    if (!status) {
      status = document.createElement("div");
      status.className = "aos-login-attempt-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      form.appendChild(status);
    }
    return status;
  }

  function updateLockout(form) {
    if (!form) return;
    var state = attemptState();
    var remaining = Math.max(0, state.lockUntil - Date.now());
    var input = form.querySelector('input[type="password"]');
    var submit = form.querySelector('button[type="submit"]');
    var status = loginStatus(form);
    if (remaining > 0) {
      var seconds = Math.ceil(remaining / 1000);
      if (input) input.disabled = true;
      if (submit) submit.disabled = true;
      status.className = "aos-login-attempt-status error";
      status.textContent = "Too many wrong passwords. Try again in " + seconds + " seconds.";
      return;
    }
    if (state.lockUntil) {
      saveAttemptState({failures: 0, lockUntil: 0});
      status.textContent = "You can try again now.";
    }
    if (input) input.disabled = false;
    if (submit) submit.disabled = false;
  }

  function handlePasswordSubmit(event) {
    var login = event.target && event.target.closest && event.target.closest(".login-modern");
    if (!login || accountUnlockInProgress) return;
    var form = loginForm(login);
    if (!form || event.target !== form) return;
    if (localStorage.getItem(ACCOUNT_ONLY_KEY) === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    var state = attemptState();
    if (state.lockUntil > Date.now()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      updateLockout(form);
      return;
    }
    var input = form.querySelector('input[type="password"]');
    var entered = input ? input.value : "";
    var expected = localStorage.getItem(passwordKey()) || localStorage.getItem("aos-password") || "";
    if (!expected || entered === expected) {
      saveAttemptState({failures: 0, lockUntil: 0});
      return;
    }
    state.failures += 1;
    if (state.failures >= MAX_PASSWORD_FAILURES) {
      state.lockUntil = Date.now() + LOCKOUT_MS;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    saveAttemptState(state);
    var status = loginStatus(form);
    status.className = "aos-login-attempt-status error";
    status.textContent = state.lockUntil
      ? "Too many wrong passwords. Wait 30 seconds before trying again."
      : "Wrong password. " + (MAX_PASSWORD_FAILURES - state.failures) + " attempts remaining.";
    updateLockout(form);
  }

  function removeOddAvatar(login) {
    var path = login.querySelector('path[d^="M50 12 L82 84"]');
    if (!path) return;
    var svg = path.closest("svg");
    var outer = svg && svg.parentElement && svg.parentElement.parentElement;
    if (outer) outer.classList.add("aos-odd-avatar");
    else if (svg) svg.classList.add("aos-odd-avatar");
  }

  function readSession() {
    var session = parse(localStorage.getItem(SESSION_KEY) || "null", null);
    return session && session.uid && session.email ? session : null;
  }

  function accountUsers() {
    var users = parse(localStorage.getItem(ACCOUNT_USERS_KEY) || "[]", []);
    return Array.isArray(users) ? users : [];
  }

  function saveAccountUsers(users) {
    localStorage.setItem(ACCOUNT_USERS_KEY, JSON.stringify(users));
  }

  function profileForSession(session) {
    var profiles = parse(localStorage.getItem("aos-profiles") || "[]", []);
    if (!Array.isArray(profiles)) profiles = [];
    var profile = profiles.find(function (item) {
      return String(item.email || "").toLowerCase() === String(session.email || "").toLowerCase();
    });
    if (!profile) {
      var base = String(session.email || "A-Applications").split("@")[0] || "A-Applications";
      var name = base;
      var number = 2;
      while (profiles.some(function (item) { return item.name === name; })) name = base + " " + number++;
      profile = {name: name, email: session.email, role: profiles.length ? "standard" : "admin"};
      profiles.push(profile);
      localStorage.setItem("aos-profiles", JSON.stringify(profiles));
    }
    return profile;
  }

  function tokenForSession(session) {
    var key = "aos-account-device-token-" + encodeURIComponent(session.uid);
    var token = localStorage.getItem(key);
    if (!token) {
      var bytes = new Uint32Array(4);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes).map(function (value) { return value.toString(36); }).join("");
      localStorage.setItem(key, token);
    }
    return token;
  }

  function registerAccount(session) {
    var profile = profileForSession(session);
    var users = accountUsers().filter(function (item) { return item.uid !== session.uid; });
    users.push({uid: session.uid, email: session.email, profile: profile.name, addedAt: Date.now()});
    saveAccountUsers(users);
    var token = tokenForSession(session);
    localStorage.setItem(passwordKey(profile.name), token);
    localStorage.setItem("aos-auto-backup", "true");
    localStorage.setItem("aos-auto-apply-cloud", "true");
    localStorage.setItem("aos-aapplications-sync-options", JSON.stringify({settings: true, files: true, apps: true, sessions: true}));
    return {profile: profile, token: token};
  }

  function setReactInput(input, value) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.dispatchEvent(new Event("change", {bubbles: true}));
  }

  function unlockWithAccount(login, session) {
    var registered = registerAccount(session);
    if (profileName() !== registered.profile.name) {
      localStorage.setItem("aos-profile", registered.profile.name);
      localStorage.setItem("aos-email", registered.profile.email || "");
      localStorage.setItem("aos-password", registered.token);
      localStorage.setItem("aos-configured", "true");
      location.reload();
      return;
    }
    var form = loginForm(login);
    var input = form && form.querySelector('input[type="password"]');
    if (!form || !input) return;
    localStorage.setItem("aos-password", registered.token);
    accountUnlockInProgress = true;
    setReactInput(input, registered.token);
    setTimeout(function () {
      form.requestSubmit();
      setTimeout(function () { accountUnlockInProgress = false; }, 500);
    }, 60);
  }

  function accountOnlyCard(login) {
    if (login.querySelector(".aos-account-only-card")) return;
    var form = loginForm(login);
    if (!form) return;
    login.classList.add("aos-account-only-active");
    var card = document.createElement("section");
    card.className = "aos-account-only-card";
    card.innerHTML = '<img src="../assets/icons/Profile.png" alt=""><h2>A-Applications account</h2><p>Sign in to load this account\'s A-OS files, apps and settings.</p><form><label>Email<input type="email" autocomplete="username" required></label><label>Password<input type="password" autocomplete="current-password" required></label><div class="aos-account-login-status" role="status"></div><button type="submit">Sign in to this PC</button></form>';
    var host = form.parentElement && form.parentElement.parentElement || login;
    host.appendChild(card);
    var accountForm = card.querySelector("form");
    accountForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = accountForm.querySelector("button");
      var status = card.querySelector(".aos-account-login-status");
      button.disabled = true;
      status.textContent = "Signing in...";
      try {
        if (!window.AOS_STORE_PLATFORM) throw new Error("A-Applications is still starting. Try again in a moment.");
        var inputs = accountForm.querySelectorAll("input");
        var session = await window.AOS_STORE_PLATFORM.signIn(inputs[0].value, inputs[1].value);
        status.textContent = "Account verified. Loading your A-OS workspace...";
        unlockWithAccount(login, session);
      } catch (error) {
        status.textContent = error.message || "The account could not sign in.";
        button.disabled = false;
      }
    });
    var existing = readSession();
    if (existing) {
      card.querySelector(".aos-account-login-status").textContent = "Restoring " + existing.email + "...";
      setTimeout(function () { unlockWithAccount(login, existing); }, 250);
    }
  }

  function installedLockApps() {
    var apps = parse(localStorage.getItem("aos-dev-apps") || "[]", []);
    return Array.isArray(apps) ? apps.filter(function (app) {
      return app && app.storeSlug && (app.lockscreenMode === "visible" || app.lockscreenMode === "active");
    }) : [];
  }

  function openLockApp(app) {
    if (!window.AOS_STORE_PLATFORM) return;
    window.AOS_STORE_PLATFORM.openApp(app, {locked: true});
  }

  function enhanceLockApps(login) {
    var apps = installedLockApps();
    var existing = login.querySelector(".aos-lockscreen-apps");
    if (!apps.length) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = document.createElement("div");
      existing.className = "aos-lockscreen-apps";
      existing.innerHTML = '<span>Lock screen apps</span><div></div>';
      login.appendChild(existing);
    }
    var buttons = existing.querySelector("div");
    buttons.innerHTML = "";
    apps.forEach(function (app) {
      var button = document.createElement("button");
      button.type = "button";
      button.innerHTML = '<img src="' + String(app.icon || "../assets/icons/Unnamed app.png").replace(/"/g, "&quot;") + '" alt=""><span>' + String(app.name || "App").replace(/[<>&]/g, "") + '</span>';
      button.addEventListener("click", function () { openLockApp(app); });
      buttons.appendChild(button);
    });
    if (!autoLockAppsOpened && window.AOS_STORE_PLATFORM) {
      autoLockAppsOpened = true;
      apps.filter(function (app) { return app.lockscreenMode === "active"; }).forEach(openLockApp);
    }
  }

  function renderAccountManager(panel) {
    var list = panel.querySelector("[data-account-users]");
    var users = accountUsers();
    list.innerHTML = users.length ? "" : '<p class="aos-account-empty">No A-Applications accounts are saved on this device.</p>';
    users.forEach(function (user) {
      var row = document.createElement("div");
      row.className = "aos-account-user-row";
      row.innerHTML = '<img src="../assets/icons/Profile.png" alt=""><span><b>' + String(user.profile || user.email).replace(/[<>&]/g, "") + '</b><small>' + String(user.email || "").replace(/[<>&]/g, "") + '</small></span><button type="button">Remove</button>';
      row.querySelector("button").addEventListener("click", function () {
        if (!window.confirm("Remove " + user.email + " from this A-OS device?")) return;
        saveAccountUsers(accountUsers().filter(function (item) { return item.uid !== user.uid; }));
        var profiles = parse(localStorage.getItem("aos-profiles") || "[]", []);
        profiles = Array.isArray(profiles) ? profiles.filter(function (item) { return item.name !== user.profile; }) : [];
        localStorage.setItem("aos-profiles", JSON.stringify(profiles));
        localStorage.removeItem(passwordKey(user.profile));
        localStorage.removeItem("aos-profile-workspace-" + encodeURIComponent(user.profile || ""));
        localStorage.removeItem("aos-account-device-token-" + encodeURIComponent(user.uid));
        var session = readSession();
        if (session && session.uid === user.uid && window.AOS_STORE_PLATFORM) window.AOS_STORE_PLATFORM.signOut();
        renderAccountManager(panel);
      });
      list.appendChild(row);
    });
  }

  function enhanceDeviceOwner() {
    document.querySelectorAll(".aos-account-only-settings").forEach(function (panel) {
      if (!panel.closest(".aos-organization-settings")) panel.remove();
    });

    var ownerPanel = document.querySelector(".aos-organization-settings");
    if (!ownerPanel || ownerPanel.querySelector(".aos-account-only-settings")) return;
    var body = ownerPanel.querySelector(".aos-organization-settings-main") || ownerPanel;
    var panel = document.createElement("article");
    panel.className = "aos-organization-card aos-account-only-settings";
    panel.innerHTML = '<div><img src="../assets/icons/Profile.png" alt=""><span><b>Account-only device</b><small>Device owner control. Require an A-Applications account at the lock screen and automatically save each account workspace.</small></span><label class="aos-account-switch" title="Require an account"><input type="checkbox"><i></i></label></div><h3>Accounts saved on this device</h3><div data-account-users></div>';
    body.appendChild(panel);
    var toggle = panel.querySelector('input[type="checkbox"]');
    toggle.checked = localStorage.getItem(ACCOUNT_ONLY_KEY) === "true";
    toggle.addEventListener("change", function () {
      localStorage.setItem(ACCOUNT_ONLY_KEY, toggle.checked ? "true" : "false");
      var session = readSession();
      if (toggle.checked && session) registerAccount(session);
      window.dispatchEvent(new Event("aos-account-only-changed"));
    });
    renderAccountManager(panel);
  }

  function loginClockText() {
    return new Intl.DateTimeFormat([], {hour: "2-digit", minute: "2-digit"}).format(new Date());
  }

  function enhanceLoginClock(login) {
    var heading = Array.from(login.querySelectorAll("h1")).find(function (node) {
      return node.dataset.aosLoginClock === "true" || /Login to A-OS Computer/i.test(node.textContent || "");
    });
    if (!heading) return;
    heading.dataset.aosLoginClock = "true";
    heading.textContent = loginClockText();
    heading.setAttribute("aria-label", "Current time " + heading.textContent);
  }

  function enhanceTerminalVersion() {
    document.querySelectorAll(".system-terminal").forEach(function (terminal) {
      var title = terminal.querySelector("header b, header strong");
      if (title && /^A-OS Terminal(?:\s+[\d.]+)?$/i.test((title.textContent || "").trim())) title.textContent = "A-OS Terminal 2.4";
      terminal.querySelectorAll("main div").forEach(function (line) {
        if (/A-OS Terminal 1\.0/i.test(line.textContent || "")) line.textContent = (line.textContent || "").replace(/A-OS Terminal 1\.0/gi, "A-OS Terminal 2.4");
      });
    });
  }

  function officialMediaEmbed(address) {
    try {
      var url = new URL(String(address || "").trim());
      var host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com") {
        var videoId = host === "youtu.be" ? url.pathname.split("/")[1] : url.searchParams.get("v");
        if (!videoId) {
          var match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
          videoId = match && match[1];
        }
        if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return "https://www.youtube.com/embed/" + videoId + "?autoplay=1&rel=0";
      }
      if (host === "open.spotify.com") {
        var spotifyPath = url.pathname.match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/i);
        if (spotifyPath) return "https://open.spotify.com/embed/" + spotifyPath[1].toLowerCase() + "/" + spotifyPath[2] + "?utm_source=a-os";
      }
    } catch (_) {}
    return "";
  }

  function enhanceBrowserMedia() {
    document.querySelectorAll(".browser-window").forEach(function (browser) {
      browser.querySelectorAll(".browser-recovery img").forEach(function (image) {
        image.src = "/assets/icons/cse.png";
        image.alt = "Website could not be loaded";
      });
      var address = browser.querySelector(".browser-address input");
      var frame = browser.querySelector(".browser-viewport iframe");
      var source = address && officialMediaEmbed(address.value);
      if (!frame || !source || frame.dataset.aosOfficialMedia === source) return;
      frame.dataset.aosOfficialMedia = source;
      frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      frame.src = source;
    });
  }

  function enhance() {
    enhanceQueued = false;
    var login = document.querySelector(".login-modern");
    if (login) {
      removeOddAvatar(login);
      enhanceLoginClock(login);
      var form = loginForm(login);
      if (form) updateLockout(form);
      if (localStorage.getItem(ACCOUNT_ONLY_KEY) === "true") accountOnlyCard(login);
      else login.classList.remove("aos-account-only-active");
      enhanceLockApps(login);
    } else {
      autoLockAppsOpened = false;
      document.querySelectorAll(".astore-lockscreen-app").forEach(function (layer) { layer.remove(); });
    }
    enhanceTerminalVersion();
    enhanceBrowserMedia();
    enhanceDeviceOwner();
  }

  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(enhance);
  }

  document.addEventListener("submit", handlePasswordSubmit, true);
  window.addEventListener("aos-account-only-changed", queueEnhance);
  window.addEventListener("aos-installed-apps-changed", queueEnhance);
  window.addEventListener("DOMContentLoaded", function () {
    queueEnhance();
    new MutationObserver(queueEnhance).observe(document.body, {childList: true, subtree: true});
    setInterval(function () {
      var form = document.querySelector(".login-modern") && loginForm(document.querySelector(".login-modern"));
      if (form) updateLockout(form);
      var login = document.querySelector(".login-modern");
      if (login) enhanceLoginClock(login);
      enhanceTerminalVersion();
      enhanceBrowserMedia();
      if (window.AOS_USER_PROFILES && typeof window.AOS_USER_PROFILES.save === "function") {
        window.AOS_USER_PROFILES.save(profileName());
      }
    }, 1000);
  }, {once: true});
})();
