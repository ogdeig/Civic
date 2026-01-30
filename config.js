// CivicThreat.us site config
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,

  // Title length limits
  TITLE_MAX: 80,

  // --- Remote Database (Google Sheets via Apps Script) ---
  // data-api.js will POST JSON to this Web App URL (appsScriptUrl) and include apiKey in the payload.
  // IMPORTANT: leave enabled=false until your Apps Script is deployed and working.
  REMOTE_DB: {
    enabled: false,

    // Paste your deployed Apps Script *Web App* URL here (ends with /exec)
    // Example: "https://script.google.com/macros/s/AKfycbx.../exec"
    appsScriptUrl: "",

    // Optional shared secret. If you set one in the Apps Script, set the same value here.
    apiKey: ""
  }
};
