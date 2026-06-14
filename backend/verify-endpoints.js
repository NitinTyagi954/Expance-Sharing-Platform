const API_URL = 'http://localhost:5000/api';

async function runVerification() {
  console.log('Starting End-to-End API Integration Verification...\n');
  const timestamp = Date.now();
  const testEmail = `testuser-${timestamp}@example.com`;
  const testPassword = 'Password123';
  const testName = 'Test User';

  let token = '';
  let userId = '';
  let groupId = '';
  let memberId = '';

  try {
    // 1. Test Registration
    console.log('1. Testing User Registration...');
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
    });
    const registerData = await registerRes.json();
    if (registerRes.status !== 201) {
      throw new Error(`Registration failed: ${JSON.stringify(registerData)}`);
    }
    console.log('✅ Registration successful!');
    token = registerData.token;
    userId = registerData.user.id;

    // 2. Test Login
    console.log('\n2. Testing User Login...');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginData = await loginRes.json();
    if (loginRes.status !== 200) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    console.log('✅ Login successful! Token received.');

    // 3. Test Group Creation
    console.log('\n3. Testing Group Creation...');
    const groupRes = await fetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'E2E Test Group',
        description: 'Integration testing group',
        joinedAt: '2026-02-01T00:00:00.000Z'
      }),
    });
    const groupData = await groupRes.json();
    if (groupRes.status !== 201) {
      throw new Error(`Group creation failed: ${JSON.stringify(groupData)}`);
    }
    console.log(`✅ Group created successfully! ID: ${groupData.id}`);
    groupId = groupData.id;

    // 4. Test Adding a Member with Date (Priya, joined March 1st)
    console.log('\n4. Testing Adding a Member (Priya, joined 2026-03-01)...');
    const memberRes = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Priya',
        email: `priya-${timestamp}@example.com`,
        joinedAt: '2026-03-01T00:00:00.000Z'
      }),
    });
    const memberData = await memberRes.json();
    if (memberRes.status !== 201) {
      throw new Error(`Adding member failed: ${JSON.stringify(memberData)}`);
    }
    console.log(`✅ Member added successfully! ID: ${memberData.userId}`);
    memberId = memberData.userId;

    // 5. Test Adding another Member with Date (Sam, joined 2026-04-15)
    console.log('\n5. Testing Adding another Member (Sam, joined 2026-04-15)...');
    const samRes = await fetch(`${API_URL}/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Sam',
        email: `sam-${timestamp}@example.com`,
        joinedAt: '2026-04-15T00:00:00.000Z'
      }),
    });
    const samData = await samRes.json();
    if (samRes.status !== 201) {
      throw new Error(`Adding Sam failed: ${JSON.stringify(samData)}`);
    }
    console.log(`✅ Sam added successfully! ID: ${samData.userId}`);
    const samId = samData.userId;

    // 6. Test Valid Expense (March 15: split between Creator and Priya)
    console.log('\n6. Testing Valid Expense on 2026-03-15 (Priya active, Sam inactive)...');
    const expValidRes = await fetch(`${API_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId,
        description: 'March Internet bill',
        amount: 1200.00,
        currency: 'INR',
        exchangeRate: 1.0,
        date: '2026-03-15T12:00:00.000Z',
        paidById: userId,
        splitType: 'EQUAL',
        splits: [userId, memberId] // Creator and Priya
      }),
    });
    const expValidData = await expValidRes.json();
    if (expValidRes.status !== 201) {
      throw new Error(`Valid expense failed: ${JSON.stringify(expValidData)}`);
    }
    console.log(`✅ Valid expense created! Splits sum: ${expValidData.splits.reduce((s, x) => s + x.amount, 0)}`);

    // 7. Test Invalid Expense (March 15: split including Sam who joined April 15)
    console.log('\n7. Testing Invalid Expense (charging Sam for 2026-03-15)...');
    const expInvalidRes = await fetch(`${API_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId,
        description: 'March Internet with Sam',
        amount: 1200.00,
        currency: 'INR',
        exchangeRate: 1.0,
        date: '2026-03-15T12:00:00.000Z',
        paidById: userId,
        splitType: 'EQUAL',
        splits: [userId, memberId, samId] // Includes Sam (inactive on this date)
      }),
    });
    const expInvalidData = await expInvalidRes.json();
    if (expInvalidRes.status === 400) {
      console.log(`✅ Correctly blocked! Received expected 400 error: "${expInvalidData.error}"`);
    } else {
      throw new Error(`Expense should have failed, but succeeded with status ${expInvalidRes.status}`);
    }

    // 8. Test Valid Expense (April 20: split between Creator, Priya, and Sam)
    console.log('\n8. Testing Valid Expense on 2026-04-20 (All members active)...');
    const expAllRes = await fetch(`${API_URL}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId,
        description: 'April common room chairs',
        amount: 3000.00,
        currency: 'INR',
        exchangeRate: 1.0,
        date: '2026-04-20T12:00:00.000Z',
        paidById: userId,
        splitType: 'SHARE',
        splits: [
          { userId, shares: 1 },
          { userId: memberId, shares: 1 },
          { userId: samId, shares: 1 }
        ]
      }),
    });
    const expAllData = await expAllRes.json();
    if (expAllRes.status !== 201) {
      throw new Error(`Common chairs expense failed: ${JSON.stringify(expAllData)}`);
    }
    console.log(`✅ Valid expense with Sam created successfully! Splits: ${JSON.stringify(expAllData.splits.map(s => ({ user: s.userId, amount: s.amount })))}`);

    console.log('\n⭐ Integration verification passed successfully! All API paths verified.');
  } catch (err) {
    console.error('\n❌ Integration verification failed:', err.message);
    process.exit(1);
  }
}

runVerification();
