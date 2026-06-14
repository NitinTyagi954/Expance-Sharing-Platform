/**
 * Calculates expense split amounts for participants.
 * 
 * @param {number} totalAmount - The total expense amount to split (in original currency or INR)
 * @param {'EQUAL'|'UNEQUAL'|'PERCENTAGE'|'SHARE'} splitType - The method of splitting
 * @param {Array<string|Object>} participants - Array of participant data:
 *   - For 'EQUAL': Array of userIds: ['id1', 'id2', ...]
 *   - For 'UNEQUAL': Array of objects: [{ userId: 'id1', amount: 50.0 }]
 *   - For 'PERCENTAGE': Array of objects: [{ userId: 'id1', percentage: 25.0 }]
 *   - For 'SHARE': Array of objects: [{ userId: 'id1', shares: 2 }]
 * 
 * @returns {Array<Object>} Array of splits: [{ userId: 'id1', amount: 25.00, percentage?: number, shares?: number }]
 */
export function calculateSplits(totalAmount, splitType, participants) {
  if (totalAmount <= 0) {
    throw new Error('Total amount must be greater than zero');
  }
  if (!participants || participants.length === 0) {
    throw new Error('Participants list cannot be empty');
  }

  // Ensure totalAmount is rounded to 2 decimal places to start
  const targetTotal = Math.round(totalAmount * 100) / 100;
  let splits = [];

  switch (splitType) {
    case 'EQUAL': {
      // participants is array of userIds
      const count = participants.length;
      const baseAmount = Math.floor((targetTotal / count) * 100) / 100;
      
      splits = participants.map((userId) => {
        if (typeof userId !== 'string') {
          throw new Error('For EQUAL splits, participants must be user ID strings');
        }
        return {
          userId,
          amount: baseAmount,
          percentage: Math.round((100 / count) * 100) / 100,
          shares: 1,
        };
      });
      break;
    }

    case 'UNEQUAL': {
      let sum = 0;
      splits = participants.map((p) => {
        if (!p.userId || typeof p.amount !== 'number') {
          throw new Error('For UNEQUAL splits, participants must contain userId and numeric amount');
        }
        const amt = Math.round(p.amount * 100) / 100;
        sum += amt;
        return {
          userId: p.userId,
          amount: amt,
        };
      });

      // Round sum to 2 decimal places to compare
      const roundedSum = Math.round(sum * 100) / 100;
      if (Math.abs(roundedSum - targetTotal) > 0.01) {
        throw new Error(`Sum of unequal split amounts (${roundedSum}) must equal total expense amount (${targetTotal})`);
      }
      break;
    }

    case 'PERCENTAGE': {
      let percentSum = 0;
      splits = participants.map((p) => {
        if (!p.userId || typeof p.percentage !== 'number') {
          throw new Error('For PERCENTAGE splits, participants must contain userId and numeric percentage');
        }
        percentSum += p.percentage;
        
        // Calculate raw amount and floor to cents
        const amt = Math.floor(((p.percentage / 100) * targetTotal) * 100) / 100;
        return {
          userId: p.userId,
          amount: amt,
          percentage: p.percentage,
        };
      });

      const roundedPercentSum = Math.round(percentSum * 100) / 100;
      if (Math.abs(roundedPercentSum - 100) > 0.01) {
        throw new Error(`Sum of percentages must equal 100%, got ${roundedPercentSum}%`);
      }
      break;
    }

    case 'SHARE': {
      let totalShares = 0;
      participants.forEach((p) => {
        if (!p.userId || typeof p.shares !== 'number' || p.shares < 0) {
          throw new Error('For SHARE splits, participants must contain userId and non-negative shares');
        }
        totalShares += p.shares;
      });

      if (totalShares <= 0) {
        throw new Error('Total shares must be greater than zero');
      }

      splits = participants.map((p) => {
        const amt = Math.floor(((p.shares / totalShares) * targetTotal) * 100) / 100;
        return {
          userId: p.userId,
          amount: amt,
          shares: p.shares,
          percentage: Math.round(((p.shares / totalShares) * 100) * 100) / 100,
        };
      });
      break;
    }

    default:
      throw new Error(`Invalid split type: ${splitType}`);
  }

  // Adjust for floating point remainder.
  // We sum the allocated amounts and distribute any difference (remainder)
  // to the participant with the largest amount (or first in case of ties).
  const allocatedSum = splits.reduce((sum, s) => sum + s.amount, 0);
  const remainder = Math.round((targetTotal - allocatedSum) * 100) / 100;

  if (remainder !== 0 && splits.length > 0) {
    // Find the participant with the maximum amount to allocate the remainder to
    let maxIndex = 0;
    for (let i = 1; i < splits.length; i++) {
      if (splits[i].amount > splits[maxIndex].amount) {
        maxIndex = i;
      }
    }
    splits[maxIndex].amount = Math.round((splits[maxIndex].amount + remainder) * 100) / 100;
  }

  return splits;
}
