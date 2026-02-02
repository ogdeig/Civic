/*
  CivicThreat.us — config.js
  Edit this file to point the site at your Google Apps Script Web App.

  IMPORTANT: Always use the /exec URL (not /dev) for production.
*/

window.CT_CONFIG = {
  // Site / UI
  SITE_NAME: "Civic Threat",

  // Remote DB via Google Apps Script (JSONP)
  REMOTE_DB: {
    enabled: true,
    // Example:
    // appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",
    appsScriptUrl: "",
    // This must match CT_API_KEY in Apps Script Properties (or your fallback key).
    apiKey: "",
  },

  // Reaction settings
  REACTIONS: {
    // 1 click per browser every 5 seconds
    cooldownMs: 5000,
  },

  // Home page limits
  HOME_LIMITS: {
    support: 6,
    maga: 6,
  }
};
