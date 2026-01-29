# Civic Threat Productions — Facebook Dashboard (v3)

Sleek black theme with red topbar + blue buttons (logo vibe).
Local-only prototype (browser localStorage) for Live Studio.

## Default Admin Login
- Username: `admin`
- Password: `ChangeMe123!`

Change credentials in `config.js` (ADMIN_USER + ADMIN_HASH_SHA256).

## What changed vs v2
- “Submitted by …” button on each post (Anonymous by default)
- Submit form supports optional username + consent checkbox
- Platforms dropdown menu (ready to add X/IG/etc.)
- Search bar moved to a full-width utility strip (not inside the container)
- Bigger headline font (auto clamps to 2 lines), headline limit 80 chars
- Footer + Terms/Privacy/Cookies/Contact pages (ad approval readiness)
- Review page is protected by Admin Login

## Storage
- Approved: `ct3_approved_posts`
- Pending: `ct3_pending_submissions`

Easy to swap to Google Sheets later by replacing storage functions in `app.js`.

## Run
Open `index.html` in Live Studio.


## Admin URL
- Not linked in the UI.
- Local: open `/admin/index.html`
- Live: `https://civicthreat.us/admin` (protect `/admin/*` in Cloudflare)
