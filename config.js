/* global window */
(function(){
  "use strict";

  window.CT_CONFIG = {
    SITE_NAME: "CIVIC THREAT",
    SITE_TAGLINE: "Debate & Discuss",
    COPYRIGHT_YEAR: 2026,

    SOCIAL: {
      facebook: "https://www.facebook.com/CivicThreat/",
      youtube:  "https://www.youtube.com/@civicthreat",
      tiktok:   "https://www.tiktok.com/@civicthreat",
      x:        "https://x.com/CivicThreat"
    },

    // Remote DB (Google Sheets via Apps Script JSONP)
    REMOTE_DB: {
      enabled: true,
      appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",
      apiKey: "civicthreat_12345_secret" // optional shared key; only effective if enforced in Apps Script
    }
  };

  // --- Backward-compatible aliases (fixes CT_CONFIG.API_URL missing) ---
  // Some older front-end code expects CT_CONFIG.API_URL / CT_CONFIG.API_KEY.
  window.CT_CONFIG.API_URL = window.CT_CONFIG.API_URL || window.CT_CONFIG.REMOTE_DB.appsScriptUrl;
  window.CT_CONFIG.API_KEY = window.CT_CONFIG.API_KEY || window.CT_CONFIG.REMOTE_DB.apiKey;
})();
