
const AUTH = {
  key: "ct3_admin_session",
};

function nowMs(){ return Date.now(); }

async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function getSession(){
  try{ return JSON.parse(localStorage.getItem(AUTH.key) || "null"); }catch{ return null; }
}

function setSession(obj){
  localStorage.setItem(AUTH.key, JSON.stringify(obj));
}

function clearSession(){
  localStorage.removeItem(AUTH.key);
}

function isLoggedIn(){
  const s = getSession();
  if(!s) return false;
  if(!s.exp || nowMs() > s.exp) { clearSession(); return false; }
  return s.ok === true;
}

async function login(username, password){
  const cfg = window.CT_CONFIG;
  const hex = await sha256Hex(`${username}:${password}`);
  if(hex === cfg.ADMIN_HASH_SHA256){
    const hours = cfg.ADMIN_SESSION_HOURS || 12;
    setSession({ ok:true, u: username, exp: nowMs() + hours*60*60*1000 });
    return true;
  }
  return false;
}
