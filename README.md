# Spreetree — Shared Flatmate Expense Tracker

> [!IMPORTANT]
> **Demo Login Credentials for Review / Evaluation**
> 
> To make it easy to log into the application as different flatmates and review their respective ledgers, balances, and history, the database is seeded with the following accounts. (All accounts use the password: `password123`)
> 
> * **Rohan:** `rohan@gmail.com`
> * **Aisha:** `aisha@gmail.com`
> * **Priya:** `priya@gmail.com`
> * **Dev:** `dev@gmail.com`
> * **Sam:** `sam@gmail.com`
> * **Meera:** `meera@gmail.com` (ex-member, left on 2026-03-31)
> 
> *(Note: The login page also features click-to-fill shortcut buttons for each of these credentials.)*

---

## Table of Contents
1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Features](#features)
4. [CSV Import — How It Works](#csv-import--how-it-works)
5. [Data Problems Detected (13+)](#data-problems-detected-13)
6. [API Reference](#api-reference)
7. [Running Locally](#running-locally)
8. [Database Setup](#database-setup)
9. [Key Design Decisions](#key-design-decisions)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Vanilla CSS |
| Backend | Node.js, Express.js (ES Modules) |
| Database | PostgreSQL (Neon Serverless) |
| ORM | Prisma 7 (schema-first) |
| Auth | JWT (jsonwebtoken + bcryptjs) |
| Currency Rates | open.er-api.com (live USD/INR) |
| CSV Parsing | csv-parse |

---

## Project Structure

```
Spreetree/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Database schema (source of truth)
│   │   └── migrations/            # SQL migration history
│   ├── src/
│   │   ├── index.js               # Express server entry point
│   │   ├── db.js                  # Prisma client (direct URL for transactions)
│   │   ├── middleware/
│   │   │   └── auth.js            # JWT authentication middleware
│   │   ├── routes/
│   │   │   ├── auth.js            # /api/auth/register, /api/auth/login
│   │   │   ├── groups.js          # /api/groups/* (CRUD + members + balances)
│   │   │   ├── expenses.js        # /api/expenses (create + list)
│   │   │   ├── settlements.js     # /api/settlements (create)
│   │   │   └── imports.js         # /api/imports/* (upload, resolve, finalize)
│   │   └── utils/
│   │       ├── csvParser.js       # CSV parsing + date/amount normalization
│   │       ├── importerEngine.js  # 13+ anomaly detection algorithms
│   │       └── splits.js          # EQUAL/UNEQUAL/PERCENTAGE/SHARE calculator
│   ├── verify-importer.js         # Integration test: full import flow
│   └── verify-endpoints.js        # API endpoint smoke tests
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Login.jsx          # Registration + login
│       │   ├── Groups.jsx         # Group list + create group
│       │   ├── GroupDashboard.jsx # Members, balances, ledger view
│       │   └── ImportDashboard.jsx# CSV upload, anomaly review, finalize
│       └── utils/
│           └── api.js             # API client wrapper
│
├── IMPORTER_POLICY.md             # Full policy doc for each data problem
├── DECISIONS.md                   # Design decision log (22 decisions)
└── README.md                      # This file
```

---

## Features

### Group & Member Management
- Create groups with a backdated `joinedAt` date (supports historical imports)
- Add members by email (registered users) or by name (creates guest account)
- Remove members by setting a `leftAt` date — membership history is preserved
- Edit join/leave dates at any time via the dashboard

### Date-bounded Memberships
- Every expense validates that payer and all split participants were **active members on the expense date**
- Active = `joinedAt ≤ expenseDate AND (leftAt IS NULL OR leftAt ≥ expenseDate)`
- Inactive participants are flagged at import time and blocked at expense creation time

### Expense Management
- 4 split types: **EQUAL**, **UNEQUAL**, **PERCENTAGE**, **SHARE**
- Multi-currency: USD and INR supported (live exchange rate at import time)
- Refund tracking (`isRefund` flag) reverses a payer's balance contribution
- Full ledger view per member (chronological: what they paid, what they owed, net impact)

### Settlement Tracking
- Record direct payments between members
- Settlements are separate from expenses and apply directly to balances

### Balance Calculation
- Per-member `totalPaid`, `totalOwed`, and `netBalance` in INR
- USD splits converted using stored `exchangeRate` per expense (`split.amount × rate`)
- Greedy debt simplification: minimum number of transfers to settle all debts

### CSV Import (Meera's Rule: user approves every change)
- Upload raw `expenses_export.csv` without editing it first
- 13+ anomaly types detected automatically
- Every flagged row shown with description + suggested action
- [Approve] [Reject] [Modify] controls per anomaly
- "Approve All" button for auto-approvable anomalies
- Finalize commits all decisions atomically in a single transaction

---

## CSV Import — How It Works

The importer runs a **Parse → Detect → Review → Commit** pipeline:

### Step 1: Upload (`POST /api/imports/upload`)
- CSV file is parsed into typed row objects
- Live USD/INR exchange rate is fetched and attached to USD rows
- Anomaly detection runs against all rows + group membership records
- An `ImportSession` and `ImportAnomaly` records are saved to the database
- Frontend receives: `{ session, rows, exchangeRate }`

### Step 2: User Reviews Anomalies
- Frontend renders a table of all flagged anomalies
- User works through each row: Approve the suggestion / Reject the row / Modify inline
- `POST /api/imports/anomalies/:id/resolve` records each decision
- Stats update live: Total Rows | Manual Review | Correct Rows | Ready to Import

### Step 3: Finalize (`POST /api/imports/finalize`)
- All resolved row objects sent to backend
- Committed inside a **single Prisma transaction** (all or nothing)
- Names resolved to User records; guest accounts created for external members
- Expenses, splits, and settlements written to the database
- `ImportSession` status set to `COMPLETED`

---

## Data Problems Detected (13+)

> **Full policy documentation:** See [IMPORTER_POLICY.md](./IMPORTER_POLICY.md)

| # | Type | What It Catches | Policy |
|---|---|---|---|
| 1 | `DUPLICATE` | Same date + description → exact or conflicting copy | Flag both types; user approves discard |
| 2 | `SETTLEMENT` | Keywords: settle/repay/paid back in description/notes | Suggest `CONVERT_TO_SETTLEMENT` |
| 3 | `NEGATIVE_AMOUNT` | amount < 0 | Suggest `MARK_AS_REFUND`; sets `isRefund = true` |
| 4 | `ZERO_AMOUNT` | amount = 0 | Suggest `SKIP_ROW` |
| 5 | `MISSING_CURRENCY` | currency column blank | Suggest `DEFAULT_TO_INR` |
| 6 | `MISSING_PAYER` | paid_by blank | **Blocking** — user must assign payer or reject |
| 7 | `INVALID_DATE` | Date cannot be parsed at all | **Blocking** — user must provide valid date |
| 8 | `AMBIGUOUS_DATE` | `XX/YY/YYYY` where both XX≤12 and YY≤12 | Show 2 format buttons; user picks DD/MM or MM/DD |
| 9 | `NAME_MISMATCH` | Casing, spaces, abbreviation (e.g. "priya", "Priya S") | Fuzzy match via Levenshtein distance; user approves |
| 10 | `MEMBERSHIP_VIOLATION` | Expense date outside member's join-leave window | Remove inactive participant or adjust window |
| 11 | `SPLIT_CONFLICT` | `split_type=EQUAL` but split_details populated | Override split_type to SHARE |
| 12 | `PERCENTAGE_MISMATCH` | Percentages sum ≠ 100% | Auto-normalize proportionally; show result before approve |
| 13 | `EXTERNAL_MEMBER` | Name in split_with not found in group | Create guest user on finalize |
| 14 | `AMOUNT_FORMAT` | Amount has commas (e.g. `"1,200"`) | Strip commas, show parsed value |

---

## API Reference

All endpoints except `/auth/register` and `/auth/login` require:
```
Authorization: Bearer <jwt_token>
```

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user → returns `{ token, user }` |
| POST | `/api/auth/login` | Login → returns `{ token, user }` |

### Groups
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/groups` | Create group (optional `joinedAt` for backdating) |
| GET | `/api/groups` | List all groups for authenticated user |
| GET | `/api/groups/:id` | Get group details with all membership records |
| POST | `/api/groups/:id/members` | Add member by email or name (guest) |
| PUT | `/api/groups/:id/members/:userId` | Update member's joinedAt / leftAt |
| DELETE | `/api/groups/:id/members/:userId` | Set member's leftAt (soft-remove) |
| GET | `/api/groups/:id/balances` | Calculate balances + suggested settlements |

### Expenses
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/expenses` | Create expense with split calculation |
| GET | `/api/expenses/group/:groupId` | List all expenses for a group |

### Settlements
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/settlements` | Record a direct payment between members |

### Imports
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/imports/upload` | Upload CSV → detect anomalies → create session |
| POST | `/api/imports/anomalies/:id/resolve` | Record user's decision on a flagged row |
| POST | `/api/imports/finalize` | Commit all resolved rows to the database |

---

## Running Locally

### Prerequisites
- Node.js 18+ (uses native `fetch`)
- A Neon PostgreSQL database (free tier works)

### 1. Clone and install

```bash
git clone <repo-url>
cd Spreetree

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies  
cd ../frontend && npm install
```

### 2. Configure backend `.env`

Create `backend/.env`:
```env
DATABASE_URL=""
DIRECT_URL=""
JWT_SECRET="your-secret-key-here"
```

> **Important:** `DATABASE_URL` should be the **pooler** URL. `DIRECT_URL` must be the **direct** (non-pooler) URL. Prisma uses `DIRECT_URL` for `$transaction` operations which require a persistent connection.

### 3. Run migrations

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

### 4. Start servers

```bash
# Terminal 1 — Backend (port 5000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

Open http://localhost:5173

### 5. Run integration tests

```bash
# Full CSV import flow integration test
cd backend
node verify-importer.js

# API endpoint smoke tests
node verify-endpoints.js
```

---

## Database Setup

### Schema Overview

```
User ──────────┬── GroupMembership (joinedAt, leftAt) ──── Group
               ├── ExpenseSplit ──── Expense ──────────────── Group
               ├── Settlement ──────────────────────────────── Group
               └── ImportSession ── ImportAnomaly
```

### Key Tables

**`GroupMembership`** — Date-bounded, not boolean:
```sql
groupId   UUID  REFERENCES Group
userId    UUID  REFERENCES User
joinedAt  TIMESTAMP
leftAt    TIMESTAMP nullable   -- null = still active
```

**`Expense`** — Multi-currency aware:
```sql
amount       FLOAT   -- original amount (USD/INR)
currency     STRING  -- 'USD' or 'INR'
amountInINR  FLOAT   -- converted INR value (stored at import time)
exchangeRate FLOAT   -- rate used (e.g. 95.18 for USD→INR)
isRefund     BOOLEAN -- true = subtracts from balances
```

**`ExpenseSplit`** — Per-participant share:
```sql
expenseId  UUID
userId     UUID
amount     FLOAT   -- raw share in the expense's original currency
percentage FLOAT   -- if PERCENTAGE split
shares     INT     -- if SHARE split
```

**`ImportSession`** → tracks each CSV upload lifecycle  
**`ImportAnomaly`** → each flagged row and its resolution

---

## Key Design Decisions

Full decision log with rationale: [DECISIONS.md](./DECISIONS.md)

| Decision | Chosen Approach |
|---|---|
| Database | PostgreSQL — relational structure requires foreign keys & joins |
| ORM | Prisma 7 — schema-first, readable migrations, adapter for Neon |
| Membership tracking | `joinedAt + leftAt` per record — answers "was active on date X?" |
| Negative amounts | `isRefund = true` — reverses balance contribution inline |
| Missing payer | Block import — no safe default; payer = who gets reimbursed |
| Duplicate handling | Flag all for user approval (Meera's Rule) |
| Currency | Fetch live rate at upload time; store `amountInINR` per expense |
| Percentage normalization | Auto-normalize proportionally; show result before user approves |
| External members | Create `isGuest = true` user on finalize |
| Import flow | Review-and-confirm pipeline (not one-shot, not pre-edit required) |
| Split conflict | `split_details` overrides `split_type` label |
| Float rounding | Remainder goes to largest share |
| Debt simplification | Greedy algorithm — minimizes number of transfers |
| Transaction isolation | Sequential writes in 90s-timeout Prisma transaction (no parallel) |

---

*For the complete data problem policy document (required by assignment), see **[IMPORTER_POLICY.md](./IMPORTER_POLICY.md)**.*
