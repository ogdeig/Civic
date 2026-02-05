// /config.js — CivicThreat.us site config
// NOTE: This file is public on GitHub Pages. Do not put real secrets here.

window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",

  // Cooldown per browser for reactions
  REACTION_COOLDOWN_MS: 5000,

  // ✅ REQUIRED by data-api.js (your JSONP client)
  // Put your Apps Script Web App "exec" URL here:
  API_URL: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",

  // ✅ Kept for compatibility with admin pages that check REMOTE_DB
  REMOTE_DB: {
    enabled: true,
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbxvjktr3A_FCZEgRNtkWBb9qGJTjdwa0oaS2ofAzQDQGngka0vLe8MwJrgUqy5KUOl6lA/exec",

    // Optional: leave blank if you are NOT enforcing an API key in Apps Script
    apiKey: ""
  }
};
