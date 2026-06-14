import { calculateSplits } from './src/utils/splits.js';

let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    failedTests++;
  } else {
    console.log('✅ PASS:', message);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    console.error('❌ FAIL (expected exception):', message);
    failedTests++;
  } catch (err) {
    console.log('✅ PASS (caught expected exception):', message, `[Error: ${err.message}]`);
  }
}

console.log('Running Split Utility Unit Tests...\n');

// 1. EQUAL Split Rounding Test
const eqSplits = calculateSplits(100.00, 'EQUAL', ['u1', 'u2', 'u3']);
assert(eqSplits.length === 3, 'Equal split produces 3 outputs');
const eqSum = eqSplits.reduce((s, x) => s + x.amount, 0);
assert(eqSum === 100.00, 'Equal split sum is exactly 100.00');
assert(eqSplits[0].amount === 33.34, 'User 1 gets remainder (33.34)');
assert(eqSplits[1].amount === 33.33, 'User 2 gets 33.33');
assert(eqSplits[2].amount === 33.33, 'User 3 gets 33.33');

// 2. UNEQUAL Split Validation
const uneqSplits = calculateSplits(150.50, 'UNEQUAL', [
  { userId: 'u1', amount: 50.25 },
  { userId: 'u2', amount: 100.25 }
]);
assert(uneqSplits.length === 2, 'Unequal split returns correct count');
assert(uneqSplits.reduce((s, x) => s + x.amount, 0) === 150.50, 'Unequal split sum equals total');

assertThrows(() => {
  calculateSplits(150.50, 'UNEQUAL', [
    { userId: 'u1', amount: 50.25 },
    { userId: 'u2', amount: 100.00 } // total is 150.25 instead of 150.50
  ]);
}, 'Throw error on unequal split mismatch');

// 3. PERCENTAGE Split Normalization & Sum Validation
const pctSplits = calculateSplits(1000.00, 'PERCENTAGE', [
  { userId: 'u1', percentage: 33.33 },
  { userId: 'u2', percentage: 33.33 },
  { userId: 'u3', percentage: 33.34 }
]);
assert(pctSplits.reduce((s, x) => s + x.amount, 0) === 1000.00, 'Percentage splits sum to total');
assert(pctSplits[0].amount === 333.30, 'User 1 gets 333.30');
assert(pctSplits[1].amount === 333.30, 'User 2 gets 333.30');
assert(pctSplits[2].amount === 333.40, 'User 3 gets 333.40');

assertThrows(() => {
  calculateSplits(1000.00, 'PERCENTAGE', [
    { userId: 'u1', percentage: 30 },
    { userId: 'u2', percentage: 80 } // sum is 110%
  ]);
}, 'Throw error when percentage sum !== 100%');

// 4. SHARE Split
const shareSplits = calculateSplits(1200.00, 'SHARE', [
  { userId: 'u1', shares: 1 },
  { userId: 'u2', shares: 2 },
  { userId: 'u3', shares: 1 }
]);
assert(shareSplits.reduce((s, x) => s + x.amount, 0) === 1200.00, 'Share splits sum to total');
assert(shareSplits.find(s => s.userId === 'u1').amount === 300.00, '1 share = 300.00');
assert(shareSplits.find(s => s.userId === 'u2').amount === 600.00, '2 shares = 600.00');
assert(shareSplits.find(s => s.userId === 'u3').amount === 300.00, '1 share = 300.00');

assertThrows(() => {
  calculateSplits(100.00, 'SHARE', [
    { userId: 'u1', shares: 0 },
    { userId: 'u2', shares: 0 }
  ]);
}, 'Throw error on total shares === 0');

if (failedTests > 0) {
  console.error(`\n❌ Unit tests failed: ${failedTests} failures.`);
  process.exit(1);
} else {
  console.log('\n⭐ All Unit Tests Passed Successfully!');
}
