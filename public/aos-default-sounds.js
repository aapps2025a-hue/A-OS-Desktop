(function () {
  "use strict";

  var NOTIFICATION_ID = "aos-4-default-notification";
  var RINGTONE_ID = "aos-4-default-ringtone";
  var NOTIFICATION_VALUE = "file:" + NOTIFICATION_ID;
  var RINGTONE_VALUE = "file:" + RINGTONE_ID;
  var sounds = [
    {
      id: NOTIFICATION_ID,
      name: "A-OS 4 Notification.mp4",
      mime: "audio/mp4",
      content: "/assets/sounds/aos-4-notification.mp4"
    },
    {
      id: RINGTONE_ID,
      name: "A-OS 4 Ringtone.mp4",
      mime: "audio/mp4",
      content: "/assets/sounds/aos-4-ringtone.mp4"
    }
  ];

  function readFiles() {
    try {
      var files = JSON.parse(localStorage.getItem("aos-files") || "[]");
      return Array.isArray(files) ? files : [];
    } catch (_) {
      return [];
    }
  }

  function installSounds() {
    var files = readFiles();
    var changed = false;
    sounds.forEach(function (sound) {
      var existing = files.find(function (file) { return file && file.id === sound.id; });
      if (existing) {
        Object.keys(sound).forEach(function (key) {
          if (existing[key] !== sound[key]) {
            existing[key] = sound[key];
            changed = true;
          }
        });
        if (existing.type !== "file" || existing.parent !== "os-root") {
          existing.type = "file";
          existing.parent = "os-root";
          changed = true;
        }
      } else {
        files.push(Object.assign({type: "file", parent: "os-root", icon: "Music.png"}, sound));
        changed = true;
      }
    });
    if (changed) localStorage.setItem("aos-files", JSON.stringify(files));

    var notification = localStorage.getItem("aos-notification-tone");
    var ringtone = localStorage.getItem("aos-ringtone-tone");
    if (!notification || notification === "Blueglass") localStorage.setItem("aos-notification-tone", NOTIFICATION_VALUE);
    if (!ringtone || ringtone === "Aurora") localStorage.setItem("aos-ringtone-tone", RINGTONE_VALUE);
    if (localStorage.getItem("aos-notification-sounds") === null) localStorage.setItem("aos-notification-sounds", "true");
  }

  installSounds();
  window.AOS_DEFAULT_SOUNDS = {
    notification: NOTIFICATION_VALUE,
    ringtone: RINGTONE_VALUE,
    install: installSounds
  };
})();
