/**
 * CivicThreat.us — Google Sheets backend (Apps Script Web App)
 *
 * Sheets:
 *   - Pending
 *   - Approved
 *
 * Columns (both sheets):
 *   id | platform | category | title | postUrl | submitterName | submitterLink | consent | submittedAt | approvedAt
 *
 * Deploy:
 *   Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *   Copy the Web app URL into config.js (REMOTE_DB.appsScriptUrl)
 *
 * Optional API key:
 *   Set API_KEY below (or leave blank). If set, also set it in config.js (REMOTE_DB.apiKey).
 */

const API_KEY = ""; // optional shared secret

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");

    if (API_KEY && payload.apiKey !== API_KEY) {
      return json_({ ok: false, error: "Unauthorized" }, 401);
    }

    const action = payload.action || "";
    if (action === "listApproved") return json_({ ok: true, items: list_("Approved") });
    if (action === "listPending")  return json_({ ok: true, items: list_("Pending") });

    if (action === "submit") {
      const item = payload.item || {};
      validateSubmit_(item);
      upsert_("Pending", item);
      return json_({ ok: true });
    }

    if (action === "approve") {
      const id = String(payload.id || "").trim();
      if (!id) return json_({ ok:false, error:"Missing id" }, 400);
      approve_(id);
      return json_({ ok:true });
    }

    if (action === "reject") {
      const id = String(payload.id || "").trim();
      if (!id) return json_({ ok:false, error:"Missing id" }, 400);
      reject_(id);
      return json_({ ok:true });
    }

    return json_({ ok:false, error:"Unknown action" }, 400);

  } catch (err) {
    return json_({ ok: false, error: String(err) }, 500);
  }
}

function validateSubmit_(item){
  const required = ["id","platform","category","title","postUrl","submittedAt"];
  required.forEach(k=>{
    if(!item[k]) throw new Error("Missing field: " + k);
  });
}

function sheet_(name){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.appendRow(["id","platform","category","title","postUrl","submitterName","submitterLink","consent","submittedAt","approvedAt"]);
  }
  return sh;
}

function list_(name){
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if(values.length <= 1) return [];
  const headers = values[0].map(String);
  return values.slice(1).map(row=>{
    const obj = {};
    headers.forEach((h,i)=> obj[h] = row[i]);
    // normalize numeric timestamps
    ["submittedAt","approvedAt"].forEach(k=>{
      if(obj[k] && typeof obj[k] === "string") {
        const n = Number(obj[k]);
        if(!isNaN(n)) obj[k] = n;
      }
    });
    obj.consent = String(obj.consent || "") === "true";
    return obj;
  }).filter(x=>x.id);
}

function upsert_(name, item){
  const sh = sheet_(name);
  const range = sh.getDataRange().getValues();
  const id = String(item.id);
  // find row by id (skip header)
  let rowIndex = -1;
  for(let r=1; r<range.length; r++){
    if(String(range[r][0]) === id){ rowIndex = r+1; break; } // sheet rows are 1-based
  }
  const row = [
    item.id,
    item.platform,
    item.category,
    item.title,
    item.postUrl,
    item.submitterName || "",
    item.submitterLink || "",
    item.consent ? "true" : "false",
    item.submittedAt || "",
    item.approvedAt || ""
  ];
  if(rowIndex === -1){
    sh.appendRow(row);
  } else {
    sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }
}

function approve_(id){
  const pending = sheet_("Pending");
  const approved = sheet_("Approved");
  const data = pending.getDataRange().getValues();
  for(let r=1; r<data.length; r++){
    if(String(data[r][0]) === id){
      const item = {
        id: data[r][0],
        platform: data[r][1],
        category: data[r][2],
        title: data[r][3],
        postUrl: data[r][4],
        submitterName: data[r][5],
        submitterLink: data[r][6],
        consent: String(data[r][7]) === "true",
        submittedAt: Number(data[r][8]) || "",
        approvedAt: Date.now()
      };
      upsert_("Approved", item);
      pending.deleteRow(r+1);
      return;
    }
  }
  throw new Error("Not found in Pending: " + id);
}

function reject_(id){
  const sh = sheet_("Pending");
  const data = sh.getDataRange().getValues();
  for(let r=1; r<data.length; r++){
    if(String(data[r][0]) === id){
      sh.deleteRow(r+1);
      return;
    }
  }
  throw new Error("Not found in Pending: " + id);
}

function json_(obj, code){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
