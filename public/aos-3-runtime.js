(function () {
  "use strict";

  if (window.AOS_3_RUNTIME) return;
  window.AOS_3_RUNTIME = true;

  var FAMILY_KEY = "aos-family-device-v1";
  var ACTIVE_MEMBER_KEY = "aos-family-active-member";
  var PYTHON_KEY = "aos-python-enabled";
  var familyUnlocked = false;
  var scanTimer = 0;
  var channel = "BroadcastChannel" in window ? new BroadcastChannel("aos-family-device") : null;

  function parse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function id() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function digest(value) {
    var data = new TextEncoder().encode(String(value));
    var bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return Array.from(bytes).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  }

  function state() {
    var value = parse(localStorage.getItem(FAMILY_KEY) || "null", null);
    if (!value || !Array.isArray(value.members)) {
      value = {version: 1, id: id(), name: "My Family", adminHash: "", members: [], logins: []};
    }
    return value;
  }

  function save(value) {
    localStorage.setItem(FAMILY_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("aos-family-change", {detail: value}));
  }

  function notify(message) {
    window.dispatchEvent(new CustomEvent("aos-notification", {detail: {message: String(message)}}));
  }

  function activeMember() {
    return parse(localStorage.getItem(ACTIVE_MEMBER_KEY) || "null", null);
  }

  function openNamedApp(name) {
    var aliases = {web: "osinternet", photos: "mediaview", games: "minesweeper"};
    var wanted = aliases[String(name).toLowerCase()] || String(name).toLowerCase();

    function findButton() {
      var candidates = Array.from(document.querySelectorAll("button,[role='button']")).filter(function (button) {
        return !button.closest(".aos-child-launcher,.aos-child-games");
      });
      return candidates.find(function (button) {
        var label = [button.getAttribute("aria-label"), button.title, button.textContent].filter(Boolean).join(" ").trim().toLowerCase();
        return label === wanted || label.indexOf(wanted) !== -1;
      });
    }

    var target = findButton();
    if (target) {
      target.click();
      return true;
    }

    var launcherButton = document.querySelector(".launcher-button");
    if (launcherButton) {
      launcherButton.click();
      window.setTimeout(function () {
        var delayedTarget = findButton();
        if (delayedTarget) delayedTarget.click();
      }, 80);
      return true;
    }
    return false;
  }

  function applyMemberMode() {
    var member = activeMember();
    var child = Boolean(member && member.ageGroup === "7-");
    document.documentElement.classList.toggle("aos-child-user", child);
    document.body && document.body.classList.toggle("aos-child-user", child);
    document.querySelectorAll(".desktop").forEach(function (desktop) {
      if (child) {
        desktop.classList.remove("shelf-top", "shelf-right", "shelf-bottom");
        desktop.classList.add("shelf-left");
      }
    });
    if (child) addChildLauncher();
    else document.querySelectorAll(".aos-child-launcher").forEach(function (node) { node.remove(); });
  }

  function addChildLauncher() {
    document.querySelectorAll(".desktop").forEach(function (desktop) {
      if (desktop.querySelector(".aos-child-launcher")) return;
      var launcher = document.createElement("nav");
      launcher.className = "aos-child-launcher";
      launcher.setAttribute("aria-label", "Easy apps");
      var member = activeMember();
      launcher.innerHTML = '<header><img src="./assets/icons/Profile.png" alt=""><span><b>Hello, ' + escapeHtml(member && member.name || "there") + '</b><small>What would you like to do?</small></span></header><div class="aos-child-app-grid"></div>';
      var grid = launcher.querySelector(".aos-child-app-grid");
      [
        ["Paint", "Draw.png", "Paint"], ["Internet", "Browser.png", "OSInternet"], ["A-Store", "Downloads.png", "A-Store"],
        ["Games", "Lucky.png", "games"], ["Photos", "Images.png", "MediaView"], ["My Files", "Files.png", "Files"]
      ].forEach(function (item) {
        var button = document.createElement("button");
        button.type = "button";
        button.innerHTML = '<b>' + escapeHtml(item[0]) + '</b><span><img src="./assets/icons/' + encodeURIComponent(item[1]) + '" alt=""></span>';
        button.addEventListener("click", function () {
          if (item[2] === "games") openChildGames();
          else openNamedApp(item[2]);
        });
        grid.appendChild(button);
      });
      desktop.appendChild(launcher);
    });
  }

  function closeChildGames() {
    document.getElementById("aos-child-games")?.remove();
  }

  function showTicTacToe(stage) {
    var cells = Array(9).fill("");
    var turn = "X";
    var finished = false;
    var wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

    function render(message) {
      stage.innerHTML = '<section class="aos-child-game-board"><h2>Tic-tac-toe</h2><p>' + escapeHtml(message || turn + " goes next") + '</p><div class="aos-child-tic-grid"></div><button type="button" data-game-reset>New game</button></section>';
      var grid = stage.querySelector(".aos-child-tic-grid");
      cells.forEach(function (value, index) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = value;
        button.setAttribute("aria-label", value ? "Square " + (index + 1) + ": " + value : "Empty square " + (index + 1));
        button.addEventListener("click", function () {
          if (finished || cells[index]) return;
          cells[index] = turn;
          var won = wins.some(function (line) { return line.every(function (cell) { return cells[cell] === turn; }); });
          if (won) { finished = true; render(turn + " wins!"); return; }
          if (cells.every(Boolean)) { finished = true; render("It is a draw."); return; }
          turn = turn === "X" ? "O" : "X";
          render();
        });
        grid.appendChild(button);
      });
      stage.querySelector("[data-game-reset]").addEventListener("click", function () { showTicTacToe(stage); });
    }
    render();
  }

  function showMemoryGame(stage) {
    var values = ["A", "A", "O", "O", "S", "S", "3", "3"].sort(function () { return Math.random() - 0.5; });
    var open = [];
    var matched = new Set();
    var locked = false;

    function render() {
      stage.innerHTML = '<section class="aos-child-game-board"><h2>Memory match</h2><p>Find all four matching pairs.</p><div class="aos-child-memory-grid"></div><button type="button" data-game-reset>Shuffle cards</button></section>';
      var grid = stage.querySelector(".aos-child-memory-grid");
      values.forEach(function (value, index) {
        var button = document.createElement("button");
        var revealed = open.indexOf(index) !== -1 || matched.has(index);
        button.type = "button";
        button.textContent = revealed ? value : "?";
        button.className = matched.has(index) ? "matched" : "";
        button.addEventListener("click", function () {
          if (locked || revealed || open.length === 2) return;
          open.push(index);
          render();
          if (open.length === 2) {
            locked = true;
            window.setTimeout(function () {
              if (values[open[0]] === values[open[1]]) { matched.add(open[0]); matched.add(open[1]); }
              open = [];
              locked = false;
              render();
            }, 650);
          }
        });
        grid.appendChild(button);
      });
      stage.querySelector("p").textContent = matched.size === values.length ? "You found every pair!" : "Find all four matching pairs.";
      stage.querySelector("[data-game-reset]").addEventListener("click", function () { showMemoryGame(stage); });
    }
    render();
  }

  function openChildGames() {
    closeChildGames();
    var overlay = document.createElement("section");
    overlay.id = "aos-child-games";
    overlay.className = "aos-child-games";
    overlay.innerHTML = '<header><img src="./assets/icons/Lucky.png" alt=""><span><b>Games</b><small>Choose a game to play</small></span><button type="button" data-games-close aria-label="Close games">&times;</button></header>' +
      '<main><nav><button type="button" data-game="tic"><img src="./assets/icons/Lucky.png" alt=""><b>Tic-tac-toe</b><small>Take turns with X and O</small></button><button type="button" data-game="memory"><img src="./assets/icons/STAR.png" alt=""><b>Memory match</b><small>Find the matching cards</small></button><button type="button" data-game="mines"><img src="./assets/icons/Bug.png" alt=""><b>Minesweeper</b><small>Find the safe squares</small></button></nav><div class="aos-child-game-stage"><section class="aos-child-game-welcome"><img src="./assets/icons/Lucky.png" alt=""><h1>Pick a game</h1><p>Games stay inside A-OS and can be closed at any time.</p></section></div></main>';
    document.body.appendChild(overlay);
    var stage = overlay.querySelector(".aos-child-game-stage");
    overlay.querySelector("[data-games-close]").addEventListener("click", closeChildGames);
    overlay.querySelector('[data-game="tic"]').addEventListener("click", function () { showTicTacToe(stage); });
    overlay.querySelector('[data-game="memory"]').addEventListener("click", function () { showMemoryGame(stage); });
    overlay.querySelector('[data-game="mines"]').addEventListener("click", function () { closeChildGames(); openNamedApp("Minesweeper"); });
  }

  function familyCode(value) {
    var portable = {version: 1, id: value.id, name: value.name, adminHash: value.adminHash, members: value.members};
    var bytes = new TextEncoder().encode(JSON.stringify(portable));
    var binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return "AF3." + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeFamilyCode(code) {
    var text = String(code || "").trim();
    if (!/^AF3\./.test(text)) throw new Error("That is not an A-OS 3.0 Family code.");
    var raw = text.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    while (raw.length % 4) raw += "=";
    var binary = atob(raw);
    var bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
    var value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || !Array.isArray(value.members) || value.version !== 1) throw new Error("The Family code is damaged.");
    value.logins = [];
    return value;
  }

  function closeFamily() {
    document.getElementById("aos-family-app")?.remove();
  }

  function memberRows(value) {
    return value.members.map(function (member) {
      return '<div class="aos-family-member"><img src="./assets/icons/Profile.png" alt=""><span><b>' + escapeHtml(member.name) + '</b><small>' + (member.ageGroup === "7-" ? "Easy layout, age 7 or younger" : "Standard layout, age 8 or older") + '</small></span><button type="button" data-family-remove="' + escapeHtml(member.id) + '">Remove</button></div>';
    }).join("") || '<p class="aos-family-empty">No family members yet.</p>';
  }

  function familyPanel(value) {
    return '<header><img src="./assets/icons/Company.png" alt=""><span><b>Family Device</b><small>A-OS 3.0 family accounts</small></span><button type="button" data-family-close aria-label="Close">&times;</button></header>' +
      '<main><section class="aos-family-heading"><div><h1>' + escapeHtml(value.name) + '</h1><p>Manage the people who can use this A-OS device.</p></div><button type="button" data-family-lock>Lock admin controls</button></section>' +
      '<section class="aos-family-members"><h2>People</h2>' + memberRows(value) + '</section>' +
      '<form data-family-add><h2>Make Family account</h2><div class="aos-family-fields"><label>Name<input name="name" required maxlength="40"></label><label>Password<input name="password" type="password" required minlength="4"></label><label>Layout<select name="age"><option value="8+">Age 8 or older</option><option value="7-">Age 7 or younger</option></select></label></div><button type="submit">Create person</button><p data-family-status aria-live="polite"></p></form>' +
      '<section class="aos-family-code"><h2>Connect another A-OS device</h2><p>Keep this code private. It contains the family member list and login credentials.</p><textarea readonly>' + escapeHtml(familyCode(value)) + '</textarea><div><button type="button" data-family-copy>Copy family code</button><button type="button" data-family-import>Paste a family code</button></div></section>' +
      '<form data-family-aapps><h2>Use an existing A-Applications account</h2><div class="aos-family-fields"><label>Username or email<input name="identifier" required></label><label>Password<input name="password" type="password" required></label></div><button type="submit">Sign in and add</button><p data-family-aapps-status aria-live="polite"></p></form></main>';
  }

  function renderFamily(root) {
    var value = state();
    if (value.adminHash && !familyUnlocked) {
      root.innerHTML = '<header><img src="./assets/icons/Company.png" alt=""><span><b>Family Device</b><small>Administrator access</small></span><button type="button" data-family-close aria-label="Close">&times;</button></header><form class="aos-family-unlock"><h1>Family administrator</h1><p>Enter the Family Device admin password.</p><input name="password" type="password" required autofocus><button type="submit">Unlock</button><small data-family-status></small></form>';
      root.querySelector("[data-family-close]").addEventListener("click", closeFamily);
      root.querySelector("form").addEventListener("submit", async function (event) {
        event.preventDefault();
        if (await digest(event.currentTarget.elements.password.value) === value.adminHash) {
          familyUnlocked = true;
          renderFamily(root);
        } else root.querySelector("[data-family-status]").textContent = "The admin password is incorrect.";
      });
      return;
    }
    if (!value.adminHash) {
      root.innerHTML = '<header><img src="./assets/icons/Company.png" alt=""><span><b>Family Device</b><small>First-time setup</small></span><button type="button" data-family-close aria-label="Close">&times;</button></header><form class="aos-family-unlock"><h1>Make a Family Device</h1><p>Choose the admin password used to manage people and child settings.</p><input name="password" type="password" required minlength="4" autofocus><button type="submit">Continue</button><small data-family-status></small></form>';
      root.querySelector("[data-family-close]").addEventListener("click", closeFamily);
      root.querySelector("form").addEventListener("submit", async function (event) {
        event.preventDefault();
        value.adminHash = await digest(event.currentTarget.elements.password.value);
        save(value);
        familyUnlocked = true;
        renderFamily(root);
      });
      return;
    }

    root.innerHTML = familyPanel(value);
    root.querySelector("[data-family-close]").addEventListener("click", closeFamily);
    root.querySelector("[data-family-lock]").addEventListener("click", function () { familyUnlocked = false; renderFamily(root); });
    root.querySelector("[data-family-add]").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      value.members.push({id: id(), name: form.elements.name.value.trim(), passwordHash: await digest(form.elements.password.value), ageGroup: form.elements.age.value, createdAt: Date.now()});
      save(value);
      renderFamily(root);
    });
    root.querySelectorAll("[data-family-remove]").forEach(function (button) {
      button.addEventListener("click", function () {
        value.members = value.members.filter(function (member) { return member.id !== button.dataset.familyRemove; });
        save(value);
        renderFamily(root);
      });
    });
    root.querySelector("[data-family-copy]").addEventListener("click", function () {
      navigator.clipboard.writeText(root.querySelector("textarea").value).then(function () { notify("Family code copied."); });
    });
    root.querySelector("[data-family-import]").addEventListener("click", function () {
      var code = window.prompt("Paste the Family code from the other A-OS device:");
      if (!code) return;
      try { save(decodeFamilyCode(code)); renderFamily(root); notify("Family Device imported."); }
      catch (error) { window.alert(error.message); }
    });
    root.querySelector("[data-family-aapps]").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var status = form.querySelector("[data-family-aapps-status]");
      try {
        if (!window.AOS_ORGANIZATION_API) throw new Error("A-Applications is not ready.");
        await window.AOS_ORGANIZATION_API.signIn(
          form.elements.identifier.value,
          form.elements.password.value,
          status,
          {allowPersonal: true}
        );
      } catch (error) { status.textContent = error.message || "Sign in failed."; }
    });
  }

  function openFamily() {
    var previous = document.getElementById("aos-family-app");
    if (previous) { previous.remove(); return; }
    var overlay = document.createElement("section");
    overlay.id = "aos-family-app";
    overlay.className = "aos-family-app";
    document.body.appendChild(overlay);
    renderFamily(overlay);
  }

  async function loginMember(member, password, status) {
    if (await digest(password) !== member.passwordHash) throw new Error("The password is incorrect.");
    localStorage.setItem(ACTIVE_MEMBER_KEY, JSON.stringify({id: member.id, name: member.name, ageGroup: member.ageGroup, signedInAt: Date.now()}));
    localStorage.setItem("aos-profile", member.name);
    localStorage.setItem("aos-configured", "true");
    if (member.ageGroup === "7-") localStorage.setItem("aos-wallpaper", "Family Home.png");
    var value = state();
    value.logins = [{memberId: member.id, name: member.name, at: Date.now()}].concat(value.logins || []).slice(0, 50);
    save(value);
    if (channel) channel.postMessage({type: "login", name: member.name, at: Date.now()});
    status.textContent = "Signing in...";
    window.location.reload();
  }

  function addFamilyLogin() {
    var value = state();
    if (!value.members.length) return;
    document.querySelectorAll(".login-modern").forEach(function (login) {
      if (login.querySelector(".aos-family-login")) return;
      var section = document.createElement("section");
      section.className = "aos-family-login";
      section.innerHTML = '<button type="button" data-family-people>Family</button><div hidden><header><b>Family</b><button type="button" data-family-login-close>&times;</button></header><nav>' + value.members.map(function (member) { return '<button type="button" data-family-member="' + escapeHtml(member.id) + '"><img src="./assets/icons/Profile.png" alt=""><span>' + escapeHtml(member.name) + '</span></button>'; }).join("") + '</nav><form hidden><b data-family-login-name></b><input name="password" type="password" placeholder="Password" required><button type="submit">Log in</button><small data-family-login-status></small></form></div>';
      var panel = section.querySelector("div");
      section.querySelector("[data-family-people]").addEventListener("click", function () { panel.hidden = false; });
      section.querySelector("[data-family-login-close]").addEventListener("click", function () { panel.hidden = true; });
      section.querySelectorAll("[data-family-member]").forEach(function (button) {
        button.addEventListener("click", function () {
          section.dataset.member = button.dataset.familyMember;
          section.querySelector("form").hidden = false;
          section.querySelector("[data-family-login-name]").textContent = value.members.find(function (member) { return member.id === button.dataset.familyMember; }).name;
          section.querySelector("input").focus();
        });
      });
      section.querySelector("form").addEventListener("submit", function (event) {
        event.preventDefault();
        var member = value.members.find(function (item) { return item.id === section.dataset.member; });
        var status = section.querySelector("[data-family-login-status]");
        loginMember(member, event.currentTarget.elements.password.value, status).catch(function (error) { status.textContent = error.message; });
      });
      login.appendChild(section);
    });
  }

  function addSettingsEntry() {
    document.querySelectorAll(".system-window").forEach(function (windowElement) {
      var header = windowElement.querySelector("header");
      if (!header || header.textContent.indexOf("Settings") === -1 || windowElement.querySelector(".aos-family-settings-button")) return;
      var anchor = Array.from(windowElement.querySelectorAll("button")).find(function (button) { return /^(Share|Users|Organization)$/.test(button.textContent.trim()); });
      if (!anchor || !anchor.parentElement) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = anchor.className + " aos-family-settings-button";
      button.textContent = "Family Device";
      button.addEventListener("click", openFamily);
      anchor.insertAdjacentElement("afterend", button);
    });
  }

  function addLauncherEntry() {
    document.querySelectorAll(".launcher").forEach(function (launcher) {
      if (launcher.querySelector("[data-family-app-launcher]")) return;
      var sample = launcher.querySelector("button");
      if (!sample) return;
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.familyAppLauncher = "true";
      button.className = sample.className;
      button.title = "Family Device";
      button.setAttribute("aria-label", "Family Device");
      button.innerHTML = '<img src="./assets/icons/Company.png" alt=""><span>Family Device</span>';
      button.addEventListener("click", openFamily);
      launcher.appendChild(button);
    });
  }

  function adultChallenge(event) {
    if (!document.documentElement.classList.contains("aos-child-user")) return;
    var button = event.target.closest("button,[role='button']");
    if (!button) return;
    var label = [button.textContent, button.title, button.getAttribute("aria-label")].filter(Boolean).join(" ");
    if (!/settings/i.test(label) || Date.now() < Number(sessionStorage.getItem("aos-adult-proof-until") || 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    var number = 2 + Math.floor(Math.random() * 10);
    var answer = window.prompt("Adult check: what is 3 x " + number + "?");
    if (Number(answer) === 3 * number) {
      sessionStorage.setItem("aos-adult-proof-until", String(Date.now() + 5 * 60 * 1000));
      window.setTimeout(function () { button.click(); }, 0);
    } else window.alert("That answer was not correct.");
  }

  function appendTerminal(terminal, lines) {
    var main = terminal.querySelector("main");
    if (!main) return;
    lines.forEach(function (line) {
      var row = document.createElement("div");
      row.dataset.aos3Terminal = "true";
      row.textContent = line;
      main.appendChild(row);
    });
    main.scrollTop = main.scrollHeight;
  }

  async function nativeRequest(path, options) {
    if (window.AOS_NATIVE_BRIDGE) {
      return options ? window.AOS_NATIVE_BRIDGE.post(path, options) : window.AOS_NATIVE_BRIDGE.request(path);
    }
    throw new Error("This command requires the installed A-OS system.");
  }

  function files() {
    var value = parse(localStorage.getItem("aos-files") || "[]", []);
    return Array.isArray(value) ? value : [];
  }

  async function runFile(file, terminal) {
    if (!file) throw new Error("File not found.");
    if (/\.py$/i.test(file.name || "")) {
      if (localStorage.getItem(PYTHON_KEY) !== "true") throw new Error("Run /py install first.");
      var result = await nativeRequest("/__aos/python/run", {code: String(file.content || "")});
      appendTerminal(terminal, [result.output || result.error || "Python finished with no output."]);
      return;
    }
    window.dispatchEvent(new CustomEvent("aos-open-with", {detail: {file: file}}));
    appendTerminal(terminal, ["Opened " + (file.name || "file") + "."]);
  }

  function crashScreen() {
    var screen = document.createElement("section");
    screen.className = "aos-3-crash";
    screen.innerHTML = '<img src="./assets/icons/Dead A Screen (bsod but das).png" alt=""><h1>A-OS stopped</h1><p>The /kill command stopped this session. Your saved files were not deleted.</p><button type="button">Restart A-OS</button>';
    screen.querySelector("button").addEventListener("click", function () { window.location.reload(); });
    document.body.appendChild(screen);
  }

  async function runTerminalCommand(command, terminal) {
    var value = command.trim();
    if (value === "/info") {
      var info;
      try { info = await nativeRequest("/__aos/info"); }
      catch (_) { info = {ip: "Browser managed", device: navigator.platform || "A-OS Device", processor: navigator.hardwareConcurrency ? navigator.hardwareConcurrency + " logical processors" : "Unavailable", os: "A-OS Desktop 3.0"}; }
      appendTerminal(terminal, ["IP: " + info.ip, "Device: " + info.device, "Processor: " + info.processor, "OS: " + info.os]);
      return true;
    }
    if (value === "/kill") { crashScreen(); return true; }
    if (value === "/py install") { localStorage.setItem(PYTHON_KEY, "true"); appendTerminal(terminal, ["Python 3 is enabled. Double-click a .py file or run it by path."]); return true; }
    if (value === "/restart" || value === "/shutdown") {
      var action = value.slice(1);
      try { await nativeRequest("/__aos/power/" + action, {}); }
      catch (_) { if (action === "restart") window.location.reload(); else window.close(); }
      return true;
    }
    if (value === "/ai") { if (!openNamedApp("A-AI")) window.open("https://a-ai.web.app", "_blank"); appendTerminal(terminal, ["Opening A-AI."]); return true; }
    if (value === "/family") { openFamily(); appendTerminal(terminal, ["Family Device opened. Administrator password required."]); return true; }
    if (value === "/help") { appendTerminal(terminal, ["A-OS 3.0 commands:", "/info  /kill  /py install  /restart  /shutdown  /ai  /family", "/run-<filename>indesktop  C://<file location>"]); return true; }
    var desktopMatch = value.match(/^\/run-(.+)indesktop$/i);
    if (desktopMatch) {
      var desktopFile = files().find(function (file) { return String(file.name || "").toLowerCase() === desktopMatch[1].toLowerCase(); });
      await runFile(desktopFile, terminal);
      return true;
    }
    if (/^C:\/\//i.test(value)) {
      var name = decodeURIComponent(value.split("/").pop() || "").toLowerCase();
      var located = files().find(function (file) { return String(file.name || "").toLowerCase() === name; });
      await runFile(located, terminal);
      return true;
    }
    return false;
  }

  function terminalCapture(event) {
    var form = event.target.closest(".system-terminal form");
    if (!form) return;
    var input = form.querySelector("input");
    var command = input && input.value.trim();
    if (!command || !(/^\/(info|kill|py install|restart|shutdown|ai|family|help)/i.test(command) || /^\/run-.+indesktop$/i.test(command) || /^C:\/\//i.test(command))) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    input.value = "";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    var terminal = form.closest(".system-terminal");
    appendTerminal(terminal, ["A-OS> " + command]);
    runTerminalCommand(command, terminal).catch(function (error) { appendTerminal(terminal, ["Error: " + (error.message || error)]); });
  }

  function pythonDoubleClick(event) {
    if (localStorage.getItem(PYTHON_KEY) !== "true") return;
    var label = Array.from((event.target.closest("button,div") || event.target).querySelectorAll("h4,span")).find(function (node) { return /\.py$/i.test((node.textContent || "").trim()); });
    if (!label) return;
    var file = files().find(function (item) { return String(item.name || "").toLowerCase() === label.textContent.trim().toLowerCase(); });
    if (!file) return;
    event.preventDefault();
    nativeRequest("/__aos/python/run", {code: String(file.content || "")}).then(function (result) {
      window.alert(result.output || result.error || "Python finished with no output.");
    }).catch(function (error) { window.alert(error.message); });
  }

  function scan() {
    addSettingsEntry();
    addLauncherEntry();
    addFamilyLogin();
    applyMemberMode();
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 50);
  }

  window.AOS_FAMILY_DEVICE = {open: openFamily, state: state};
  window.addEventListener("aos-open-family", openFamily);
  document.addEventListener("submit", terminalCapture, true);
  document.addEventListener("click", adultChallenge, true);
  document.addEventListener("dblclick", pythonDoubleClick, true);
  if (channel) channel.addEventListener("message", function (event) { if (event.data && event.data.type === "login") notify(event.data.name + " logged in on a family A-OS device."); });
  document.addEventListener("DOMContentLoaded", function () {
    scan();
    new MutationObserver(scheduleScan).observe(document.body, {childList: true, subtree: true});
  }, {once: true});
})();
