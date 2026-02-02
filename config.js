/*
  CivicThreat.us — config.js
  Uses Google Apps Script Web App (JSONP).

  appsScriptUrl is REQUIRED.
  apiKey is OPTIONAL:
   - If you set it, admin/write endpoints can be protected.
   - Public pages (listApproved + react) work without it.
*/

window.CT_CONFIG = {
  SITE_NAME: "Civic Threat",

  REMOTE_DB: {
    enabled: true,

    // REQUIRED: your Apps Script /exec URL
    // Example:
    // "https://script.google.com/macros/s/AKfycbxxxxxxx/exec"
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",

    // OPTIONAL: only needed for admin/write endpoints
    apiKey: ""
  },

  REACTIONS: {
    cooldownMs: 5000
  },

  HOME_LIMITS: {
    support: 6,
    maga: 6
  }
};
