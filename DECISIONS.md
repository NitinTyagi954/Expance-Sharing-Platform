# DECISIONS.md — Decision Log

Every significant decision made during this project, the options considered, and why one was chosen. Written as decisions were made, not reconstructed at the end.

---

## Decision 1 — Database: Relational vs NoSQL

**Context:** Needed to pick a database before any schema work.

**Options considered:**
- MongoDB (document store, flexible schema)
- PostgreSQL (relational, strict schema)

**Chose:** PostgreSQL (via Neon)

**Why:** The assignment explicitly requires relational DBs. Beyond compliance, the data model has real relational structure — expenses reference users, splits reference expenses, memberships have foreign keys to both groups and users. Joins are the natural operation here. A document store would require manually maintaining referential integrity that PostgreSQL enforces for free.

**Trade-off accepted:** More upfront schema design required. Worth it for data integrity.

---

## Decision 2 — ORM: Prisma vs Sequelize vs raw SQL

**Context:** Needed an ORM to work with PostgreSQL from Node.js.

**Options considered:**
- Raw SQL (pg library directly)
- Sequelize (mature, widely used)
- Prisma (schema-first, newer)

**Chose:** Prisma 7

**Why:** Schema-first approach means the schema file is the source of truth — readable, version-controlled, and easy to explain in an interview. Migrations are auto-generated from schema diffs. The Prisma adapter pattern works cleanly with Neon's serverless PostgreSQL. Sequelize requires more boilerplate model definitions.

**Trade-off accepted:** Prisma 7 required a `prisma.config.ts` and separate `DIRECT_URL` for Neon — slightly more setup than Sequelize. Worth it for the cleaner developer experience.

---

## Decision 3 — Membership tracking: date-based vs flag-based

**Context:** Sam moved in mid-April. Meera moved out end of March. The app needs to know who was active on any given expense date.

**Options considered:**
- Boolean `isActive` flag on membership (simple, but loses history)
- Separate join/leave event log table
- `joinedAt` + `leftAt` fields on GroupMembership (date range per member)

**Chose:** `joinedAt` + `leftAt` on GroupMembership

**Why:** A boolean flag cannot answer "was this person a member on March 15?" — it only knows current state. An event log is more flexible but more complex to query. The date-range approach answers the membership question with a single WHERE clause: `joinedAt <= expense.date AND (leftAt IS NULL OR leftAt >= expense.date)`. This is exactly what Sam's requirement needs.

**Trade-off accepted:** A member who left and rejoined needs two separate GroupMembership records. Acceptable for this use case.

---

## Decision 4 — Negative amounts: error vs refund

**Context:** Row 26 has amount = -30 USD. Two interpretations exist.

**Options considered:**
- Treat as a data error, block import
- Treat as a refund/credit

**Chose:** Treat as refund, set `isRefund = true`

**Why:** The notes field says "one slot got cancelled" — context unambiguously confirms this is an intentional refund, not a mistake. A blanket error policy would silently lose valid financial data. The `isRefund` flag on the Expense model allows the balance calculation to handle these correctly (subtract from what the payer is owed rather than add to what they paid).

**Rule documented:** Any negative amount with a note explaining the reason → refund. Any negative amount with no context → flag for user confirmation.

---

## Decision 5 — Missing payer: guess vs block

**Context:** Row 13 has no paid_by. Note says "can't remember who paid."

**Options considered:**
- Default to group creator
- Split the cost as "unknown" and ignore the payer field
- Block this row until user assigns a payer

**Chose:** Block the row, require user to assign payer before import

**Why:** The payer field directly determines who gets reimbursed. Guessing wrong corrupts every member's balance. There is no safe default. The cost of blocking one row (user must make one decision) is much lower than the cost of a silently wrong balance that nobody notices until much later.

---

## Decision 6 — Duplicate resolution: auto vs user approval

**Context:** Two types of duplicates exist in the CSV — exact duplicates (same amount) and conflicting duplicates (same description, different amounts).

**Options considered:**
- Auto-delete exact duplicates, flag conflicting ones
- Flag all duplicates for user approval

**Chose:** Flag all duplicates for user approval (Meera's explicit requirement)

**Why:** Meera's requirement was "I want to approve anything the app deletes or changes." Auto-deleting even exact duplicates violates this. The cost is one extra click per duplicate. The benefit is the user never discovers a silent deletion after the fact.

---

## Decision 7 — Currency conversion: fixed rate vs live rate

**Context:** Several expenses are in USD. Priya's requirement: the sheet treated $1 = ₹1, which is wrong.

**Options considered:**
- Hard-code a fixed exchange rate (e.g. 1 USD = 83 INR)
- Fetch live rate from an API at import time
- Let user enter the rate manually

**Chose:** Fetch live rate at import time + let user override

**Why:** A fixed rate becomes wrong the moment exchange rates move. Fetching live ensures the conversion is accurate for when the expense actually occurred. The override option handles cases where the user knows the exact rate used (e.g. the rate their credit card charged). Both the original amount and the converted amount are stored, so the conversion is always auditable.

**Implementation note:** Rate is fetched once per import session and applied to all USD expenses in that session.

---

## Decision 8 — Percentage normalization: auto vs block

**Context:** Row 15 has percentages that sum to 110%, not 100%.

**Options considered:**
- Block the row, require user to fix percentages manually
- Auto-normalize proportionally and flag the change

**Chose:** Auto-normalize with user notification

**Why:** The note says "percentages might be off" — the user is aware it's approximate. Auto-normalizing (30/110, 30/110, 30/110, 20/110 → each divided by 1.1) preserves the intended ratio while making the math work. The change is shown to the user before confirmation. This is more useful than forcing the user to manually recalculate six decimal places.

---

## Decision 9 — Guest users (Kabir): create account vs ignore share

**Context:** Row 23 includes "Dev's friend Kabir" in the split. Kabir is not a flat member.

**Options considered:**
- Ignore Kabir's share, split only among flat members
- Create a guest User record for Kabir

**Chose:** Create guest User (`isGuest = true`)

**Why:** Ignoring Kabir's share means the flat members collectively absorb his cost — inaccurate. Creating a guest account lets the system track that Kabir owes his share without giving him login access. The `isGuest` flag keeps guest accounts clearly separated from real members in the UI.

---

## Decision 10 — Import flow: one-shot vs review-and-confirm

**Context:** The importer detects anomalies. The question is whether to apply all changes immediately or show them to the user first.

**Options considered:**
- Apply all auto-corrections immediately, show a report after
- Show all anomalies first, require user to approve each one, then import

**Chose:** Review-and-confirm (Meera's requirement)

**Why:** Meera explicitly said "I want to approve anything the app deletes or changes." A one-shot import with a post-hoc report cannot be undone easily if the user disagrees with a decision. The review step adds friction but prevents irreversible mistakes. The ImportSession status machine (PENDING → IN_REVIEW → COMPLETED) supports pausing at the review stage.

---

## Decision 11 — Split conflict resolution (Row 42): type wins vs details win

**Context:** Row 42 has `split_type = equal` but `split_details` contains individual share counts.

**Options considered:**
- Trust split_type, ignore split_details
- Trust split_details, override split_type

**Chose:** split_details takes priority

**Why:** split_details is more specific than split_type. If someone took the time to write out individual shares, those shares represent their intent more precisely than the type label. The type label is likely a data entry error (forgot to change "equal" to "share"). Flag the conflict and correct the type to SHARE.

---

## Decision 12 — `amountInINR` column: store vs compute

**Context:** USD expenses need to show as INR in balances. Two options for where this conversion lives.

**Options considered:**
- Store only original amount, compute INR on every balance query
- Store both original and converted amount in the Expense row

**Chose:** Store both in the Expense row (`amount`, `amountInINR`, `exchangeRate`)

**Why:** Computing on every query requires the exchange rate to be stored somewhere anyway. Storing it in the row makes every expense self-contained — you can always see what rate was used, when, and reproduce the exact calculation. Balance queries become simpler (just sum `amountInINR`) with no risk of a rate change retroactively altering historical balances.

---

## Decision 13 — Membership validation on expense creation

**Context:** When creating an expense, should we validate that all
split participants were active members on the expense date?

**Options considered:**
- Validate at import time only, trust manual entry
- Validate on every expense creation regardless of source

**Chose:** Validate on every POST /api/expenses

**Why:** Sam's requirement is that March expenses don't affect him.
If we only validate at import, a manually entered expense could
silently include an inactive member. The membership check runs
against joinedAt / leftAt for every participant on every expense.
Out-of-bounds participants are rejected with a clear error message.


## Decision 14 — Float rounding: remainder to largest share

**Context:** Splitting ₹1199 equally among 4 people = ₹299.75 each.
Fine. But ₹1440 among 4 = ₹360 each. Some amounts don't divide
evenly and floating point makes it worse.

**Options considered:**
- Round everyone to 2 decimal places, ignore the remainder
- Add the remainder to the first person's share
- Add the remainder to the largest share

**Chose:** Remainder goes to the largest share

**Why:** Adding to the first person is arbitrary and slightly unfair
to whoever happens to be listed first. Adding to the largest share
is still arbitrary but the person already paying the most absorbs
the smallest relative impact. Verified with test-splits.js that
split amounts always sum exactly to the expense total.


## Decision 15 — Backdating group creator membership

**Context:** The group creator needs a joinedAt date. For historical
imports (the flat existed since February), the creator's membership
needs to start in February, not when they registered in the app.

**Options considered:**
- Always set joinedAt = now() for group creator
- Accept optional joinedAt in the group creation payload

**Chose:** Accept optional joinedAt, default to now()

**Why:** The entire CSV import covers February onwards. If the group
creator's membership starts today, every February expense fails
the membership validation check. The optional backdating solves
this without any special-casing in the expense logic.

---

## Decision 16 — Refund handling in balance calculation

**Context:** isRefund expenses need to affect balances opposite to
normal expenses. A refund reduces what the payer is credited for
and reduces what participants owe.

**Options considered:**
- Filter out refunds entirely and handle as a separate calculation
- Subtract refund amounts inline using the same paid/owed formula

**Chose:** Subtract inline — same formula, negative contribution

**Why:** Keeping one formula for all expenses is simpler and less
error-prone than a separate refund path. isRefund = true flips
the sign: subtracted from totalPaid for the payer, subtracted
from totalOwed for participants. Verified manually that this
produces correct net balances.


## Decision 17 — Greedy debt simplification vs exact pairwise

**Context:** Aisha wants "one number per person — who pays whom,
how much, done." Raw balances show each person's net but don't
say who specifically pays whom.

**Options considered:**
- Show raw net balances only (simpler, but doesn't answer who pays whom)
- Exact pairwise tracking (track every debt pair, complex)
- Greedy simplification (minimize number of transactions)

**Chose:** Greedy debt simplification

**Why:** Minimizes the number of transfers needed to settle all
debts. Sort debtors and creditors by balance magnitude, match
largest pairs first, emit a transfer for min(debt, credit),
repeat. Correct for this group size. At scale (50+ members)
this can be suboptimal but for 4-5 flatmates it is exact.


## Decision 18 — db.js fallback to DIRECT_URL for local dev

**Context:** Neon's pooled connection URL has a wake-up timeout
that caused intermittent failures during local test runs.

**Options considered:**
- Always use pooled URL (production-like but unreliable locally)
- Use DIRECT_URL only in development via NODE_ENV check

**Chose:** Fallback to DIRECT_URL when NODE_ENV !== production

**Why:** The pooler is needed in production (Neon charges by
compute, pooling reduces cold starts). Locally, the direct
connection is faster and 100% reliable. One-line NODE_ENV check
in db.js, no impact on production behavior.


## Decision 19 — Pipeline Architecture for Anomaly Review & Finalization

**Context:** Messy CSV inputs contain duplicate, zero-value, ambiguous date, and membership-violating entries that must be resolved by the user before committing.

**Options considered:**
- Auto-resolve all anomalies programmatically and import immediately
- Reject files with anomalies outright, requiring manual pre-editing of the CSV
- Pipeline: Parse -> Stage & Detect anomalies -> User Review -> Commit Finalized Dataset

**Chose:** Pipeline architecture with review-and-confirm.

**Why:** Satisfies Meera's rule ("I want to approve anything the app deletes or changes"). It ensures the CSV is never edited by hand (immutability of source), while giving the user absolute control to skip, convert, or modify entries before they hit database ledger tables.


## Decision 20 — Custom DNS Override for Serverless Database Connectivity

**Context:** Local network DNS resolvers occasionally fail to resolve or refuse CNAME queries for serverless cloud databases (like Neon).

**Options considered:**
- Hardcode the current resolved IP address (risky, as IPs change dynamically)
- Force Node.js process to use Google Public DNS servers (`8.8.8.8`) at runtime
- Rely on system default DNS resolution (without overrides)

**Chose:** Rely on system default DNS resolution (Google DNS override was reverted).

**Why:** While the Google DNS override resolved connectivity in some development environments, it broke connectivity completely in networks where port 53 (DNS) queries to external IPs like `8.8.8.8` are blocked/intercepted, causing `ENOTFOUND` errors. Furthermore, using a pooler host as the direct connection string to bypass DNS broke Prisma's interactive transactions (`prisma.$transaction`). Reverting the DNS override and keeping the direct (non-pooler) host for `DIRECT_URL` ensures compatibility across both direct query and transaction pathways.



## Decision 21 — Sequential Interactive Transaction for Mass CSV Commits

**Context:** Committing 40+ expenses and settlements along with split calculations and guest profiles creates 100+ database writes/reads. Parallel executions inside a single Prisma interactive transaction cause connection pool lockups/starvation.

**Options considered:**
- Run database writes in parallel inside the transaction (`Promise.all`)
- Run database writes sequentially inside a single transaction with an increased timeout

**Chose:** Sequential writes + pre-resolved names + 90-second timeout

**Why:** Parallel queries over a single transaction connection overload the transaction proxy, leading to hangs. Sequential processing is the stable, recommended path. By pre-resolving unique names first, we minimize lookup overhead, and the 90-second timeout ensures resilience against cloud database network roundtrip latencies.


## Decision 22 — Email Invitation Rule for Group Members

**Context:** Automatically creating Guest profiles when inviting users by email led to situations where users could not register their accounts afterwards due to unique email constraints.

**Options considered:**
- Keep automatically creating Guest users and allow Guest users to register/upgrade their accounts (requires complex password upgrades and data merging logic).
- Restrict email invites to registered users only. If the email doesn't exist, block addition and instruct the inviter to share the website link for the user to register first.

**Chose:** Restrict email invites to registered users only.

**Why:** Ensures clear account ownership and registration simplicity. Creating local guests by name only is still supported for local ledger splits, but introducing email-based members requires them to register their account first, resolving email collision bugs cleanly.


