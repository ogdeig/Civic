// CivicThreat.us site config
// NOTE: This file is public on GitHub Pages. Do not put true secrets here.
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,

  TITLE_MAX: 80,

  // --- Remote Database (Google Sheets via Apps Script Web App) ---
  REMOTE_DB: {
    enabled: true,
    // Your deployed Apps Script Web App EXEC URL:
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",
  
  },

  // Backward-compat alias (older builds referenced CT_CONFIG.API_URL)
  API_URL: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec"
};
