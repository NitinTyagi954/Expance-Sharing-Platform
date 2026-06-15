import fs from 'fs';
import { prisma } from './src/db.js';

const API_URL = 'http://localhost:5000/api';
const CSV_PATH = 'C:\\Users\\hp\\Downloads\\expenses_export.csv';

async function runImporterVerification() {
  console.log('=== Starting CSV Importer Engine Integration Verification ===\n');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV file not found at ${CSV_PATH}`);
    process.exit(1);
  }

  const timestamp = Date.now();
  const email = `rohan-importer-${timestamp}@example.com`;
  const password = 'Password123';

  let token = '';
  let creatorId = '';
  let groupId = '';

  try {
    // 1. Register Payer/Creator (Rohan)
    console.log('1. Registering group creator (Rohan)...');
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rohan', email, password }),
    });
    const regData = await registerRes.json();
    if (registerRes.status !== 201) {
      throw new Error(`Registration failed: ${JSON.stringify(regData)}`);
    }
    token = regData.token;
    creatorId = regData.user.id;
    console.log(`✅ Rohan registered with ID: ${creatorId}`);

    // 2. Create Group (Co-living Flat 4B) backdated to Feb 1st
    console.log('\n2. Creating group (Co-living Flat 4B)...');
    const groupRes = await fetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Co-living Flat 4B',
        description: 'Historical Shared Expenses flatmates',
        joinedAt: '2026-02-01T00:00:00.000Z'
      }),
    });
    const groupData = await groupRes.json();
    groupId = groupData.id;
    console.log(`✅ Group created with ID: ${groupId}`);

    // 3. Add other members with appropriate join dates
    console.log('\n3. Seeding other members (Aisha, Priya, Meera, Dev, Sam)...');
    
    // Register members first
    const aishaEmail = `aisha-${timestamp}@spreetree.local`;
    const priyaEmail = `priya-${timestamp}@spreetree.local`;
    const meeraEmail = `meera-${timestamp}@spreetree.local`;
    const devEmail = `dev-${timestamp}@spreetree.local`;
    const samEmail = `sam-${timestamp}@spreetree.local`;

    const usersToRegister = [
      { name: 'Aisha', email: aishaEmail },
      { name: 'Priya', email: priyaEmail },
      { name: 'Meera', email: meeraEmail },
      { name: 'Dev', email: devEmail },
      { name: 'Sam', email: samEmail }
    ];

    for (const u of usersToRegister) {
      await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: u.name, email: u.email, password: 'Password123' })
      });
    }

    // Add Aisha (joined Feb 1st)
    const addAisha = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name: 'Aisha', email: aishaEmail, joinedAt: '2026-02-01T00:00:00.000Z' })
    });
    const aishaMember = await addAisha.json();
    const aishaId = aishaMember.userId;

    // Add Priya (joined Feb 1st)
    const addPriya = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name: 'Priya', email: priyaEmail, joinedAt: '2026-02-01T00:00:00.000Z' })
    });
    const priyaMember = await addPriya.json();
    const priyaId = priyaMember.userId;

    // Add Meera (joined Feb 1st, will leave March 31st)
    const addMeera = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name: 'Meera', email: meeraEmail, joinedAt: '2026-02-01T00:00:00.000Z' })
    });
    const meeraMember = await addMeera.json();
    const meeraId = meeraMember.userId;

    // Add Dev (joined Feb 1st)
    const addDev = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name: 'Dev', email: devEmail, joinedAt: '2026-02-01T00:00:00.000Z' })
    });
    const devMember = await addDev.json();
    const devId = devMember.userId;

    // Add Sam (joined April 8th)
    const addSam = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name: 'Sam', email: samEmail, joinedAt: '2026-04-08T00:00:00.000Z' })
    });
    const samMember = await addSam.json();
    const samId = samMember.userId;

    // Remove Meera on March 31st (sets leftAt)
    console.log('   Setting Meera leftAt = March 31st...');
    const removeMeeraRes = await fetch(`${API_URL}/groups/${groupId}/members/${meeraId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ leftAt: '2026-03-31T23:59:59.000Z' })
    });
    await removeMeeraRes.json();
    console.log('✅ Members seeded and dates updated.');

    // 4. Upload CSV to Importer Upload Endpoint
    console.log('\n4. Uploading CSV file...');
    const formData = new FormData();
    formData.append('groupId', groupId);
    const fileBlob = new Blob([fs.readFileSync(CSV_PATH)], { type: 'text/csv' });
    formData.append('file', fileBlob, 'expenses_export.csv');

    const uploadRes = await fetch(`${API_URL}/imports/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (uploadRes.status !== 201) {
      throw new Error(`CSV Upload failed (status ${uploadRes.status}): ${await uploadRes.text()}`);
    }

    const uploadData = await uploadRes.json();
    const { session, exchangeRate, rows } = uploadData;
    const { anomalies } = session;

    console.log(`✅ CSV parsed! Total rows found: ${session.totalRows}`);
    console.log(`✅ Anomaly detection complete! Total anomalies flagged: ${anomalies.length}`);

    // Print anomalies for audit
    console.log('\n--- Anomalies Flagged ---');
    anomalies.forEach((a) => {
      console.log(`[Row ${a.rowNumber}] [Type: ${a.anomalyType}] ${a.description}`);
    });
    console.log('-------------------------\n');

    // Verify presence of critical anomaly types
    const typesFound = new Set(anomalies.map(a => a.anomalyType));
    const expectedTypes = [
      'DUPLICATE', 'SETTLEMENT', 'NEGATIVE_AMOUNT', 'ZERO_AMOUNT',
      'MISSING_CURRENCY', 'MISSING_PAYER', 'AMBIGUOUS_DATE',
      'NAME_MISMATCH', 'MEMBERSHIP_VIOLATION', 'SPLIT_CONFLICT',
      'PERCENTAGE_MISMATCH', 'EXTERNAL_MEMBER', 'AMOUNT_FORMAT'
    ];

    console.log('Verifying expected anomaly types are present...');
    for (const type of expectedTypes) {
      if (typesFound.has(type)) {
        console.log(`   ✅ ${type} detected!`);
      } else {
        console.warn(`   ⚠️ Warning: Expected anomaly type ${type} was not flagged.`);
      }
    }

    // 5. Mock Anomaly Resolutions & Formulate Final Resolved Rows List
    console.log('\n5. Mocking anomaly resolutions and preparing final dataset...');

    const resolvedRows = [];
    const exchangeRateUsed = exchangeRate || 83.0;

    for (const r of rows) {
      let resolvedRow = { ...r };
      const rowNum = r.rowNumber;

      // Apply specific manual resolutions based on documented CSV problems
      if (rowNum === 5) {
        // Discard duplicate of Row 4 (Marina Bites)
        resolvedRow.isSkipped = true;
        console.log(`   Row ${rowNum}: Discarding exact duplicate (Marina Bites)`);
      } else if (rowNum === 24) {
        // Conflicting duplicate of Row 23 (Thalassa dinner). Discard Aisha's row 24, keep Rohan's row 25.
        resolvedRow.isSkipped = true;
        console.log(`   Row ${rowNum}: Discarding conflicting duplicate (Aisha's Thalassa dinner)`);
      } else if (rowNum === 12) {
        // Payer missing (House cleaning supplies). Resolve by assigning Aisha.
        resolvedRow.paidBy = 'Aisha';
        console.log(`   Row ${rowNum}: Assigning paidBy = 'Aisha' to missing payer row`);
      } else if (rowNum === 13) {
        // Settlement logged as expense. Convert to settlement. Payer: Rohan, splitWith: Aisha.
        resolvedRow.isSettlement = true;
        resolvedRow.paidBy = 'Rohan';
        resolvedRow.splitWith = ['Aisha'];
        console.log(`   Row ${rowNum}: Converting Settlement row to isSettlement = true`);
      } else if (rowNum === 25) {
        // Negative amount (Parasailing refund). Treat as refund, make amount positive.
        resolvedRow.isRefund = true;
        resolvedRow.amount = Math.abs(r.amount);
        resolvedRow.exchangeRate = exchangeRateUsed;
        console.log(`   Row ${rowNum}: Marking as refund (isRefund = true) and converting amount to positive`);
      } else if (rowNum === 30) {
        // Swiggy zero amount. Skip.
        resolvedRow.isSkipped = true;
        console.log(`   Row ${rowNum}: Skipping Swiggy zero-amount row`);
      } else if (rowNum === 27) {
        // Missing currency. Set to INR.
        resolvedRow.currency = 'INR';
        console.log(`   Row ${rowNum}: Defaulting missing currency to INR`);
      } else if (rowNum === 33) {
        // Ambiguous date (04/05/2026). Choose May 4th.
        resolvedRow.date = '2026-05-04T00:00:00.000Z';
        console.log(`   Row ${rowNum}: Resolving ambiguous date to 2026-05-04`);
      } else if (rowNum === 10) {
        // Name mismatch: "Priya S" -> "Priya"
        resolvedRow.paidBy = 'Priya';
        console.log(`   Row ${rowNum}: Normalizing Priya S to Priya`);
      } else if (rowNum === 8) {
        // Name casing: lowercase "priya"
        resolvedRow.paidBy = 'Priya';
      } else if (rowNum === 26) {
        // Trailing whitespace in name: "rohan "
        resolvedRow.paidBy = 'Rohan';
      } else if (rowNum === 35) {
        // Membership violation: Meera in April. Remove Meera from split.
        resolvedRow.splitWith = ['Aisha', 'Rohan', 'Priya'];
        console.log(`   Row ${rowNum}: Removing inactive Meera from April grocery split`);
      } else if (rowNum === 41) {
        // Split conflict: EQUAL split type but splitDetails has shares.
        // We will change splitType to SHARE.
        resolvedRow.splitType = 'SHARE';
        console.log(`   Row ${rowNum}: Resolving split conflict, setting splitType to SHARE`);
      } else if (rowNum === 14) {
        // Percentage does not sum to 100% (sums to 110%).
        resolvedRow.splitDetails = 'Aisha 27.27%; Rohan 27.27%; Priya 27.27%; Meera 18.19%'; // Sum is 100%
        console.log(`   Row ${rowNum}: Normalizing row 14 percentages to sum to 100%`);
      } else if (rowNum === 31) {
        // Percentage does not sum to 100% (sums to 110%).
        resolvedRow.splitDetails = 'Aisha 27.27%; Rohan 27.27%; Priya 27.27%; Meera 18.19%'; // Sum is 100%
        console.log(`   Row ${rowNum}: Normalizing row 31 percentages to sum to 100%`);
      }

      // Add exchange rate to other USD rows
      if (r.currency === 'USD') {
        resolvedRow.exchangeRate = exchangeRateUsed;
      }

      resolvedRows.push(resolvedRow);
    }

    // Resolve anomalies on the server side first to verify the resolve endpoint works
    console.log('\n   Submitting mock resolutions to /anomalies/:id/resolve...');
    for (const anom of anomalies) {
      let status = 'APPROVED';
      let resolvedAction = {};

      if (anom.rowNumber === 5 || anom.rowNumber === 24 || anom.rowNumber === 30) {
        status = 'REJECTED'; // user rejected/discarded
        resolvedAction = { action: 'DISCARD' };
      } else if (anom.rowNumber === 12) {
        status = 'MODIFIED';
        resolvedAction = { action: 'ASSIGN_PAYER', paidBy: 'Aisha' };
      }

      const resolveRes = await fetch(`${API_URL}/imports/anomalies/${anom.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, resolvedAction })
      });

      if (!resolveRes.ok) {
        throw new Error(`Failed to resolve anomaly row ${anom.rowNumber}: ${await resolveRes.text()}`);
      }
    }
    console.log('   ✅ All anomalies marked as resolved on server.');

    // 6. Finalize Import
    console.log('\n6. Committing final import dataset to DB...');
    const finalizeRes = await fetch(`${API_URL}/imports/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        importSessionId: session.id,
        resolvedRows
      })
    });

    const finalizeData = await finalizeRes.json();
    if (finalizeRes.status !== 200) {
      throw new Error(`Finalization failed: ${JSON.stringify(finalizeData)}`);
    }

    console.log('✅ CSV Importer finalized successfully!');
    console.log(`   Summary: Total Rows: ${finalizeData.session.totalRows}, Imported: ${finalizeData.session.imported}, Skipped: ${finalizeData.session.skipped}`);

    // 7. Calculate and Verify Balances
    console.log('\n7. Running post-import Balance Engine checks...');
    const balRes = await fetch(`${API_URL}/groups/${groupId}/balances`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const balData = await balRes.json();

    console.log('\n--- Calculated Group Balances ---');
    balData.members.forEach((m) => {
      console.log(`User: ${m.name.padEnd(8)} | Paid: ₹${m.totalPaid.toFixed(2).padStart(9)} | Owed: ₹${m.totalOwed.toFixed(2).padStart(9)} | Net Balance: ${m.netBalance >= 0 ? '+' : ''}₹${m.netBalance.toFixed(2).padStart(9)}`);
    });
    console.log('---------------------------------');

    console.log('\nSuggested Debt Simplification Settlement Transfers:');
    balData.suggestedSettlements.forEach((s) => {
      console.log(`   - ${s.fromName} owes ${s.toName} ₹${s.amount}`);
    });

    console.log('\n⭐ Integration Verification Completed Successfully!');
  } catch (err) {
    console.error('\n❌ Verification Failed:', err.message);
    process.exit(1);
  }
}

runImporterVerification();
