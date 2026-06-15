# AI_USAGE.md — AI Tool Usage Log

---

## Tool Used

**Claude by Anthropic** (claude.ai, model: Claude Sonnet 4.6)  
Used as the primary development collaborator throughout this project.

---

## How Claude Was Used

Claude was used as a thinking partner and code collaborator — not as a code generator whose output was pasted without review. The workflow was:

1. Discuss the problem and understand requirements
2. Claude proposes an approach
3. I evaluate it against the actual CSV data and requirements
4. We iterate until the approach is correct
5. Claude helps write the code
6. I read every line, test it, and commit only what I understand

---

## Key Prompts Used

**Understanding the problem:**
> "I have a CSV with shared flat expenses. Read it and tell me every data problem you can find. Don't write any code yet."

**Schema design:**
> "Design a Prisma schema for a shared expenses app where group membership changes over time. One member left end of March, another joined mid-April. Their join and leave dates must affect which expenses they're included in."

**Anomaly detection:**
> "Write a Node.js function that detects duplicate rows in a CSV. Two rows are duplicates if they have the same description, date, and amount. Return an array of anomaly objects with rowNumber, type, description, and suggestedAction."

**Balance calculation:**
> "Write a function that takes all ExpenseSplits for a group and returns the net balance per user. Net = total amount paid - total amount owed. Walk me through the math before writing code."

**Import flow:**
> "Design the state machine for a CSV import. The user uploads a file, anomalies are detected, the user reviews and approves each one, then the import completes. What are the states and transitions?"

**Prisma + Neon setup:**
> "I'm using Prisma 7 with Neon PostgreSQL. What's the correct configuration for schema.prisma and prisma.config.ts when Neon requires both a pooled and a direct connection URL?"

- "Write a splits.js utility that handles EQUAL, UNEQUAL, PERCENTAGE,
  and SHARE split types. Each function must return an array of
  {userId, amount} where amounts sum exactly to the expense total."

- "Write an Express middleware that validates a Bearer JWT and attaches
  the decoded user to req.user."

- "For POST /api/expenses, write the membership validation logic.
  Given an expense date and a list of userIds, check that each userId
  has a GroupMembership where joinedAt <= date AND (leftAt IS NULL
  OR leftAt >= date)."

- "Implement the greedy debt simplification algorithm. Input is an
  array of {userId, netBalance}. Output is a minimal list of
  {from, to, amount} transfers that zero out all balances."

- "Write the ledger mapping for balance calculation. For each user,
  return a chronological array of expenses showing: date, description,
  amountPaid, amountOwed, netContribution per expense."

---

## Three Cases Where Claude Was Wrong

### Case 1 — Balance calculation formula was incorrect

**What Claude produced:**

```js
// Claude's initial suggestion
const balance = await prisma.expenseSplit.groupBy({
  by: ['userId'],
  _sum: { amount: true }
});
```

**Why it was wrong:** This sums only what each person *owes* across all splits. It does not subtract what each person *paid*. A person who paid ₹5000 and owes ₹1500 net should show +₹3500 (they are owed money). Claude's formula would show -₹1500 (they owe money) — the exact opposite of correct.

**How I caught it:** I walked through Rohan's balance by hand using the CSV data. Rohan paid the WiFi bill (₹1199) and the birthday cake (₹1500). Claude's formula showed Rohan with a negative balance (he owes money) when the manual calculation showed he should be positive. The numbers didn't match.

**What I changed:**

```js
// Correct formula
const paid = await prisma.expense.groupBy({
  by: ['paidById'],
  _sum: { amountInINR: true }
});

const owes = await prisma.expenseSplit.groupBy({
  by: ['userId'],
  _sum: { amount: true }
});

// net = paid - owed
// positive = this person is owed money
// negative = this person owes money
```

**Lesson:** Never trust a balance formula without walking through it manually for at least one member.

---

### Case 2 — Prisma 7 schema configuration was outdated

**What Claude produced:**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

**Why it was wrong:** Prisma 7 changed how Neon connections are configured. The `directUrl` field inside `schema.prisma` is a Prisma 5/6 pattern. Prisma 7 uses a separate `prisma.config.ts` file and the `PrismaPg` adapter from `@prisma/adapter-pg`. Claude's suggestion was based on older documentation and caused the migration to fail with a connection error.

**How I caught it:** Running `npx prisma migrate dev` failed with an adapter-related error. I checked the Prisma 7 changelog and the Neon integration docs, which showed the new pattern.

**What I changed:** Created `prisma.config.ts` with the adapter configuration and removed the connection URLs from `schema.prisma` entirely, as Prisma 7 requires.

**Lesson:** Claude's training data has a cutoff. For rapidly changing tools like Prisma, always verify against the official current documentation.

---

### Case 3 — Percentage normalization formula had a rounding error

**What Claude produced:**

```js
function normalizePercentages(splits) {
  const total = splits.reduce((sum, s) => sum + s.percentage, 0);
  return splits.map(s => ({
    ...s,
    percentage: (s.percentage / total) * 100
  }));
}
```

**Why it was wrong:** For Row 15 (30 + 30 + 30 + 20 = 110%), this produces:
- Aisha: 27.272727...%
- Rohan: 27.272727...%
- Priya: 27.272727...%
- Meera: 18.181818...%

These repeating decimals cause the final INR split amounts to not sum exactly to the expense total due to floating point precision. For a ₹1440 expense, the splits summed to ₹1439.9999... which fails validation.

**How I caught it:** Wrote a test that summed the split amounts and compared to the original expense amount. The comparison `splitTotal === expense.amount` failed. Logged the values and saw the floating point drift.

**What I changed:** Applied rounding and assigned the remainder to the largest share:

```js
function normalizePercentages(splits, totalAmount) {
  const total = splits.reduce((sum, s) => sum + s.percentage, 0);
  const normalized = splits.map(s => ({
    ...s,
    percentage: Math.round((s.percentage / total) * 10000) / 100,
    amount: Math.floor((s.percentage / total) * totalAmount * 100) / 100
  }));
  
  const distributed = normalized.reduce((sum, s) => sum + s.amount, 0);
  const remainder = Math.round((totalAmount - distributed) * 100) / 100;
  
  // add remainder to the largest split
  const maxIdx = normalized.reduce((maxI, s, i, arr) => 
    s.amount > arr[maxI].amount ? i : maxI, 0);
  normalized[maxIdx].amount += remainder;
  
  return normalized;
}
```

**Lesson:** Floating point arithmetic in financial calculations always needs explicit rounding. Never compare floats with `===`. Always verify that split amounts sum exactly to the expense total.

---

### Case 4 — Parallel writes inside Prisma transactions caused database lockups

**What Claude produced:**

```js
// Initial optimized attempt: run all insertions concurrently
const importPromises = resolvedRows.map(async (row) => {
  const expense = await tx.expense.create({ ... });
  await tx.expenseSplit.createMany({ ... });
});
await Promise.all(importPromises);
```

**Why it was wrong:** Sending 80+ concurrent database operations concurrently over a single interactive Prisma transaction connection exhausts the connection pool or overloads the Prisma transaction proxy engine, causing it to hang indefinitely or time out.

**How I caught it:** Running the integration script verify-importer.js failed on the finalize step with a database transaction expiration error (`P2028: transaction expired after 30 seconds`).

**What I changed:** We pre-resolved all unique guest and member names sequentially to construct the `memberMap` before starting the expense insertions, and then ran the actual inserts sequentially (`for...of` loop). We also increased the Prisma transaction timeout config to `90` seconds (`90000ms`).

**Lesson:** Do not run too many parallel queries concurrently inside a single interactive Prisma transaction. Instead, run lookups ahead of time, do the insertions sequentially, and set a high timeout threshold to accommodate cloud database latency.

---

### Case 5 — Custom DNS overrides and database pooler Transaction Mode broke group creation

**What Claude produced:**
Forcing the application to use Google DNS (`8.8.8.8`) at runtime via `dns.setServers(['8.8.8.8', '8.8.4.4'])` to work around local DNS server lookup failures.

**Why it was wrong:**
1. Hardcoding external DNS servers blocks DNS resolution completely on networks where external DNS queries (port 53) are firewalled or blocked.
2. In trying to bypass the resulting lookup failures, pointing `DIRECT_URL` to a Neon PgBouncer pooler host failed because PgBouncer in **Transaction Mode** does not support Prisma's multi-statement interactive transactions (`prisma.$transaction(...)`), throwing `P2028: Unable to start a transaction in the given time`.

**How I caught it:**
When users tried to create a group, the request returned a `500 Internal Server Error` due to a transaction timeout. Checking the backend logs showed the transaction start failures. Running DNS lookup tests manually showed that the direct Neon host resolved perfectly when using the default system DNS but failed when Google DNS was forced.

**What I changed:**
Removed the `dns.setServers` override from the application code ([index.js](file:///c:/Users/hp/Desktop/Spreetree/backend/src/index.js), [test-db.js](file:///c:/Users/hp/Desktop/Spreetree/backend/test-db.js), [verify-importer.js](file:///c:/Users/hp/Desktop/Spreetree/backend/verify-importer.js)), letting it default to the host system DNS. Reverted `DIRECT_URL` in [.env](file:///c:/Users/hp/Desktop/Spreetree/backend/.env) to point to the direct (non-pooler) host to support transactions correctly.

**Lesson:**
Do not enforce custom network/DNS configurations at the application level as it reduces code portability and compatibility. Use direct connections for transactional databases and keep pooler connections for read-heavy operations, as PgBouncer Transaction Mode has strict limitations on interactive transactions.

---

### Case 6 — Member Invitation Flow & Guest Profile Separation

**What Claude produced:**
Automatically creating guest user profiles when adding a member by email, which locked those emails from registering for real accounts later due to unique email database constraints.

**Why it was wrong:**
Inviting a user by email created a database user record with `isGuest: true` and a blank password. Because email is a unique field, the new member could never register their own account with that email, nor could they log in since guest users cannot have passwords.

**How I caught it:**
Analyzing the schema unique constraints and the `/auth/register` route code showed that a 400 error was returned if the email already existed in the DB, regardless of whether it belonged to a guest or a registered user.

**What I changed:**
1. Modified the `/api/groups/:id/members` route ([`backend/src/routes/groups.js`](file:///c:/Users/hp/Desktop/Spreetree/backend/src/routes/groups.js)) to verify if the invited email exists. If it exists, the user is added; if not, it returns a 404 error prompting the inviter to share the website link for the user to register first.
2. Updated the frontend modal ([`frontend/src/pages/GroupDashboard.jsx`](file:///c:/Users/hp/Desktop/Spreetree/frontend/src/pages/GroupDashboard.jsx)) to render this warning directly inside the modal.
3. Updated automated test scripts ([`verify-endpoints.js`](file:///c:/Users/hp/Desktop/Spreetree/backend/verify-endpoints.js) and [`verify-importer.js`](file:///c:/Users/hp/Desktop/Spreetree/backend/verify-importer.js)) to register users sequentially before inviting them.

**Lesson:**
Consider registration constraints and database collisions early when designing invitation loops. Require users to have registered accounts before they can be added to workspaces or groups via email, or use an upgrade/claiming system, rather than creating passive guest accounts using standard email fields.

---

## General Observations

- Claude is reliable for boilerplate, schema structure, and explaining concepts
- Claude's knowledge of rapidly-changing tools (Prisma 7, Neon adapter) can be outdated — always verify against current docs
- Claude never catches domain-specific errors (like a balance formula that's logically wrong for this specific app) — those require manual verification
- The most useful prompts were specific and gave Claude the actual data to work with, not abstract descriptions
