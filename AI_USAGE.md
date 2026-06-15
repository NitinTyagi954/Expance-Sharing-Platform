# AI_USAGE.md — AI Tool Usage Log

I used **Claude (Sonnet 4.6)** as a pairing partner on this project. This log documents how we worked together, the prompts I used, and most importantly, the cases where Claude made mistakes, how I caught them, and what I had to change to fix them.

---

## My Workflow with Claude

I didn't treat Claude as a magic button to write the whole app. Instead, I used it to bounce ideas around, draft the initial database schema, and write boilerplate code. The workflow was:
1. Explain the feature or data requirement.
2. Ask Claude to suggest an approach or algorithm.
3. Review the code against the CSV data.
4. Catch logic bugs or outdated API usage.
5. Edit and test the code locally.

---

## Key Prompts I Used

* **Finding Data Problems:**
  > "I have a CSV file with shared flatmate expenses. Read the raw text and find every data problem, typo, date inconsistency, or logical issue you can spot. Do not write any code yet."
* **Designing the Prisma Schema:**
  > "Design a Prisma schema for a shared expenses app. I need to track group membership ranges because one flatmate left at the end of March and another joined in mid-April. Their join/leave dates must affect which expenses they owe money for."
* **Building the Anomaly Detector:**
  > "Write a Node.js parser that flags potential duplicate rows in a CSV. Two rows are duplicates if they share the same date, amount, and similar descriptions. Return an array of anomaly objects detailing the row number and a suggested action."
* **Simplifying Debts:**
  > "Explain how to implement a greedy debt simplification algorithm in Javascript. The input is a list of user net balances. The output should be a minimal list of direct payments between members."

---

## 7 Cases Where Claude Got It Wrong

Working with Claude requires constant vigilance. Here are seven bugs it introduced during development, how I caught them, and how I fixed them.

### Case 1: The Incorrect Balance Calculation Formula

* **What Claude suggested:**
  ```js
  const balance = await prisma.expenseSplit.groupBy({
    by: ['userId'],
    _sum: { amount: true }
  });
  ```
* **Why it was wrong:** This query only sums the amount a user *owes* across splits. It completely ignores what the user *paid*. For example, if Rohan paid ₹5000 for groceries and owed ₹1000 for his share, his net balance should be `+₹4000` (he is owed money). Claude's query would return `-₹1000`, making it look like he owes money.
* **How I caught it:** I calculated Rohan's net balance by hand for the first few rows of the CSV. When I ran Claude's query, the output was negative when it should have been positive.
* **How I fixed it:** I separated the queries. I queried the `Expense` table to sum the total payments made by each user, queried the `ExpenseSplit` table to sum the total debt owed, and then subtracted the two to get the net balance:
  ```js
  const totalPaid = await prisma.expense.groupBy({
    by: ['paidById'],
    _sum: { amountInINR: true }
  });

  const totalOwed = await prisma.expenseSplit.groupBy({
    by: ['userId'],
    _sum: { amount: true }
  });
  ```

---

### Case 2: Outdated Prisma 7 Schema Config

* **What Claude suggested:**
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
    directUrl = env("DIRECT_URL")
  }
  ```
* **Why it was wrong:** This is the older setup pattern for Prisma 5/6. In Prisma 7, connection URLs are handled differently if you use poolers. Defining `directUrl` in `schema.prisma` threw validation errors during migration runs.
* **How I caught it:** Running `npx prisma migrate dev` returned a syntax/validation error on the schema file.
* **How I fixed it:** I read the Prisma 7 migration docs. I set up a dedicated `prisma.config.ts` file to handle the PG driver adapter (`@prisma/adapter-pg`) and database connection configurations, removing direct URL parameters from the main schema file.

---

### Case 3: Floating-Point Rounding Failures in Split Math

* **What Claude suggested:**
  ```js
  function splitEqual(amount, participants) {
    const share = amount / participants.length;
    return participants.map(p => ({ userId: p, amount: share }));
  }
  ```
* **Why it was wrong:** Dividing ₹1199 by 4 results in ₹299.75. That works. But dividing ₹1440 by 7 results in `205.7142857...` per person. In JavaScript, floating-point math causes precision issues. Summing those shares results in `1439.999999...`, which doesn't equal the total expense of ₹1440, violating database integrity constraints.
* **How I caught it:** I wrote a test script (`test-splits.js`) to verify that the sum of splits matches the total amount. The comparison `splitSum === expenseTotal` failed.
* **How I fixed it:** I added explicit rounding to two decimal places for everyone, tracked the difference, and assigned the remaining paise to the member with the largest share:
  ```js
  const roundedShare = Math.floor((amount / participants.length) * 100) / 100;
  const distributedAmount = roundedShare * participants.length;
  const remainder = Math.round((amount - distributedAmount) * 100) / 100;

  // Add the remainder (in paise) to the first split to balance the transaction
  splits[0].amount += remainder;
  ```

---

### Case 4: Connection Pool Exhaustion from Parallel Writes

* **What Claude suggested:**
  ```js
  // Commit all staging rows in parallel inside the Prisma transaction
  const promises = rows.map(row => tx.expense.create({ data: row }));
  await Promise.all(promises);
  ```
* **Why it was wrong:** Running 40+ concurrent inserts inside a single database transaction exhausts Neon's serverless connection pool. The database proxy queued the requests, causing Prisma to throw a transaction timeout error.
* **How I caught it:** Running the integration test threw `P2028: Transaction expired after 30 seconds`.
* **How I fixed it:** I changed the parallel execution to run sequentially inside a loop. I also set the transaction timeout threshold to 90 seconds to handle network latency:
  ```js
  for (const row of rows) {
    await tx.expense.create({ data: row });
  }
  ```

---

### Case 5: Custom DNS Override Broke Local Connections

* **What Claude suggested:**
  ```js
  // Force Node.js to use Google DNS to resolve connection issues
  import dns from 'dns';
  dns.setServers(['8.8.8.8']);
  ```
* **Why it was wrong:** Hardcoding external DNS resolution at the application layer is highly fragile. In local developer environments where port 53 (DNS) queries to external IPs like `8.8.8.8` are firewalled, it broke database name resolution completely.
* **How I caught it:** Running the app on my local network threw `ENOTFOUND` database errors immediately, even though the database URL was correct.
* **How I fixed it:** I removed the custom DNS logic and let the node process default to the operating system's DNS resolver.

---

### Case 6: Guest Profile Creation Colliding with Real Accounts

* **What Claude suggested:**
  Creating a full user record with a blank password hash whenever a guest was added via email invitation.
* **Why it was wrong:** Since email is a unique field in the User model, creating a guest record containing an email address blocked that person from registering a real account later. The registration endpoint would return a "Email already in use" error, even though the guest profile had no password or login credentials.
* **How I caught it:** I simulated inviting a user by email, and then tried to sign up with that same email. The signup request was rejected with a 400 error.
* **How I fixed it:** I restricted the email invitation flow to existing registered users. For unregistered guests (like Kabir), the system creates guest profiles by name only (leaving the email field empty), preventing unique key collisions.

---

### Case 7: System Timezone Offset Shifting Date Fields

* **What Claude suggested:**
  ```js
  new Date(membership.leftAt).toLocaleDateString()
  ```
* **Why it was wrong:** Stored dates are saved as UTC timestamps (e.g., Meera's exit date is `2026-03-31T23:59:59.000Z`). When rendering this UTC string in the browser using the browser's local timezone (e.g., India Standard Time, +5:30), the time shifts forward to April 1st, 5:29 AM. The UI showed Meera's exit date as `4/1/2026` instead of `3/31/2026`.
* **How I caught it:** I set a user's exit date to March 31st, but the dashboard membership table listed it as April 1st.
* **How I fixed it:** I replaced the local date formatting call with a custom helper that extracts the UTC year, month, and day components directly:
  ```js
  function formatUTCDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  }
  ```

---

## Key Takeaways

1. **AI is bad at domain logic:** Claude wrote the split calculations and balance aggregation logic quickly, but missed the business rules (such as net balance direction and exact float ledger balancing).
2. **Beware of outdated library patterns:** Claude frequently suggested patterns that worked in Prisma 5 or 6, but failed in Prisma 7 due to API changes.
3. **Verify every transaction:** Wrapping database writes in transactions requires careful connection and concurrency management. Parallelism inside interactive transactions is a recipe for connection timeouts.
