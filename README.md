# Replio Sheets sync

Copies the training sessions of your [Replio](https://replio.eu) organization
into a Google Sheet, once an hour: one row per session with trainee, persona,
duration, AI score, evidence level, outcome and a link to the trainee's page.
Late analyses fill in on the next run.

Built on the Replio public API (`GET /v1/sessions`). Nothing else is called.

## Before you start: who can read the key

The sync runs as a **standalone** Apps Script project, not as a script bound
to the sheet. Reason: a bound script inherits the sheet's editors, and anyone
who can edit a bound script can read its Script Properties, including the API
key. With a standalone project, only the people you add to the SCRIPT can
read the key; people who only edit the SHEET cannot.

The key reads every project of the organization, not only the projects
listed in `_config`. Treat it as organization-wide access to session results.

## Setup

1. **Create the API key** on your Replio dashboard: Developers > API keys >
   Create, scope `sessions:read` only. Copy it once; it is not shown again.
2. **Create the sheet.** Add a tab named `_config` with two columns:

   | key | value |
   |---|---|
   | project_id | `<project id from Developers > API or from the project page URL>` |
   | project_id | `<another project id>` |
   | lookback_days | 30 |

   One `project_id` row per project to track. `lookback_days` (default 30,
   max 365) is the window re-read on every run. Note the sheet id from its
   URL (`/spreadsheets/d/<SHEET_ID>/edit`).
3. **Create the script.** Go to [script.google.com](https://script.google.com),
   New project, name it (for example "Replio sync"). Replace the content of
   `Code.gs` with [src/Code.js](src/Code.js). In Project settings, tick
   "Show appsscript.json" and replace it with [src/appsscript.json](src/appsscript.json).
4. **Script properties** (Project settings > Script properties):
   - `REPLIO_API_KEY`: the key from step 1
   - `SHEET_ID`: the sheet id from step 2
   - `REPLIO_BASE_URL` (optional): defaults to `https://api.replio.eu/v1`
5. **Check**: run `showConfig` from the editor and read the execution log.
   The first run asks for the Sheets and external-request permissions.
6. **First sync**: run `refreshSessions`. A `Sessions` tab appears with the
   rows.
7. **Schedule**: run `installHourlyTrigger` once. `removeTriggers` stops it.

### With clasp

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # put your standalone script id in it
clasp push
```

Then do steps 4 to 7 in the Apps Script editor.

## Columns

`session_id`, `project_name`, `trainee_name`, `trainee_email`,
`persona_name`, `mode` (coach, exercise, expert), `status`, `started_at`,
`duration_seconds`, `score` (1 to 10, empty until analyzed and always empty
for expert sessions), `evidence_level`, `conversation_outcome`,
`scoring_override`, `analyzed`, `trainee_page`.

Sessions under 60 seconds are capped at 5 by Replio; the score is a training
signal, not a performance review.

## What the sync does and does not do

- **Export, not mirror.** Rows are updated in place by `session_id` and never
  deleted by the sync. A session deleted on Replio stays in the sheet;
  revoking the key does not erase what was exported. `clearSessions` empties
  the tab. Retention of the sheet is the sheet owner's responsibility.
- **Literal text.** Every value from the API is written as text. A value that
  starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading
  apostrophe, so a trainee or persona name can never run as a formula. Test
  it: name a persona `=1+1` in a test project and sync.
- **Volume.** One request per 100 sessions per project per run, well below
  the API limit of 120 requests per minute per key.

## Errors

- `401`: the key is wrong or revoked. Create a new one.
- `403`: the key lacks `sessions:read`, or developer features are off for the
  organization.
- `No "project_id" rows`: the `_config` tab is empty or mis-named.

## License

MIT. Replio is a commercial service by AitekLabs.
