# JobHunter / JobPitchApp
AI-powered job discovery, lead analysis, and outreach automation

This repository is a **monorepo** containing:

- **Frontend**: Vite + React UI
- **Backend**: Fastify + TypeScript API (job discovery, lead filtering, analysis, application generation, SMTP email sending)

The system discovers companies and jobs, analyzes relevance using AI models, generates tailored applications, and sends them via **direct SMTP** (no Mailgun, no Brevo).

---

## Requirements

- **Node.js**: **Node 20 LTS recommended**
  - Node 22 may work, but tooling like `tsx` can break if installs are corrupted
- **npm** (pnpm/yarn also work if you adapt commands)
- An **SMTP mailbox** (Gmail / Zoho / custom domain) with an **App Password**

---

## Repository structure

```
.
├── src/                       # Frontend (Vite + React)
│   ├── components/
│   ├── pages/
│   ├── api.ts
│   └── App.tsx
│
├── outreach-backend/          # Backend (Fastify + TS)
│   ├── src/
│   │   ├── ai/                # AI providers + pipelines
│   │   ├── campaign/          # Campaign runners
│   │   ├── config/            # Lexicon / config
│   │   ├── crawl/             # Website crawling & email extraction
│   │   ├── db/                # JSON DB helpers
│   │   ├── email/             # SMTP mailer + send logic
│   │   ├── scheduler/         # Job scheduling
│   │   └── server.ts          # Fastify entry point
│   │
│   ├── data/                  # Runtime data (JSON, CVs, schedules)
│   │   └── cv/
│   ├── .env.example
│   └── package.json
│
├── vite.config.ts
├── package.json
└── README.md
```

> ⚠️ Files inside `outreach-backend/data/` are **runtime state**
> (sent emails, schedules, uploaded CVs). They are usually **not meant to be committed**.

---

## Installation

### 1) Frontend dependencies (repo root)

```bash
npm install
```

If React plugin is missing:

```bash
npm i -D @vitejs/plugin-react
```

---

### 2) Backend dependencies

```bash
cd outreach-backend
npm install
```

---

## Backend configuration (.env)

Create your backend environment file:

```bash
cd outreach-backend
cp .env.example .env
```

Fill in `outreach-backend/.env`.

### SMTP (required to send emails)

```env
SMTP_HOST=smtp.zoho.eu
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_app_password

SMTP_FROM=your@email.com
SMTP_FROM_NAME=Threedex Studio
```

Notes:
- Use **App Passwords** for Gmail / Zoho
- Port rules:
  - `587` → STARTTLS (most common)
  - `465` → SSL/TLS

---

### AI providers (optional but recommended)

Enable any combination you want:

```env
GEMINI_API_KEY=...
DEEPSEEK_API_KEY=...
PERPLEXITY_API_KEY=...
OPENAI_API_KEY=...
```

Unused providers can be left empty.

---

### Sender / branding config

```env
MAIL_FROM="Your Name <your@email.com>"
SENDER_NAME=Your Name
STUDIO_NAME=Threedex Studio
BASE_OFFER=High-end architectural visualization & AI workflows
```

---

## Running the project

### Backend (Fastify API)

```bash
cd outreach-backend
npm run dev
```

Default backend port:
- `PORT` from `.env`
- fallback: **8787**

Backend URL:
```
http://127.0.0.1:8787
```

Health check:
```
GET /health
```

---

### Frontend (Vite)

From repo root:

```bash
npm run dev
```

Frontend will start on:
```
http://127.0.0.1:5173
```

---

## Vite → Backend proxy (recommended)

To avoid CORS issues and hardcoded ports, configure a proxy.

`vite.config.ts` (root):

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
```

Frontend can now call:
```
/api/discover-jobs
```
instead of hardcoding backend URLs.

---

## Main backend API endpoints

Health & stats:
- `GET  /health`
- `GET  /api/db/stats`

CV upload:
- `POST /api/upload-cv`

Job discovery pipeline:
- `POST /api/discover-jobs`
- `POST /api/prefilter`
- `POST /api/analyze`
- `POST /api/generate-applications`
- `POST /api/send-applications`

Scheduling:
- `GET  /api/job-schedules`

Email validation:
- `POST /api/validate-email`
- `POST /api/validate-emails`

---

## SMTP sending notes

- Emails are sent **directly via SMTP** (no Mailgun / Brevo)
- Attachments (CV PDFs) are sent via file path
- If attachments fail:
  - check the file path exists on the backend
  - ensure the backend working directory is correct

---

## Troubleshooting

### `ERR_MODULE_NOT_FOUND ... node_modules/.bin/package-XXXX.mjs`
This means a **corrupted install**, usually involving `tsx`.

Fix:

```bash
cd outreach-backend
rm -rf node_modules package-lock.json
npm install
```

If it keeps happening → switch to Node 20 LTS.

---

### `GET http://127.0.0.1:517x/ 404`
You are likely hitting the **backend port**, not Vite.

- Frontend → `5173`
- Backend → `8787` (or your `PORT`)

---

### `@fastify/multipart` type errors
Some versions don’t export `MultipartFile`.
Do **not** import it directly; infer types from `request.parts()` instead.

---

## Recommended .gitignore entries

```gitignore
**/node_modules/

outreach-backend/data/*.json
outreach-backend/data/*.backup
outreach-backend/data/bckp/
outreach-backend/data/cv/
outreach-backend/debug/
```

---

## Status

Active development – internal tooling / experimental
Not intended as a public SaaS template (yet).

