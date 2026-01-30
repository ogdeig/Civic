// CivicThreat.us site config
window.CT_CONFIG = {
  SITE_NAME: "CIVIC THREAT",
  SITE_TAGLINE: "Debate & Discuss",
  COPYRIGHT_YEAR: 2026,

  // Title length limits
  TITLE_MAX: 80,

  // --- Remote Database (Google Sheets via Apps Script) ---
  // Deploy the included Apps Script as a Web App, then paste its URL below.
  REMOTE_DB: {
    enabled: false,
    appsScriptUrl: "",
    apiKey: "" // optional shared secret; set in Apps Script + here
  }
};
