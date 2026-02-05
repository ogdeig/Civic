// CivicThreat.us site config
// NOTE: This file is public on GitHub Pages. Do not put true secrets here.
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,

  // Title length limits
  TITLE_MAX: 80,

  // Cooldown per browser for reactions (ms)
  REACTION_COOLDOWN_MS: 5000,

  // --- Remote Database (Google Sheets via Apps Script Web App) ---
  // Enabled = Google Sheets is source of truth
  REMOTE_DB: {
    enabled: true,

    // Your Apps Script Web App "exec" URL
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",

    // Leave blank if you are NOT enforcing an API key in Apps Script
    apiKey: ""
  }
};
