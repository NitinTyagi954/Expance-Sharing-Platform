const API_URL = 'http://localhost:5000/api';

async function runVerification() {
  console.log('Starting Balance Engine & Settlements Integration Verification...\n');
  const timestamp = Date.now();
  const testEmail = `rohan-${timestamp}@example.com`;
  const testPassword = 'Password123';
  const testName = 'Rohan';

  let token = '';
  let rohanId = '';
  let aishaId = '';
  let priyaId = '';
  let groupId = '';

  try {
    // 1. Test Registration for Rohan
    console.log('1. Registering Rohan...');
    const regRohan = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
    });
    const regRohanData = await regRohan.json();
    if (regRohan.status !== 201) {
      throw new Error(`Registration failed (status ${regRohan.status}): ${JSON.stringify(regRohanData)}`);
    }
    token = regRohanData.token;
    rohanId = regRohanData.user.id;
    console.log(`✅ Rohan registered! ID: ${rohanId}`);

    // 2. Create group with backdated joinedAt (2026-02-01)
    console.log('\n2. Creating Group (Flat 4B) backdated to Feb 1st...');
    const groupRes = await fetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Flat 4B',
        description: 'Co-living shared flat',
        joinedAt: '2026-02-01T00:00:00.000Z'
      }),
    });
    const groupData = await groupRes.json();
    groupId = groupData.id;
    console.log(`✅ Group created! ID: ${groupId}`);

    // 3. Add Aisha (joined 2026-02-01)
    console.log('\n3. Adding Aisha to the group (joined Feb 1st)...');
    const aishaRes = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Aisha',
        email: `aisha-${timestamp}@example.com`,
        joinedAt: '2026-02-01T00:00:00.000Z'
      }),
    });
    const aishaData = await aishaRes.json();
    aishaId = aishaData.userId;
    console.log(`✅ Aisha added! ID: ${aishaId}`);

    // 4. Add Priya (joined 2026-02-01)
    console.log('\n4. Adding Priya to the group (joined Feb 1st)...');
    const priyaRes = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Priya',
        email: `priya-${timestamp}@example.com`,
        joinedAt: '2026-02-01T00:00:00.000Z'
      }),
    });
    const priyaData = await priyaRes.json();
    priyaId = priyaData.userId;
    console.log(`✅ Priya added! ID: ${priyaId}`);

    // 5. Add Expense: Rohan paid WiFi bill (₹1199) split EQUAL among all three
    console.log('\n5. Creating Expense: Rohan paid WiFi bill (1199 INR)...');
    const expWiFi = await fetch(`${API_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId,
        description: 'WiFi bill',
        amount: 1199.00,
        currency: 'INR',
        exchangeRate: 1.0,
        date: '2026-02-10T12:00:00.000Z',
        paidById: rohanId,
        splitType: 'EQUAL',
        splits: [rohanId, aishaId, priyaId]
      }),
    });
    if (expWiFi.status !== 201) {
      throw new Error(`WiFi bill expense creation failed: ${await expWiFi.text()}`);
    }
    console.log('✅ WiFi bill created.');

    // 6. Add Expense: Rohan paid Birthday Cake (₹1500) split EQUAL among all three
    console.log('\n6. Creating Expense: Rohan paid Birthday Cake (1500 INR)...');
    const expCake = await fetch(`${API_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId,
        description: 'Birthday Cake',
        amount: 1500.00,
        currency: 'INR',
        exchangeRate: 1.0,
        date: '2026-02-20T12:00:00.000Z',
        paidById: rohanId,
        splitType: 'EQUAL',
        splits: [rohanId, aishaId, priyaId]
      }),
    });
    if (expCake.status !== 201) {
      throw new Error(`Cake expense creation failed: ${await expCake.text()}`);
    }
    console.log('✅ Birthday Cake expense created.');

    // 7. Verify Balances - Step 8 Core Math
    console.log('\n7. Verifying Balances (Step 8 Math Verification)...');
    const balRes = await fetch(`${API_URL}/groups/${groupId}/balances`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const balData = await balRes.json();
    
    // Hand Walkthrough Validation:
    // Rohan paid: 1199 + 1500 = 2699
    // WiFi split: Rohan 399.68, Aisha 399.66, Priya 399.66
    // Cake split: Rohan 500, Aisha 500, Priya 500
    // Rohan owes: 399.68 + 500 = 899.68. Rohan Net = 2699 - 899.68 = +1799.32
    // Aisha owes: 399.66 + 500 = 899.66. Aisha Net = 0 - 899.66 = -899.66
    // Priya owes: 399.66 + 500 = 899.66. Priya Net = 0 - 899.66 = -899.66
    
    const rohanBal = balData.members.find(m => m.userId === rohanId);
    const aishaBal = balData.members.find(m => m.userId === aishaId);
    const priyaBal = balData.members.find(m => m.userId === priyaId);

    console.log(`   Rohan: Paid=${rohanBal.totalPaid}, Owed=${rohanBal.totalOwed}, Net=${rohanBal.netBalance}`);
    console.log(`   Aisha: Paid=${aishaBal.totalPaid}, Owed=${aishaBal.totalOwed}, Net=${aishaBal.netBalance}`);
    console.log(`   Priya: Paid=${priyaBal.totalPaid}, Owed=${priyaBal.totalOwed}, Net=${priyaBal.netBalance}`);

    if (rohanBal.netBalance !== 1799.32) {
      throw new Error(`Rohan net balance (${rohanBal.netBalance}) does not match expected 1799.32`);
    }
    if (aishaBal.netBalance !== -899.66) {
      throw new Error(`Aisha net balance (${aishaBal.netBalance}) does not match expected -899.66`);
    }
    if (priyaBal.netBalance !== -899.66) {
      throw new Error(`Priya net balance (${priyaBal.netBalance}) does not match expected -899.66`);
    }
    console.log('✅ Core balance math matches paper walkthrough perfectly!');

    // Settle-up transfers verification (Aisha's rule)
    console.log('\n   Verifying Debt Simplification suggestions:');
    console.log(`   Suggested transfers: ${JSON.stringify(balData.suggestedSettlements)}`);
    const tAisha = balData.suggestedSettlements.find(s => s.from === aishaId && s.to === rohanId);
    const tPriya = balData.suggestedSettlements.find(s => s.from === priyaId && s.to === rohanId);
    
    if (!tAisha || tAisha.amount !== 899.66) {
      throw new Error('Simplified debt transfer missing or incorrect amount for Aisha');
    }
    if (!tPriya || tPriya.amount !== 899.66) {
      throw new Error('Simplified debt transfer missing or incorrect amount for Priya');
    }
    console.log('✅ Simplified settle-up suggestions verified!');

    // 8. Record a Settlement: Aisha pays Rohan 500 INR
    console.log('\n8. Recording a Settlement: Aisha pays Rohan 500 INR...');
    const setRes = await fetch(`${API_URL}/settlements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId,
        paidById: aishaId,
        receivedById: rohanId,
        amount: 500.00,
        date: '2026-02-25T12:00:00.000Z',
        notes: 'Partial settlement for WiFi and Cake'
      }),
    });
    const setData = await setRes.json();
    if (setRes.status !== 201) {
      throw new Error(`Recording settlement failed: ${JSON.stringify(setData)}`);
    }
    console.log('✅ Settlement successfully recorded!');

    // 9. Re-verify Balances - Step 9 verification
    console.log('\n9. Re-verifying Balances (Step 9 Math Verification)...');
    const bal2Res = await fetch(`${API_URL}/groups/${groupId}/balances`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const bal2Data = await bal2Res.json();

    const rohanBal2 = bal2Data.members.find(m => m.userId === rohanId);
    const aishaBal2 = bal2Data.members.find(m => m.userId === aishaId);
    
    console.log(`   Rohan: Paid=${rohanBal2.totalPaid}, Owed=${rohanBal2.totalOwed}, SentSet=${rohanBal2.totalSentSettlements}, RecvSet=${rohanBal2.totalReceivedSettlements}, Net=${rohanBal2.netBalance}`);
    console.log(`   Aisha: Paid=${aishaBal2.totalPaid}, Owed=${aishaBal2.totalOwed}, SentSet=${aishaBal2.totalSentSettlements}, RecvSet=${aishaBal2.totalReceivedSettlements}, Net=${aishaBal2.netBalance}`);

    // Expecting:
    // Rohan Net = 1799.32 - 500 = +1299.32
    // Aisha Net = -899.66 + 500 = -399.66
    if (rohanBal2.netBalance !== 1299.32) {
      throw new Error(`Rohan updated net balance (${rohanBal2.netBalance}) does not match expected 1299.32`);
    }
    if (aishaBal2.netBalance !== -399.66) {
      throw new Error(`Aisha updated net balance (${aishaBal2.netBalance}) does not match expected -399.66`);
    }
    console.log('✅ Settlement successfully reduced outstanding balances!');

    console.log('\n⭐ Balance Calculation Engine and Settlements verified successfully!');
  } catch (err) {
    console.error('\n❌ Balance/Settlement verification failed:', err.message);
    process.exit(1);
  }
}

runVerification();
