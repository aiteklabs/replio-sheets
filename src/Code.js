/**
 * Replio Sheets sync: copies the training sessions of a Replio organization
 * into a Google Sheet, once an hour.
 *
 * Standalone Apps Script project (not bound to the sheet): the API key lives
 * in this project's Script Properties and is readable only by people who can
 * edit the SCRIPT, not by everyone who can edit the sheet.
 *
 * Functions to run from the editor:
 *   refreshSessions      fetch and upsert the sessions of the configured projects
 *   installHourlyTrigger run refreshSessions every hour
 *   removeTriggers       stop the hourly run
 *   clearSessions        empty the Sessions tab (headers kept)
 *   showConfig           log the effective configuration
 */

var SESSIONS_SHEET = "Sessions";
var CONFIG_SHEET = "_config";
var DEFAULT_BASE_URL = "https://api.replio.eu/v1";
var DEFAULT_LOOKBACK_DAYS = 30;
var PAGE_SIZE = 100;

var COLUMNS = [
  "session_id",
  "project_name",
  "trainee_name",
  "trainee_email",
  "persona_name",
  "mode",
  "status",
  "started_at",
  "duration_seconds",
  "score",
  "evidence_level",
  "conversation_outcome",
  "scoring_override",
  "analyzed",
  "trainee_page",
];

function refreshSessions() {
  var config = readConfig_();
  var since = new Date(Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000);
  var fetched = [];
  config.projectIds.forEach(function (projectId) {
    fetched = fetched.concat(fetchSessions_(config, projectId, since));
  });
  var written = upsertSessions_(config.sheet, fetched);
  Logger.log("Fetched " + fetched.length + " sessions, " + written.added + " added, " + written.updated + " updated.");
}

function installHourlyTrigger() {
  removeTriggers();
  ScriptApp.newTrigger("refreshSessions").timeBased().everyHours(1).create();
  Logger.log("Hourly trigger installed.");
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "refreshSessions") ScriptApp.deleteTrigger(trigger);
  });
}

function clearSessions() {
  var sheet = sessionsSheet_(readConfig_().sheet);
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  Logger.log("Sessions tab cleared.");
}

function showConfig() {
  var config = readConfig_();
  Logger.log(
    JSON.stringify(
      {
        baseUrl: config.baseUrl,
        sheetId: config.sheet.getId(),
        projectIds: config.projectIds,
        lookbackDays: config.lookbackDays,
        apiKey: config.apiKey ? "set (" + config.apiKey.slice(0, 8) + "...)" : "MISSING",
      },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------

function readConfig_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty("REPLIO_API_KEY");
  var sheetId = props.getProperty("SHEET_ID");
  if (!apiKey) throw new Error("Script property REPLIO_API_KEY is missing.");
  if (!sheetId) throw new Error("Script property SHEET_ID is missing.");
  var sheet = SpreadsheetApp.openById(sheetId);
  var configTab = sheet.getSheetByName(CONFIG_SHEET);
  if (!configTab) throw new Error('The spreadsheet has no "' + CONFIG_SHEET + '" tab.');
  var values = configTab.getDataRange().getValues();
  var projectIds = [];
  var lookbackDays = DEFAULT_LOOKBACK_DAYS;
  values.forEach(function (row, index) {
    var key = String(row[0] || "").trim();
    var value = String(row[1] || "").trim();
    if (index === 0 && key.toLowerCase() === "key") return;
    if (key === "project_id" && value) projectIds.push(value);
    if (key === "lookback_days" && Number(value) > 0) lookbackDays = Math.min(365, Math.floor(Number(value)));
  });
  if (projectIds.length === 0) throw new Error('No "project_id" rows in the ' + CONFIG_SHEET + " tab.");
  return {
    apiKey: apiKey,
    baseUrl: (props.getProperty("REPLIO_BASE_URL") || DEFAULT_BASE_URL).replace(/\/$/, ""),
    sheet: sheet,
    projectIds: projectIds,
    lookbackDays: lookbackDays,
  };
}

function fetchSessions_(config, projectId, since) {
  var rows = [];
  var cursor = null;
  var guard = 0;
  do {
    var url =
      config.baseUrl +
      "/sessions?project_id=" + encodeURIComponent(projectId) +
      "&from=" + encodeURIComponent(since.toISOString()) +
      "&limit=" + PAGE_SIZE +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    var response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + config.apiKey, Accept: "application/json" },
      muteHttpExceptions: true,
    });
    var status = response.getResponseCode();
    if (status === 401) throw new Error("Replio refused the API key (401). Check REPLIO_API_KEY.");
    if (status === 403) throw new Error("The API key lacks the sessions:read scope (403).");
    if (status !== 200) throw new Error("Replio answered " + status + " for project " + projectId + ".");
    var body = JSON.parse(response.getContentText());
    rows = rows.concat(body.data || []);
    cursor = body.next_cursor || null;
    guard += 1;
  } while (cursor && guard < 200);
  return rows;
}

function upsertSessions_(spreadsheet, sessions) {
  var sheet = sessionsSheet_(spreadsheet);
  var lastRow = sheet.getLastRow();
  var index = {};
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach(function (row, i) {
      if (row[0]) index[String(row[0])] = i + 2;
    });
  }
  var added = 0;
  var updated = 0;
  var appendBuffer = [];
  sessions.forEach(function (session) {
    var row = toRow_(session);
    var existing = index[session.session_id];
    if (existing) {
      sheet.getRange(existing, 1, 1, COLUMNS.length).setValues([row]);
      updated += 1;
    } else {
      appendBuffer.push(row);
      index[session.session_id] = lastRow + appendBuffer.length + 1;
      added += 1;
    }
  });
  if (appendBuffer.length > 0) {
    sheet.getRange(lastRow + 1, 1, appendBuffer.length, COLUMNS.length).setValues(appendBuffer);
  }
  return { added: added, updated: updated };
}

function sessionsSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SESSIONS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SESSIONS_SHEET);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function toRow_(session) {
  var traineePage = session.trainee_membership_id
    ? "https://replio.eu/en/dashboard/trainees/" + session.trainee_membership_id
    : "";
  return [
    literal_(session.session_id),
    literal_(session.project_name),
    literal_(session.trainee_name),
    literal_(session.trainee_email),
    literal_(session.persona_name),
    literal_(session.mode),
    literal_(session.status),
    session.started_at ? new Date(session.started_at) : "",
    numberOrBlank_(session.duration_seconds),
    numberOrBlank_(session.score),
    literal_(session.evidence_level),
    literal_(session.conversation_outcome),
    literal_(session.scoring_override),
    session.analyzed === true,
    traineePage,
  ];
}

/**
 * Every string coming from the API is written as plain text. A value that
 * starts with =, +, -, @, a tab or a carriage return would otherwise be read
 * by Sheets as a formula, so a trainee or persona name can never execute.
 */
function literal_(value) {
  if (value === null || value === undefined) return "";
  var text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function numberOrBlank_(value) {
  return typeof value === "number" && isFinite(value) ? value : "";
}
