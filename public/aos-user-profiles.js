(function () {
  "use strict";
  var keys = [];
  var extras = ["aos-show-taskbar-quick-button", "aos-profile-avatar-type", "aos-profile-avatar-letter", "aos-profile-avatar-color", "aos-hibernate-snapshot", "aos-hibernate-restore-pending", "aos-family-active-member", "aos-aapplications-session", "aos-aapplications-sync-options", "aos-aapplications-last-sync"];
  extras = extras.concat(["aos-accent-color", "aos-bg-animation", "aos-cloud-clipboard", "aos-files-quick-pins", "aos-files-sidepins", "aos-file-handlers", "aos-glassmorphism-mode", "aos-pointer-text-enabled", "aos-pointer-text", "aos-window-blur", "aos-window-transparency", "aos-browser-pending-tab", "aos-startup-sound-id", "aos-auto-apply-cloud", "aos-auto-backup"]);
  function workspaceKey(name) { return "aos-profile-workspace-" + encodeURIComponent(name || "Person"); }
  function passwordKey(name) { return "aos-profile-password-" + encodeURIComponent(name || "Person"); }
  function personalKeys() {
    var result = new Set(keys.concat(extras));
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf("aos-window-size-") === 0) result.add(key);
    }
    return Array.from(result);
  }
  function collect() {
    return Object.fromEntries(personalKeys().flatMap(function (key) {
      var value = localStorage.getItem(key);
      return value === null ? [] : [[key, value]];
    }));
  }
  function save(name) {
    if (name !== (localStorage.getItem("aos-profile") || "Person")) return;
    var serialized = JSON.stringify(collect());
    if (localStorage.getItem(workspaceKey(name)) !== serialized) localStorage.setItem(workspaceKey(name), serialized);
  }
  function activate(profile, fresh) {
    var previous = localStorage.getItem("aos-profile") || "Person";
    if (profile.name === previous && !fresh) return;
    var incoming = fresh ? {} : JSON.parse(localStorage.getItem(workspaceKey(profile.name)) || "{}");
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("This user's saved settings are invalid.");
    var before = collect();
    var oldEmail = localStorage.getItem("aos-email");
    var oldPassword = localStorage.getItem("aos-password");
    save(previous);
    var allowed = new Set(personalKeys().concat(Object.keys(incoming).filter(function (key) { return key.indexOf("aos-window-size-") === 0; })));
    try {
      allowed.forEach(function (key) { localStorage.removeItem(key); });
      Object.keys(incoming).forEach(function (key) {
        if (allowed.has(key) && typeof incoming[key] === "string") localStorage.setItem(key, incoming[key]);
      });
      localStorage.setItem("aos-profile", profile.name);
      localStorage.setItem("aos-email", profile.email || "");
      localStorage.setItem("aos-password", localStorage.getItem(passwordKey(profile.name)) || "");
      localStorage.setItem("aos-configured", "true");
    } catch (error) {
      allowed.forEach(function (key) { localStorage.removeItem(key); });
      Object.keys(before).forEach(function (key) { localStorage.setItem(key, before[key]); });
      localStorage.setItem("aos-profile", previous);
      if (oldEmail !== null) localStorage.setItem("aos-email", oldEmail);
      if (oldPassword !== null) localStorage.setItem("aos-password", oldPassword);
      throw error;
    }
  }
  window.AOS_USER_PROFILES = {
    configure: function (values) {
      keys = values.filter(function (key) { return ["aos-device", "aos-configured", "aos-profile", "aos-email", "aos-profiles"].indexOf(key) === -1; });
      return values;
    },
    save: save, activate: activate, passwordKey: passwordKey
  };
})();
