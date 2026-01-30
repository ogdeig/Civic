// CivicThreat.us — site config (GitHub Pages + Cloudflare friendly)
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,

  // Title length limits
  TITLE_MAX: 80,

  // --- Remote Database (Google Sheets via Apps Script Web App) ---
  // data-api.js will POST JSON to this URL and include apiKey in the payload.
  REMOTE_DB: {
    // ✅ Turn ON remote mode (Sheets becomes the source of truth)
    enabled: true,

    // ✅ Your deployed Apps Script Web App URL
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbyFVtHnkg7t2kPHsqQcuDItH2Rp0iUZuZw6LwvGEjhVaBXkhUIobUZ8OFdcHeQ_6VU-NA/exec",

    // OPTIONAL:
    // If your Apps Script has CT_API_KEY set in Script Properties, put the same value here.
    // If you haven't set CT_API_KEY (or want to test quickly), leave this "" AND temporarily
    // disable auth check in Apps Script (not recommended long-term).
    apiKey: "civicthreat_12345_secret"
  }
};
