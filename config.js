// CivicThreat.us site config
// NOTE: This file is public on GitHub Pages. Do not put true secrets here.
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,
  TITLE_MAX: 80,

  // Google Sheets via Apps Script Web App (JSONP)
  REMOTE_DB: {
    enabled: true,
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",
    apiKey: "" // leave blank if you are not enforcing keys
  },

  // reaction cooldown (per browser)
  REACTION_COOLDOWN_MS: 5000
};
