(function () {
  "use strict";

  if (window.AOS_ACCOUNT_CLOUD) return;
  window.AOS_ACCOUNT_CLOUD = true;

  var PROJECT_ID = "emojis-symbols-online";
  var COLLECTION = "aosAccountBackups";
  var SYNC_PATH = "/api/a-applications-sync";
  var MAX_PAYLOAD_BYTES = 800000;
  var nativeFetch = window.fetch.bind(window);

  function jsonResponse(value, status) {
    return new Response(JSON.stringify(value), {
      status: status || 200,
      headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"}
    });
  }

  function isSyncRequest(input) {
    try {
      var raw = typeof input === "string" ? input : input.url;
      return new URL(raw, window.location.href).pathname === SYNC_PATH;
    } catch (_) {
      return false;
    }
  }

  function decodeTokenPayload(token) {
    try {
      var encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (encoded.length % 4) encoded += "=";
      return JSON.parse(decodeURIComponent(Array.from(atob(encoded)).map(function (character) {
        return "%" + character.charCodeAt(0).toString(16).padStart(2, "0");
      }).join("")));
    } catch (_) {
      return null;
    }
  }

  async function readJson(response) {
    var text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch (_) { throw new Error("The account service returned an invalid response."); }
  }

  function errorMessage(value, fallback) {
    return String(value && value.error && (value.error.message || value.error) || fallback);
  }

  async function syncRequest(input, init) {
    var request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    var options = init || {};
    var method = String(options.method || request && request.method || "GET").toUpperCase();
    var headers = new Headers(options.headers || request && request.headers || {});
    var authorization = headers.get("authorization") || "";
    var token = authorization.replace(/^Bearer\s+/i, "").trim();
    var claims = decodeTokenPayload(token);
    var uid = claims && (claims.user_id || claims.sub);

    if (!token || !uid) return jsonResponse({error: "Sign in with A-Applications again."}, 401);

    var documentUrl = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
      "/databases/(default)/documents/" + COLLECTION + "/" + encodeURIComponent(uid);
    var firestoreHeaders = {authorization: "Bearer " + token, "content-type": "application/json"};

    try {
      if (method === "GET") {
        var getResponse = await nativeFetch(documentUrl, {headers: firestoreHeaders, cache: "no-store"});
        if (getResponse.status === 404) return jsonResponse({snapshot: null});
        var getBody = await readJson(getResponse);
        if (!getResponse.ok) return jsonResponse({error: errorMessage(getBody, "A-Applications could not restore this device.")}, getResponse.status);
        var payload = getBody && getBody.fields && getBody.fields.payload && getBody.fields.payload.stringValue;
        if (!payload) return jsonResponse({snapshot: null});
        try { return jsonResponse(JSON.parse(payload)); }
        catch (_) { return jsonResponse({error: "The saved A-OS backup is damaged."}, 502); }
      }

      if (method === "PUT" || method === "POST") {
        var body = options.body;
        if (body == null && request) body = await request.clone().text();
        var snapshot = typeof body === "string" ? JSON.parse(body || "{}") : body || {};
        var payloadText = JSON.stringify(snapshot);
        if (new TextEncoder().encode(payloadText).length > MAX_PAYLOAD_BYTES) {
          return jsonResponse({error: "This A-OS backup is too large for account sync. Remove large media files and try again."}, 413);
        }
        var saveResponse = await nativeFetch(documentUrl, {
          method: "PATCH",
          headers: firestoreHeaders,
          body: JSON.stringify({fields: {
            ownerUid: {stringValue: uid},
            payload: {stringValue: payloadText},
            updatedAt: {integerValue: String(Date.now())}
          }}),
          cache: "no-store"
        });
        var saveBody = await readJson(saveResponse);
        if (!saveResponse.ok) return jsonResponse({error: errorMessage(saveBody, "A-Applications could not save this device.")}, saveResponse.status);
        return jsonResponse({ok: true, updatedAt: Date.now()});
      }

      return jsonResponse({error: "This account-sync action is not supported."}, 405);
    } catch (error) {
      return jsonResponse({error: error && error.message || "A-Applications account sync is unavailable."}, 503);
    }
  }

  window.fetch = function (input, init) {
    return isSyncRequest(input) ? syncRequest(input, init) : nativeFetch(input, init);
  };
})();
