# SaiAssist RSA — Dealer-Based Roadside Assistance Policy Platform

A multi-dealer (multi-tenant) web platform where authorised vehicle dealers issue, renew, endorse, cancel and track
Roadside Assistance (RSA) policies, and generate the **Tax Invoice cum Certificate** PDF in the standard layout of the
reference certificate — with each dealer's own logo, issuer, servicing office, helpline and data filled in automatically.

Built from the project's PRD + TRD v1.0 (`prd trd.md`, kept outside this repository).

**Live:** https://saiassist-rsa.vercel.app — public certificate verification at https://saiassist-rsa.vercel.app/verify
(Vercel project `dsamyaks-projects/saiassist-rsa`, Neon Postgres in Singapore via the Vercel marketplace).
Redeploy after changes with `npm run build:vercel && vercel deploy --prebuilt --prod`.

---

## What's included

| Area | Highlights |
|---|---|
| **Super Admin** | Dealer onboarding (branding, logo, issuer & servicing office, GSTIN, contacts, RSA helpline, numbering format, special conditions, field rules, editable sections), activate/deactivate dealers, dealer-specific products & pricing, RSA product catalogue (validity options, prices, GST, eligibility, benefits, conditions), platform settings & master certificate template with live preview, consolidated reports, all policies/payments/cancellations, audit log, platform users |
| **Dealer workspace** | Isolated per dealer. Dashboard (total / active / expiring / expired / today / this month), 5-step issuance wizard (customer → vehicle → plan & validity → payment → certificate preview → issue), quotations (drafts), policy search (number, name, mobile, registration, chassis, engine, status, dates), renewals, endorsements, cancellations with refunds & approval workflow, suspension, payments, customers & vehicles, reports, employees with configurable permissions, dealer settings, audit log |
| **Certificate engine** | One master design (pixel-matched to the reference A4 layout) + dealer branding + policy data → PDF. QR code to the public verification page, preserved immutable versions (original + endorsements, SHA-256 recorded), PREVIEW / QUOTATION / PAYMENT PENDING / CANCELLED / SUSPENDED watermarks |
| **Public verification** | `/verify/<certificate number>` (QR target) shows validity and status with masked personal data |
| **Notifications** | "RSA Policy Successfully Issued" via email (Resend), SMS / WhatsApp (webhook gateways); every attempt is logged. One-click WhatsApp share always available |

### PRD functional requirements

| ID | Requirement | Where |
|---|---|---|
| FR-01/02/03 | Dealers, separate workspaces, data isolation | `server/services/dealers.ts`, `middleware/auth.ts` (`dealerScope`, `requireDealer`), tests "isolates tenants" |
| FR-04 | Dealer Admin manages employees | Employees page, `/api/dealer/users` |
| FR-05/06 | Customers & vehicles | `services/customers.ts` |
| FR-07/08/09 | RSA products, premium & GST | `services/products.ts`, `lib/money.ts` (paise-exact; ₹1000 incl. 18% → 847.46 + 152.54) |
| FR-10 | Unique certificate numbers | `lib/policyNumber.ts` — tokens `{PREFIX}{DEALER}{YYYY}{YY}{MM}{DD}{SEQ:n}`, platform or dealer sequence |
| FR-11/12/13 | PDF from master template with dealer branding | `server/pdf/certificate.ts` |
| FR-14/15/16 | Search, renew, cancel | `services/policies.ts` |
| FR-17/18 | Dealer & consolidated reports | `services/reports.ts`, Reports page (CSV export) |
| FR-19 | Audit logs | `lib/audit.ts`, Audit Log pages |
| FR-20 | QR verification | certificate QR + `/verify` |
| FR-21/22/23 | Configurable benefits, products, dealer pricing | Product editor, Dealer → Products & pricing |

---

## Architecture

```
Browser (React SPA)  ──HTTPS──▶  Hono API (Node.js)  ──▶  PostgreSQL
  Vite · Tailwind · React Query     auth · RBAC · tenant scope      (Neon / any Postgres;
  pdf.js preview · Recharts         pricing · numbering · PDF        embedded PGlite locally)
```

* **Frontend** — React 18 + TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Hook Form, Recharts, pdf.js.
* **Backend** — Hono on Node.js (runs as a normal server *or* a single serverless function), zod validation, pdf-lib + qrcode.
* **Database** — PostgreSQL via `pg`. Without `DATABASE_URL` the app uses **PGlite** (real Postgres compiled to WASM),
  so it runs locally with zero setup. Schema migrations run automatically on start (`server/db/migrations.ts`).
* **Files** — dealer logos and issued certificates are stored in Postgres (`files`, `policy_documents`), immutable.

### Security model
* Tenant isolation is enforced **on the server**: dealer users are always pinned to their own `dealer_id`; every query on
  dealer-owned tables filters by it and cross-dealer access returns 404 (covered by tests).
* RBAC: `SUPER_ADMIN`, `DEALER_ADMIN`, `DEALER_EMPLOYEE` with per-employee permissions chosen by the Dealer Admin.
* Auth: scrypt password hashing, 15-minute HS256 access tokens (memory only), 7-day rotating refresh token in an
  `HttpOnly; Secure; SameSite=Strict` cookie, refresh-token reuse detection, forced password change for admin-created
  accounts, lockout after 5 failed attempts, DB-backed rate limiting on login and public verification.
* Hardening: CSP and security headers, body size limit, input validation on every endpoint, CSV formula-injection
  protection, no personal data in logs, issued certificates never modified (endorsements create new versions).

---

## Run locally

Requirements: Node.js 20.19+ (22 recommended).

```bash
npm install
npm run dev          # API on :8787 + web on http://localhost:5173 (embedded database in .data/)
```

Production-style single process:

```bash
npm run build
npm start            # http://localhost:8787
```

### Default accounts (local / demo data)

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@saiassist.local` | `Admin@12345` (set `SUPERADMIN_*` to change) |
| Dealer Admin — Sai Motors (Demo) | `admin@saimotors.demo` | `Demo@12345` |
| Dealer Employee — Sai Motors (Demo) | `pooja@saimotors.demo`, `amit@saimotors.demo` | `Demo@12345` |
| Dealer Admin — Shree Automobiles (Demo) | `admin@shreeauto.demo` | `Demo@12345` |
| Dealer Employee — Shree Automobiles (Demo) | `kiran@shreeauto.demo` | `Demo@12345` |

Demo dealers, customers and policies are fictional. Set `SEED_DEMO=false` before the first start for an empty platform.
To reset local data, stop the server and delete `.data/`.

### Environment variables

See `.env.example`. Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (empty → embedded PGlite) |
| `JWT_SECRET` | **Required in production**, ≥ 32 random characters |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | First Super Admin (created on first start) |
| `SEED_DEMO` / `DEMO_PASSWORD` | Demo data on first start |
| `PUBLIC_BASE_URL` | Base URL encoded in certificate QR codes |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SMS_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL` | Optional notification gateways |

---

## Deploy

### Vercel + Neon (used for the hosted instance)
1. Create a Postgres database on Neon (region `aws-ap-southeast-1` pairs with Vercel `sin1`) and copy the pooled connection string.
2. `npm run build:vercel` — builds the client and writes `.vercel/output` (CDN static files + one Node function for `/api/*`).
3. `vercel link`, then add env vars: `DATABASE_URL`, `JWT_SECRET`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SEED_DEMO`, `DEMO_PASSWORD`, `NODE_ENV=production`, `PUBLIC_BASE_URL`.
4. `vercel deploy --prebuilt --prod`. The first request runs migrations and the seed.

### Docker (any host: Render, Railway, Fly.io, AWS, a VPS)
```bash
docker build -t saiassist-rsa .
docker run -p 8080:8080 -e DATABASE_URL=... -e JWT_SECRET=... -e SUPERADMIN_PASSWORD=... saiassist-rsa
```

### Render
`render.yaml` is a ready Blueprint (web service + PostgreSQL in Singapore).

---

## Testing

```bash
npm test               # 30 API integration tests on an in-memory Postgres (auth, tenant isolation, RBAC,
                       # pricing/GST, numbering, issue/renew/endorse/cancel, payments, PDFs, verification, reports)
npm run typecheck
node scripts/ui-smoke.mjs http://localhost:8787   # drives the UI in headless Edge/Chrome and saves screenshots
npx tsx server/scripts/sample-certificate.ts out.pdf [logo.png]   # render a sample certificate
```

---

## Project structure

```
client/                 React app (pages/dealer, pages/admin, pages/shared, components, lib)
server/
  app.ts                Hono app: middleware, routes, error handling
  node.ts / vercel.ts   Runtime entries (long-running server / serverless function)
  db/                   Postgres + PGlite adapter, migrations, seed, default RSA catalogue
  middleware/auth.ts    Authentication, RBAC, tenant scope
  pdf/certificate.ts    Certificate engine (master template renderer)
  services/             Business logic (policies, products, dealers, customers, payments, reports, …)
  routes/               HTTP endpoints
shared/constants.ts     Roles, permissions, statuses, vehicle & fuel types, labels
tests/                  API integration tests
scripts/                Build scripts and UI smoke test
```

## API overview

All endpoints are under `/api` and return JSON (`{ error: { code, message, details } }` on failure).

* Auth — `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`
* Super Admin — `/admin/dashboard`, `/admin/dealers` (+ `/:id`, `/:id/status`, `/:id/products`, `/:id/users`), `/admin/rsa/products`, `/admin/settings` (+ `/preview`), `/admin/users`
* Workspace — `/dashboard`, `/customers`, `/vehicles`, `/rsa/products`, `/policies` (+ `/quote`, `/preview`, `/drafts`, `/issue`, `/export`, `/:id`, `/:id/pdf`, `/:id/documents/:v`, `/:id/renew`, `/:id/endorse`, `/:id/cancel`, `/:id/cancel-request`, `/:id/suspend`, `/:id/reinstate`, `/:id/notify`), `/cancellations`, `/payments`, `/reports/summary`, `/audit-logs`, `/dealer/users`, `/dealer/settings`
* Public — `/health`, `/public/branding`, `/public/policies/verify/:policyNumber`, `/files/:id` (logos)

## Next steps (outside the MVP scope)
OTP / MFA sign-in, payment-gateway integration (UPI collect / links), object storage for certificates at very high
volume, scheduled renewal reminders, bulk import of existing policies.
