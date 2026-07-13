# grant-foundation

A grant management MVP built on Express with a role-based API, persisted data, and
a browser UI.

## Usage

```js
const express = require('express');
const grantFoundation = require('grant-foundation');

const app = express();
app.use(grantFoundation({ root: '/grants', dbPath: './grant-foundation.db' }));

app.listen(3000);
```

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000/grants/ui` for the UI.

## Roles and workflows

Roles:
- applicant
- reviewer
- program_officer
- finance
- admin

Core workflows represented in the API:
- intake
- review
- approval
- contracting
- disbursement
- reporting
- closeout

Use the `x-user-id` request header to act as one of the seeded demo users:
- `applicant-1`
- `reviewer-1`
- `officer-1`
- `finance-1`
- `admin-1`

## API highlights

- `GET /grants/config` — roles and workflow phases
- `GET /grants/users` — demo users for login switching
- `GET /grants/dashboard` — role-aware summary metrics
- `GET/POST /grants/grants` — list and create grant opportunities
- `PATCH /grants/grants/:grantId/status` — set grant status (`draft/open/closed`)
- `GET/POST /grants/applications` — list and submit applications
- `POST /grants/applications/:applicationId/reviews` — reviewer scoring
- `POST /grants/applications/:applicationId/decision` — approve/reject applications
- `POST /grants/applications/:applicationId/payments` — finance payment records
- `GET /grants/audit-logs` — admin audit trail

## Persistence and configuration

- API entrypoint persists to `grant-foundation.db` by default.
- Override with `GRANT_DB_PATH=/absolute/or/relative/path`.
- The library middleware accepts `dbPath` or `db` in its config for custom wiring.

## Vercel launch

This repository includes a Vercel-ready server entrypoint at `api/index.js` and
deployment rules in `vercel.json`.

Deploy with:

```bash
vercel --prod
```