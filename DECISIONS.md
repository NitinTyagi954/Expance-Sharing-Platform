# DECISIONS.md — Architecture & Implementation Decisions

This log documents the key design decisions, technical trade-offs, and architecture choices I made while building Spreetree. I updated this log as I worked, rather than trying to recreate it at the end of the project.

---

## Decision 1: Choosing a Relational Database (PostgreSQL via Neon)

* **Context:** Need to store users, groups, memberships, expenses, split configurations, settlements, and import reviews.
* **Options Considered:** MongoDB (NoSQL) vs. PostgreSQL (Relational).
* **The Choice:** PostgreSQL.
* **Why:** The application domain is highly relational. A single expense split links a user to an expense, which is tied to a group. Foreign keys, referential integrity, and cascading deletes are essential here. If I went with MongoDB, I would have had to write custom validation logic to make sure a deleted user's split records didn't remain orphaned. Postgres handles that out of the box. Using Neon also gives us a cloud-hosted serverless instance with zero cold-start latency issues.
* **Trade-off:** Schema changes require migrations rather than just modifying the objects on the fly, but the strictness is a massive win for financial data.

---

## Decision 2: Prisma 7 ORM

* **Context:** Choosing a database client library for Node.js.
* **Options Considered:** Raw SQL (`pg` driver), Sequelize, or Prisma.
* **The Choice:** Prisma 7.
* **Why:** Prisma's schema-first design acts as the single source of truth for the database layout. The auto-generated TypeScript/JS client makes writing queries incredibly fast and type-safe. It also handles migrations cleanly through `npx prisma migrate dev`.
* **Trade-off:** Prisma 7 requires using a client adapter (`@prisma/adapter-pg`) when interacting with connection pools. This requires a bit of configuration, but the query safety is worth it.

---

## Decision 3: Tracking Membership Transitions with Joined/Left Dates

* **Context:** Meera moved out on March 31st. Sam joined on April 8th. The system must know who was active in the flat on the exact day an expense occurred.
* **Options Considered:** 
  1. A simple `isActive` boolean flag on the membership row.
  2. A separate membership history log table.
  3. Storing nullable `joinedAt` and `leftAt` timestamps directly on the `GroupMembership` relation.
* **The Choice:** nullable `joinedAt` and `leftAt` on `GroupMembership`.
* **Why:** A simple boolean flag can only tell us current state, so it fails if we try to calculate historical balances. An audit log is overkill for this scale. Using joined/left date ranges lets us check membership status for any expense date using a single SQL range query: `joinedAt <= date AND (leftAt IS NULL OR leftAt >= date)`.
* **Trade-off:** If a member leaves the flat and rejoins later, they will have two separate membership records. The balance query handles this cleanly by summing splits across both records.

---

## Decision 4: Handling Negative Amounts as Refunds

* **Context:** Row 26 in the CSV has an amount of `-30 USD` for a "Parasailing refund".
* **Options Considered:** Reject negative amounts as data entry errors, or support a refund mechanism.
* **The Choice:** Introduce an `isRefund` flag on the Expense model.
* **Why:** The note explicitly says "one slot got cancelled". Discarding it would lose actual cash flow data. By setting `isRefund = true` and storing the amount as a positive absolute value, we can easily reverse the balance calculation: instead of adding to what the payer is owed, the refund subtracts from it, and subtracts from what the split participants owe.
* **Trade-off:** The balance engine and split math require explicit branches to handle `isRefund` conditions, which slightly increases complexity.

---

## Decision 5: Blocking Missing Payers

* **Context:** Row 13 in the CSV has a blank `paid_by` field with the note "can't remember who paid".
* **Options Considered:** Guess the payer (e.g., default to the group creator), or block the row.
* **The Choice:** Block the row and force manual resolution.
* **Why:** Assigning a payment to the wrong person completely corrupts the balance ledger. The cost of a silent guess is too high. The importer stages this row and prevents final import until the user manually selects a payer.
* **Trade-off:** This stops the import flow until a human intervenes, but it is the only way to ensure financial accuracy.

---

## Decision 6: Duplicates Require Explicit User Action

* **Context:** The CSV contains both exact duplicates (Row 5 matches Row 4) and conflicting duplicates (Row 24 conflicts with Row 25).
* **Options Considered:** Auto-delete exact duplicates and flag conflicting ones, or flag both.
* **The Choice:** Flag all duplicates for manual confirmation.
* **Why:** I wanted to stick to Meera's rule: *"I want to approve anything the app deletes or changes."* Silently discarding rows (even identical ones) violates user trust. surrendering control to the user is safer.
* **Trade-off:** The user has to click "Approve/Reject" for duplicate cards during import review, but the UI includes an "Approve All" utility to resolve duplicates quickly.

---

## Decision 7: Fetching Live Exchange Rates at Ingestion

* **Context:** Several expenses are logged in USD (Goa trip).
* **Options Considered:** Hardcode a static conversion rate (e.g., 1 USD = 83 INR) or fetch live exchange rates.
* **The Choice:** Fetch live exchange rates during CSV upload and allow manual overrides.
* **Why:** Fixed rates go out of date immediately. Fetching the current rate from an exchange rate API (`open.er-api.com`) at upload time ensures the conversion is realistic. We also let the user edit the rate on the review screen before finalizing.
* **Trade-off:** The import process depends on an external API. If the API goes down, we fallback to a hardcoded rate of `83.0` and log a warning.

---

## Decision 8: Auto-Normalizing Mismatched Percentages

* **Context:** Row 15 split percentages sum to 110% instead of 100%.
* **Options Considered:** Block the row, or auto-normalize the percentages.
* **The Choice:** Auto-normalize proportionally and show the before/after details to the user.
* **Why:** The note says "percentages might be off". The user knows the numbers are approximate. Recalculating ratios by hand is annoying. The importer automatically divides each percentage by the total sum (e.g., `30% / 1.1 = 27.27%`), ensuring they equal 100% while preserving the original ratio.
* **Trade-off:** The final numbers might look slightly different (e.g., 27.27% instead of 30%), but the app shows these changes in the review card so nothing is hidden.

---

## Decision 9: Creating Guest User Accounts for External Splitting

* **Context:** Row 23 splits a Goa expense with "Dev's friend Kabir", who isn't a resident member of the flat.
* **Options Considered:** Exclude Kabir and split his share among the residents, or track Kabir's share.
* **The Choice:** Create a guest user account (`isGuest: true`) for Kabir.
* **Why:** If we split Kabir's share among the residents, the residents end up paying for him, which is inaccurate. Creating a guest profile lets the system record that Kabir owes the flat money, without forcing him to register or set up a password.
* **Trade-off:** The database contains user records that have no email or password hashes. These profiles are excluded from the main login screen.

---

## Decision 10: The Stage-Review-Commit Pipeline

* **Context:** Importing messy CSVs can easily corrupt production tables if errors aren't caught early.
* **Options Considered:** Parse and write directly to the main tables, or use a staging pipeline.
* **The Choice:** Implement a **Parse -> Stage & Detect -> Review UI -> Commit** pipeline.
* **Why:** Staging uploads inside an `ImportSession` and tracking problems in an `ImportAnomaly` table allows the backend to hold the data in suspension. The user reviews everything in a dashboard, makes corrections, and commits only when they are satisfied.
* **Trade-off:** We store temporary staged rows and anomalies in the database, requiring cleanup logic if an import is abandoned.

---

## Decision 11: Prioritizing Specific Split Details Over Generic Split Type

* **Context:** Row 42 is marked as an "equal" split, but contains specific share breakdown details: `Aisha 1; Rohan 1; Priya 1; Sam 1`.
* **Options Considered:** Trust the split type and ignore the text details, or trust the details.
* **The Choice:** Trust the details and change the split type to `SHARE`.
* **Why:** Text details are specific. If someone wrote out individual share numbers, they did it with intent. The "equal" label is likely a copy-paste error from previous rows.
* **Trade-off:** We override the split type field, but we show the change clearly in the review dashboard.

---

## Decision 12: Storing Converted Currency Values on the Expense Record

* **Context:** We need to handle USD expenses when computing INR balances.
* **Options Considered:** Store only the raw USD amount and convert at query time, or store both.
* **The Choice:** Store `amount`, `amountInINR`, and `exchangeRate` directly on the `Expense` model.
* **Why:** If we convert at query time, the system would need to fetch historical exchange rates on the fly, which is slow and fragile. Storing the converted INR value at creation time makes the balance queries fast (just sum `amountInINR`) and ensures that historical reports never change if exchange rates shift.
* **Trade-off:** Redundant data storage, but the performance and stability gains are huge.

---

## Decision 13: Enforcing Membership Validation on Expense Creation

* **Context:** We need to make sure we don't accidentally split expenses with members who weren't active on that date.
* **Options Considered:** Validate only during CSV import, or validate on all expense operations.
* **The Choice:** Run membership interval checks on every write operation.
* **Why:** If we only validate at import time, a manual API request or frontend form submission could still write invalid data. Checking the expense date against user membership intervals on every POST/PUT ensures ledger integrity.
* **Trade-off:** Every expense creation request requires an extra database lookup to check member histories.

---

## Decision 14: Distributing Floating-Point Split Remainders

* **Context:** Splitting ₹1199 equally among 4 people results in ₹299.75 each. Splitting ₹1440 among 4 results in ₹360 each. What happens when divisions are uneven?
* **Options Considered:** Round everyone to 2 decimal places and ignore the remainder, or distribute the remainder.
* **The Choice:** Round splits to 2 decimal places and add the remainder to the person who has the largest share.
* **Why:** Financial ledgers must balance exactly to the penny. If we ignore remainders, the sum of splits won't equal the total expense amount. Distributing the remaining paise to the largest share ensures the split balances perfectly, and the relative impact on the person paying the most is negligible.
* **Trade-off:** One person pays a few paise more, but it is mathematically sound.

---

## Decision 15: Allowing Custom Join Dates for Group Creators

* **Context:** A group creator's membership defaults to the group's creation timestamp.
* **Options Considered:** Always use creation date, or support custom backdated join times.
* **The Choice:** Accept a custom `joinedAt` timestamp during group creation.
* **Why:** Since the flatmates have historical expenses from February but only set up the app in June, the group creator's membership must be backdated to February. Otherwise, February imports fail validation.
* **Trade-off:** Requires the API to support an optional date parameter during group initialization.

---

## Decision 16: Inline Refund Math in the Balance Engine

* **Context:** Refund records must adjust balances in the opposite direction of normal expenses.
* **Options Considered:** Calculate refunds in a separate pass, or handle them inline.
* **The Choice:** Handle refunds inline by flipping the signs during calculation.
* **Why:** Keeping a single query path is cleaner. When `isRefund = true`, we subtract the amount from the payer's total paid credit and subtract the split amount from what the participants owe. It uses the same SQL queries and keeps the codebase simple.
* **Trade-off:** Relies on correct sign mapping, but is easily testable.

---

## Decision 17: Greedy Debt Simplification

* **Context:** Calculating net balances is easy, but users need to know *who* should pay *whom*.
* **Options Considered:** Pairwise settlement (everyone settles their raw debts individually) or debt simplification.
* **The Choice:** Implement a greedy debt simplification algorithm.
* **Why:** It minimizes the total number of transactions. By matching the person with the largest net debt to the person with the largest net credit and emitting a transfer, we reduce the settlement process to a handful of payments.
* **Trade-off:** The algorithm runs in $O(N \log N)$ time, which is perfectly fine for flatmate group sizes.

---

## Decision 18: Fallback to Direct DB Connection in Development

* **Context:** Connection pooling issues with Neon's serverless proxy caused intermittent database timeouts in local dev environment.
* **Options Considered:** Force pooling everywhere, or connect directly in development.
* **The Choice:** Fallback to the direct PostgreSQL connection string when running in local development.
* **Why:** Neon's connection pooler is useful in production to manage high compute loads, but it adds network latency and cold-start timeouts to local development. Running queries directly to the database instance locally is faster and more stable.
* **Trade-off:** We use different connection strings for development and production, but it keeps the development loop fast.

---

## Decision 19: Single Transaction Commits for CSV Ingestion

* **Context:** Finalizing a CSV import involves writing dozens of expenses, splits, settlements, and guest profiles.
* **Options Considered:** Write each record individually, or wrap everything in a transaction.
* **The Choice:** Run all database writes within a single interactive Prisma transaction (`prisma.$transaction`).
* **Why:** If one write fails halfway through the import (due to a database error or network drop), we would end up with a partially imported dataset, which is a nightmare to clean up. Wrapping everything in a transaction ensures that the import either succeeds completely or rolls back entirely.
* **Trade-off:** Long-running transactions can block database tables, so we pre-resolve names and run writes sequentially to keep transaction times under the threshold.

---

## Decision 20: Reverting Custom DNS Overrides

* **Context:** A previous code version hardcoded Google Public DNS (`8.8.8.8`) at runtime to resolve Neon connection errors.
* **Options Considered:** Keep custom DNS resolvers, or use system default DNS.
* **The Choice:** Revert the custom DNS override and rely on system network defaults.
* **Why:** Hardcoding external DNS queries blocks connectivity entirely on networks where port 53 (DNS) queries to external IPs are firewalled. Bypassing DNS by connecting to pooler IPs also broke Prisma transactions. Using system defaults is the standard, stable way to handle DNS.
* **Trade-off:** Local network resolution issues must be handled by the system configuration rather than the application code.

---

## Decision 21: Sequential Database Writes inside Prisma Transactions

* **Context:** Writing 40+ expenses and splits in parallel inside a transaction caused connection starvation.
* **Options Considered:** Parallel writes (`Promise.all`) or sequential writes.
* **The Choice:** Run database writes sequentially inside a loop and set a 90-second timeout.
* **Why:** Sending dozens of concurrent queries over a single transaction connection exhausts the connection pool, causing transactions to time out. Running them sequentially prevents database pool congestion.
* **Trade-off:** Importing takes a few seconds longer, but it is 100% stable.

---

## Decision 22: Restricting Email Invites to Registered Accounts

* **Context:** Automatically creating guest accounts when adding members by email caused database collisions when those users tried to sign up later.
* **Options Considered:** Write data merging logic to claim guest accounts, or restrict email invites.
* **The Choice:** Only allow email invites for registered users. If the email doesn't exist, the system tells the inviter to share the registration link.
* **Why:** Avoids database state merging issues. Guest profiles can still be created locally by name (no email) for splits. Real email-based invitations are kept simple and conflict-free.
* **Trade-off:** Invited users must register before they can be added to a group via email.
