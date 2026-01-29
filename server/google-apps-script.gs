// Google Apps Script (Web App) for Civic Threat Google Sheets DB
// 1) Create a new Apps Script project (script.google.com) and paste this file.
// 2) Set SHEET_ID and (optional) API_KEY in Script Properties.
// 3) Deploy as Web App: Execute as "Me", Access: "Anyone" (or "Anyone with the link").
// 4) Copy the Web App URL into config.js -> CT_CONFIG.REMOTE_DB.appsScriptUrl and set enabled=true.
// Security: Set API_KEY in Script Properties and require X-CT-KEY header.

const PROP = PropertiesService.getScriptProperties();

function jsonOut(obj, code){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function assertKey_(e){
  const apiKey = PROP.getProperty("API_KEY");
  if(!apiKey) return;
  const got = (e && e.parameter && e.parameter.key) || (e && e.headers && (e.headers["X-CT-KEY"] || e.headers["x-ct-key"]));
  if(got !== apiKey) throw new Error("Unauthorized");
}

function getSheet_(){
  const id = PROP.getProperty("SHEET_ID");
  if(!id) throw new Error("Missing SHEET_ID in Script Properties");
  const ss = SpreadsheetApp.openById(id);

  const approved = ss.getSheetByName("approved") || ss.insertSheet("approved");
  const pending = ss.getSheetByName("pending") || ss.insertSheet("pending");

  // Ensure headers
  ensureHeaders_(approved);
  ensureHeaders_(pending);

  return {ss, approved, pending};
}

function ensureHeaders_(sheet){
  const headers = ["id","platform","category","title","fbUrl","embedHtml","submittedBy","submittedByUrl","consentToDisplayUsername","status","addedAt","submittedAt"];
  const first = sheet.getRange(1,1,1,Math.max(headers.length, sheet.getLastColumn() || headers.length)).getValues()[0];
  const needs = headers.some((h,i)=> (first[i]||"") !== h);
  if(needs){
    sheet.clear();
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function toObjects_(values){
  const headers = values[0] || [];
  const out = [];
  for(let r=1;r<values.length;r++){
    const row = values[r];
    if(!row.join("").trim()) continue;
    const obj = {};
    headers.forEach((h,i)=> obj[h] = row[i]);
    out.push(obj);
  }
  return out;
}

function doGet(e){
  try{
    assertKey_(e);
    const path = (e.pathInfo || "").replace(/^\//,"");
    const {approved, pending} = getSheet_();

    if(path === "" || path === "health"){
      return jsonOut({ok:true});
    }
    if(path === "approved"){
      const vals = approved.getDataRange().getValues();
      return jsonOut({items: toObjects_(vals)});
    }
    if(path === "pending"){
      const vals = pending.getDataRange().getValues();
      return jsonOut({items: toObjects_(vals)});
    }
    return jsonOut({error:"Not found"}, 404);
  }catch(err){
    return jsonOut({error:String(err)}, 500);
  }
}

function parseBody_(e){
  const body = e.postData && e.postData.contents ? e.postData.contents : "{}";
  try{ return JSON.parse(body); }catch(_){ return {}; }
}

function doPost(e){
  try{
    assertKey_(e);
    const path = (e.pathInfo || "").replace(/^\//,"");
    const {approved, pending} = getSheet_();
    const data = parseBody_(e);

    if(path === "submit"){
      const item = data || {};
      // force pending
      item.status = "pending";
      item.submittedAt = item.submittedAt || new Date().toISOString();
      appendRow_(pending, item);
      return jsonOut({ok:true});
    }

    if(path === "approve"){
      const id = String(data.id||"");
      moveRow_(pending, approved, id, "approved");
      return jsonOut({ok:true});
    }

    if(path === "reject"){
      const id = String(data.id||"");
      deleteRowById_(pending, id);
      return jsonOut({ok:true});
    }

    return jsonOut({error:"Not found"}, 404);
  }catch(err){
    return jsonOut({error:String(err)}, 500);
  }
}

function headers_(sheet){
  return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
}

function appendRow_(sheet, item){
  const h = headers_(sheet);
  const row = h.map(k => item[k] !== undefined ? item[k] : "");
  sheet.appendRow(row);
}

function findRowById_(sheet, id){
  const vals = sheet.getDataRange().getValues();
  const h = vals[0];
  const idx = h.indexOf("id");
  if(idx < 0) throw new Error("Missing id column");
  for(let r=1;r<vals.length;r++){
    if(String(vals[r][idx]) === String(id)) return {row:r+1, values: vals[r], headers:h};
  }
  return null;
}

function deleteRowById_(sheet, id){
  const found = findRowById_(sheet, id);
  if(found) sheet.deleteRow(found.row);
}

function moveRow_(fromSheet, toSheet, id, newStatus){
  const found = findRowById_(fromSheet, id);
  if(!found) return;
  const obj = {};
  found.headers.forEach((k,i)=> obj[k] = found.values[i]);
  obj.status = newStatus;
  obj.addedAt = obj.addedAt || new Date().toISOString();
  appendRow_(toSheet, obj);
  fromSheet.deleteRow(found.row);
}
