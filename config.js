// CivicThreat.us site config
// NOTE: This file is public on GitHub Pages. Do not put true secrets here.
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,

  // Title length limits
  TITLE_MAX: 80,

  // --- Remote Database (Google Sheets via Apps Script Web App) ---
  // Enable this to make Google Sheets the source of truth (no more device-only posts).
  REMOTE_DB: {
    enabled: true,
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbyFVtHnkg7t2kPHsqQcuDItH2Rp0iUZuZw6LwvGEjhVaBXkhUIobUZ8OFdcHeQ_6VU-NA/exec",
    apiKey: "" // optional shared key; only effective if enforced in Apps Script
  }
};
