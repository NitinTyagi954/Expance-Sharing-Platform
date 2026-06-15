# Spreetree — CSV Importer Policy & Data Problem Reference

**Project:** Spreetree — Shared Flatmate Expense Tracker  
**Document purpose:** This document explains exactly how the CSV import feature works, every data problem it detects, and the documented policy for handling each one. Written to satisfy the assignment requirement: "For each problem, your importer must detect it, surface it to the user, and handle it according to a policy you choose and document."

---

## Table of Contents
1. [How the Importer Works](#how-the-importer-works)
2. [The 13+ Data Problems Detected](#the-13-data-problems-detected)
3. [Policy Decisions Per Problem Type](#policy-decisions-per-problem-type)
4. [Currency Conversion Policy](#currency-conversion-policy)
5. [Balance Calculation Engine](#balance-calculation-engine)
6. [Debt Simplification Algorithm](#debt-simplification-algorithm)

---

## How the Importer Works

The importer uses a **Parse → Stage → Review → Commit** pipeline:

```
CSV Upload
    │
    ▼
┌─────────────────────┐
│  1. PARSE           │  csvParser.js
│  Read & normalize   │  Parses all CSV columns into typed objects
│  raw CSV rows       │  (dates, amounts, participants, split type)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  2. DETECT          │  importerEngine.js
│  Run 13 anomaly     │  Cross-references rows against each other
│  detectors          │  and against the group's member/date records
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  3. REVIEW          │  ImportDashboard.jsx (frontend)
│  Surface anomalies  │  User sees every flagged row with:
│  to user            │  - Description of the problem
│                     │  - Suggested resolution action
│                     │  - [Approve] [Reject] [Modify] buttons
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  4. COMMIT          │  imports.js /finalize endpoint
│  Finalize with      │  Resolved rows committed in a single
│  user's decisions   │  atomic Prisma transaction to PostgreSQL
└─────────────────────┘
```

**Key principle:** A crashed import and a silent guess are both failing answers. The importer never silently modifies data — every change is surfaced to the user before committing.

---

## The 13+ Data Problems Detected

The importer detects these anomaly types (all visible in the Audit Anomalies Log table on the UI):

| # | Anomaly Type | CSV Column(s) Affected | Rows in Test CSV |
|---|---|---|---|
| 1 | `DUPLICATE` | description + date | Rows 5, 24 |
| 2 | `SETTLEMENT` | description / notes | Row 13 |
| 3 | `NEGATIVE_AMOUNT` | amount | Row 25 |
| 4 | `ZERO_AMOUNT` | amount | Row 30 |
| 5 | `MISSING_CURRENCY` | currency | Row 27 |
| 6 | `MISSING_PAYER` | paid_by | Row 12 |
| 7 | `INVALID_DATE` | date | Any unparseable date |
| 8 | `AMBIGUOUS_DATE` | date | Rows 15,17–25,33 |
| 9 | `NAME_MISMATCH` | paid_by | Rows 8, 10, 26 |
| 10 | `MEMBERSHIP_VIOLATION` | paid_by + date | Row 35 |
| 11 | `SPLIT_CONFLICT` | split_type + split_details | Row 41 |
| 12 | `PERCENTAGE_MISMATCH` | split_details | Rows 14, 31 |
| 13 | `EXTERNAL_MEMBER` | split_with | Row 22 |
| 14 | `AMOUNT_FORMAT` | amount | Row 6 |

---

## Policy Decisions Per Problem Type

---

### 1. DUPLICATE — Exact & Conflicting Duplicates

**What is detected:**  
Two rows are checked for similarity using:
- Same calendar date (UTC)  
- Description word-overlap ≥ 70% (using 3+ letter words)

If both match, duplicates are split into two subtypes:

**a) Exact duplicate** — same payer and same amount  
→ Example: Row 5 is an exact copy of Row 4 (Dinner at Marina Bites, both ₹850 paid by Aisha)

**b) Conflicting duplicate** — same description/date but different payer or different amount  
→ Example: Row 24 (Rohan, ₹2450 for Thalassa dinner) conflicts with Row 23 (Aisha, ₹2400 for same event same date)

**Policy:**
- **Both types are flagged for user approval.** The app never auto-deletes silently.
- Exact duplicates: suggested action is `DISCARD` the later row.
- Conflicting duplicates: suggested action is `RESOLVE_CONFLICT` — user must decide which row is correct.
- **Rationale (Meera's Rule):** Meera's explicit requirement is "I want to approve anything the app deletes or changes." Auto-deleting even obvious duplicates violates this.
- **User options:** Approve (discard the flagged row) | Reject (keep the flagged row anyway) | Modify (edit row before keeping)

---

### 2. SETTLEMENT — Expense Logged as Settlement

**What is detected:**  
Description or notes match any of these keywords (case-insensitive):  
`settlement`, `settle`, `repay`, `paid back`, `pay back`, `transfer`, `repayment`

**Example:** Row 13 has notes "Rohan settled his share from last month" → detected as settlement, not expense.

**Policy:**
- Flagged with suggested action `CONVERT_TO_SETTLEMENT`.
- Approving converts the row into a `Settlement` record (separate table from `Expense`), linking payer and receiver.
- **Rationale:** A settlement is not a shared cost — it is debt repayment. Recording it as an expense would double-count: once as an expense split (wrong) and once as a balance reduction. The separate Settlement model handles this correctly.

---

### 3. NEGATIVE_AMOUNT — Refund or Credit

**What is detected:**  
Amount parsed to a negative number.

**Example:** Row 25 has amount `-30` (USD). Notes say "one slot got cancelled."

**Policy:**  
- Flagged with suggested action `MARK_AS_REFUND`.
- Approving sets `isRefund = true` on the Expense record and converts the amount to its absolute value.
- In the balance calculation, refund expenses **subtract** from what the payer is owed and **subtract** from what participants owe — reversing the expense effect.
- **Rationale:** A negative amount with contextual notes unambiguously signals a refund, not a data error. Blocking it would silently lose valid financial data. Treating as refund preserves the financial intent.
- **Rule:** Negative amounts are always flagged — never silently negated. The user confirms the refund interpretation or rejects the row.

---

### 4. ZERO_AMOUNT — Zero-Value Expense

**What is detected:**  
Amount equals exactly `0`.

**Example:** Row 30 is a Swiggy order with amount `0` (likely a cancellation or test entry).

**Policy:**  
- Flagged with suggested action `SKIP_ROW`.
- A zero-amount expense has no financial impact and is almost always a data error.
- **Rationale:** Importing a zero-amount expense adds noise to the ledger without changing any balances. Suggesting skip is the safest default while still giving the user the option to keep or modify it.

---

### 5. MISSING_CURRENCY — Blank Currency Column

**What is detected:**  
The `currency` column is empty or whitespace-only.

**Example:** Row 27 has no currency value.

**Policy:**  
- Flagged with suggested action `DEFAULT_TO_INR`.
- Approving sets `currency = 'INR'` and `exchangeRate = 1.0`.
- **Rationale:** INR is the group's home currency. A blank currency on an Indian flatmate expense sheet most likely means INR was forgotten, not that the expense is in a foreign currency. Defaulting to INR is safe and reversible via Modify.

---

### 6. MISSING_PAYER — Blank paid_by Field

**What is detected:**  
The `paid_by` column is empty or whitespace-only.

**Example:** Row 12 has no payer. Notes say "can't remember who paid."

**Policy:**  
- Flagged with suggested action `REQUIRE_PAYER`.
- This is a **blocking anomaly** — the Finalize button is disabled until all `REQUIRE_PAYER` rows are either modified (payer assigned) or rejected (row discarded).
- **Rationale:** The payer field directly determines who gets reimbursed. Guessing wrong corrupts every member's balance. There is no safe default payer. The user must either remember who paid or discard the row. A row with no payer cannot be silently imported.

---

### 7. INVALID_DATE — Unparseable Date

**What is detected:**  
The `date` column cannot be parsed by any of the supported formats:
- `YYYY-MM-DD` (ISO)
- `DD/MM/YYYY`
- `Month DD` (e.g. `Mar 14`)
- Native JS Date parser as fallback

**Policy:**  
- Flagged with suggested action `REQUIRE_DATE`.
- Blocking anomaly — Finalize disabled until resolved.
- **Rationale:** A date-less expense cannot be checked against membership windows and cannot be placed correctly in the chronological ledger. The user must provide a valid date or discard the row.

---

### 8. AMBIGUOUS_DATE — Date Could Be DD/MM or MM/DD

**What is detected:**  
Date format `XX/YY/YYYY` where both `XX ≤ 12` and `YY ≤ 12` and they are not equal.  
This means the date could be read as either `DD/MM/YYYY` or `MM/DD/YYYY`.

**Examples detected:**  
- `01/03/2026` → could be March 1st or January 3rd  
- `05/03/2026` → could be March 5th or May 3rd  
- `04/05/2026` → could be May 4th or April 5th

**Policy:**  
- Flagged with suggested action `SELECT_DATE_FORMAT`.
- The UI shows **two clickable format buttons**: `Use DD/MM/YYYY` and `Use MM/DD/YYYY`, each showing the resulting date (e.g. "2026-03-01" vs "2026-01-03").
- The recommended format (`DD/MM/YYYY`) is marked with a ⭐ based on context (surrounding rows in the sheet are DD/MM dates).
- **No silent choice is made.** The user must click a format to proceed.
- **Rationale:** Choosing the wrong date format on March 5th vs May 3rd is a financial accuracy error — it would link the expense to the wrong membership window. The user is the only one who can confirm which date is correct.

---

### 9. NAME_MISMATCH — Payer Name Doesn't Match Group Members

**What is detected:**  
Three sub-cases:

**a) Case/whitespace normalization:** `'priya'` → `'Priya'`, `'rohan '` → `'Rohan'`  
→ Rows 8, 26

**b) Fuzzy match (Levenshtein distance ≤ 3):** `'Priya S'` → `'Priya'`  
→ Row 10

**c) No match found** → flagged as `EXTERNAL_MEMBER` instead (see #13)

**Policy:**  
- Flagged with suggested action `NORMALIZE_NAME`.
- Approving updates the row's `paidBy` to the normalized/matched member name.
- **Rationale:** Names in spreadsheets inevitably contain casing inconsistencies and abbreviations. Fuzzy matching (Levenshtein distance algorithm) catches typos without requiring exact string equality. The match is always shown to the user before applying — the system suggests, the user confirms.
- **Threshold:** Levenshtein distance ≤ 3, or one name is a substring of the other.

---

### 10. MEMBERSHIP_VIOLATION — Expense Outside Member's Active Window

**What is detected:**  
For the payer and each split participant, the expense date is checked against:
- `joinedAt`: member must have joined on or before the expense date
- `leftAt`: member must not have left before the expense date

**Example:** Row 35 includes Meera in the split for an April grocery run. Meera left March 31st. A post-departure expense should not include Meera.

**Policy — Participants:**  
- Flagged with suggested action `REMOVE_INACTIVE_PARTICIPANT`.
- Approving removes the inactive participant from `splitWith` on that row.
- Remaining participants split the cost equally.

**Policy — Payer:**  
- Flagged with suggested action `ADJUST_MEMBERSHIP_WINDOW`.
- The user can modify the membership dates via the "Edit Membership Dates" button on the dashboard, or reject the row.

**Rationale:** An expense participant who was not living in the flat on that date should not owe anything for it. Silently including them would generate incorrect balances. Silently excluding them would change the cost distribution without the user's knowledge. The user confirms removal.

---

### 11. SPLIT_CONFLICT — Type Says EQUAL but Details Exist

**What is detected:**  
`split_type = EQUAL` but `split_details` column is populated with individual shares.

**Example:** Row 41 has `split_type = equal` but `split_details = 'Aisha 1; Rohan 1; Priya 1; Sam 1'`.

**Policy:**  
- Flagged with suggested action `USE_SPLIT_DETAILS`.
- Approving overrides `splitType` to `SHARE` and uses the detail values as share weights.
- **Rationale:** `split_details` is more specific than `split_type`. If a user wrote out individual share numbers, those numbers represent their intent more precisely than the type label. The type label is likely a data entry oversight. Details take priority.

---

### 12. PERCENTAGE_MISMATCH — Split Percentages Don't Sum to 100%

**What is detected:**  
`split_type = PERCENTAGE` but the sum of all percentage values in `split_details` is not 100%.

**Examples:** Rows 14 and 31: `'Aisha 30%; Rohan 30%; Priya 30%; Meera 20%'` sums to **110%**.

**Policy:**  
- Flagged with suggested action `NORMALIZE_PERCENTAGES`.
- The normalized values are pre-computed proportionally: each percentage is divided by the total sum (`30/110 ≈ 27.27%`, `20/110 ≈ 18.18%`) and adjusted so they sum to exactly 100%.
- Approving applies the normalized details string to the row.
- **The normalized percentages are shown to the user in the anomaly description before approval.**
- **Rationale:** The user's notes indicate approximate values ("percentages might be off"). Auto-normalizing preserves the intended ratio while making the math valid. This is more useful than forcing the user to manually recalculate to 6 decimal places. The change is fully visible before confirmation.

---

### 13. EXTERNAL_MEMBER — Person Not in Group

**What is detected:**  
A name in `paid_by` or `split_with` that:
- Does not match any group member exactly (after normalization)
- Does not fuzzy-match any member within the distance threshold

**Example:** Row 22 `split_with` contains `"Dev's friend Kabir"`. Kabir is not a registered group member.

**Policy:**  
- Flagged with suggested action `CREATE_GUEST`.
- Approving results in a guest `User` record being created (`isGuest = true`) when the import is finalized.
- The guest is added to the group with a `joinedAt` date matching the expense date.
- **Rationale:** Ignoring Kabir's share means the flat members collectively absorb his cost — this is inaccurate. Creating a guest account lets the system track that Kabir owes his share without giving him login access. The `isGuest` flag keeps guest accounts clearly separate from registered members in the UI.

---

### 14. AMOUNT_FORMAT — Amount Contains Commas or Formatting Characters

**What is detected:**  
The raw amount value in the CSV contains commas or extra spaces (e.g. `'1,200'` instead of `1200`).

**Example:** Row 6 has amount `'1,200'`.

**Policy:**  
- Flagged with suggested action `AUTOCORRECT_AMOUNT`.
- The system strips commas and parses the numeric value (`1,200` → `1200`).
- Approving applies the parsed amount.
- **Rationale:** Comma-formatted numbers are a common spreadsheet export artifact, not a data error. The correction is shown to the user (parsed value visible in anomaly description) before confirmation.

---

## Currency Conversion Policy

### How it works

1. **At upload time:** A live USD/INR exchange rate is fetched from `open.er-api.com` once per import session.
2. **Rate is attached to all USD rows** in the parsed row objects before anomaly detection.
3. **At finalize time:** Each USD expense stores three values:
   - `amount` — original USD value (e.g. `150`)
   - `exchangeRate` — the rate used (e.g. `95.18`)
   - `amountInINR` — converted amount (e.g. `14,276.48`)
4. **Fallback:** If the live rate API fails, a fallback of `83.0` INR/USD is used.

### Why store both values?

Storing `amountInINR` separately means:
- Balance queries sum `amountInINR` directly — no runtime conversion needed
- Historical balances are never changed by future exchange rate changes
- Every conversion is auditable (you can always see what rate was used)

### Split amounts in USD

When a USD expense is split equally among 5 people:
- Each split record stores the **raw USD share** (e.g. `30.00`)
- The balance engine converts at query time: `split.amount × expense.exchangeRate`
- Example: Kabir's share = `30 × 95.18 = ₹2,855.30`

---

## Balance Calculation Engine

The balance engine runs at `GET /api/groups/:id/balances` and computes:

```
For each member:
  totalPaid   = SUM(amountInINR for all expenses they paid)
              - SUM(amountInINR for refunds they paid)  [refunds subtract]
  
  totalOwed   = SUM(split.amount × expense.exchangeRate for all splits)
              - SUM(refund split shares)                [refunds subtract]
  
  totalSentSettlements     = SUM(settlement.amount where paidById = member)
  totalReceivedSettlements = SUM(settlement.amount where receivedById = member)
  
  netBalance = (totalPaid - totalOwed) + totalSentSettlements - totalReceivedSettlements
```

**Positive `netBalance`** = this member is owed money (they've paid more than their share).  
**Negative `netBalance`** = this member owes money (they've paid less than their share).

---

## Debt Simplification Algorithm

Raw balances show each member's net position but don't say specifically who pays whom. The app uses **greedy debt simplification** (Aisha's requirement: "one number per person").

**Algorithm:**
1. Sort debtors by most negative balance first
2. Sort creditors by most positive balance first
3. Match largest debtor to largest creditor
4. Emit a transfer for `min(|debtor.balance|, creditor.balance)`
5. Reduce both balances by that amount, repeat

**Result:** The minimum number of bank transfers needed to fully settle all debts.

**Example output from the test import:**
```
Priya  → pays Aisha  ₹62,914.94
Rohan  → pays Aisha  ₹28,220.02
Rohan  → pays Dev    ₹29,203.09
Meera  → pays Dev    ₹8,849.39
Meera  → pays Sam    ₹11,867.22
Kabir  → pays Sam    ₹2,855.28
```

---

*This document reflects the implemented state of the importer as of the final submission. All 13 anomaly types are detected, surfaced, and handled by documented policy. Integration test: `node backend/verify-importer.js`.*
