/**
 * Google Apps Script backend for the Vercel/Next.js eBay importer.
 * Set SPREADSHEET_ID and IMPORT_SECRET below before deploying.
 */
const SPREADSHEET_ID = '1FKX60y17YJ0km3IreDBXd8lxx5oiYnsJnXldeOXSbQo';
const IMPORT_SECRET = 'Arham_Ebay_2026_Secure_7392_XYZ_8Kp91';
const HEADERS = ['Order Number','Date','Address','Dispatch Date','Quantity','Product Name','AliExpress Order ID','AliExpress Price','eBay Order Earnings','Profit','','Tracking','Return/Refund','Import Key'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // serializes partner imports to avoid duplicate races
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.secret !== IMPORT_SECRET) return json({ok:false,error:'Unauthorized. Check IMPORT_SECRET.'});
    if (!Array.isArray(body.rows)) return json({ok:false,error:'No order rows received.'});

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const knownByMonth = {};
    const additions = {};
    const tabNames = new Set();
    let skipped = 0;

    body.rows.forEach(item => {
      const month = String(item.month || '').trim();
      const key = String(item.importKey || '').trim();
      const values = item.values;
      if (!month || !key || !Array.isArray(values) || values.length < 13) return;
      tabNames.add(month);
      const sheet = getOrCreateMonthSheet(ss, month);
      if (!knownByMonth[month]) {
        const last = sheet.getLastRow();
        const keys = last >= 2 ? sheet.getRange(2,14,last-1,1).getDisplayValues().flat() : [];
        knownByMonth[month] = new Set(keys.filter(String));
        // Backfill keys for older rows using order + product + quantity when possible.
        if (last >= 2) {
          const old = sheet.getRange(2,1,last-1,6).getDisplayValues();
          old.forEach((r,i) => {
            const existingKey = keys[i];
            if (!existingKey && r[0]) {
              const fallback = String(r[0]) + '::' + String(r[5] || '').toLowerCase().trim() + '||' + String(r[4] || '').trim();
              knownByMonth[month].add(fallback);
            }
          });
        }
        additions[month] = [];
      }
      if (knownByMonth[month].has(key)) { skipped++; return; }
      knownByMonth[month].add(key);
      const row = values.slice(0,13);
      row[9] = ''; // formula is assigned below after row position is known
      row.push(key);
      additions[month].push(row);
    });

    let added = 0;
    const updatedTabs = [];
    Object.keys(additions).forEach(month => {
      const rows = additions[month];
      if (!rows.length) return;
      const sheet = ss.getSheetByName(month);
      const start = Math.max(sheet.getLastRow() + 1, 2);
      sheet.getRange(start,1,rows.length,14).setValues(rows);
      const formulas = rows.map((_,i) => {
        const r = start + i;
        return [`=IF(OR(H${r}="",I${r}=""),"",I${r}-H${r})`];
      });
      sheet.getRange(start,10,rows.length,1).setFormulas(formulas);
      sheet.getRange(start,3,rows.length,1).setWrap(true).setVerticalAlignment('top');
      sheet.getRange(start,2,rows.length,1).setNumberFormat('dd-mmm-yyyy');
      sheet.getRange(start,4,rows.length,1).setNumberFormat('dd-mmm-yyyy');
      added += rows.length;
      updatedTabs.push(month);
    });
    return json({ok:true,added:added,skipped:skipped,tabs:updatedTabs,message:'Google Sheet updated.'});
  } catch (err) {
    return json({ok:false,error:String(err && err.message ? err.message : err)});
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function getOrCreateMonthSheet(ss, month) {
  let sh = ss.getSheetByName(month);
  if (!sh) sh = ss.insertSheet(month);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#d9eaf7');
    sh.setColumnWidth(3,300);
    sh.setColumnWidth(6,420);
    sh.setColumnWidth(1,180);
    sh.hideColumns(14); // internal deduplication key; visible sheet remains A:M
  } else {
    // Ensure the hidden key column exists for sheets created before this importer.
    if (sh.getMaxColumns() < 14) sh.insertColumnsAfter(sh.getMaxColumns(),14-sh.getMaxColumns());
    if (!String(sh.getRange(1,14).getValue()).trim()) sh.getRange(1,14).setValue('Import Key');
    sh.hideColumns(14);
  }
  return sh;
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
