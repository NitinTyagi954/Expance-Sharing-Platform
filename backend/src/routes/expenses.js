import express from 'express';
import { prisma } from '../db.js';
import { auth } from '../middleware/auth.js';
import { calculateSplits } from '../utils/splits.js';

const router = express.Router();

// Apply auth middleware
router.use(auth);

// Create Expense
router.post('/', async (req, res) => {
  const {
    groupId,
    description,
    amount,
    currency = 'INR',
    exchangeRate = 1.0,
    date,
    paidById,
    splitType,
    splits, // Participant list: array of ids or objects depending on splitType
    notes,
    isRefund = false,
  } = req.body;

  // Basic validations
  if (!groupId || !description || typeof amount !== 'number' || !date || !paidById || !splitType || !splits) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const expenseDate = new Date(date);
  if (isNaN(expenseDate.getTime())) {
    return res.status(400).json({ error: 'Invalid expense date' });
  }

  try {
    // 1. Verify caller is a member of the group
    const callerMembership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: req.user.id,
      },
    });

    if (!callerMembership) {
      return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
    }

    // 2. Fetch all members who were active in the group on the expense date
    const activeMemberships = await prisma.groupMembership.findMany({
      where: {
        groupId,
        joinedAt: { lte: expenseDate },
        OR: [
          { leftAt: null },
          { leftAt: { gte: expenseDate } }
        ]
      }
    });

    const activeUserIds = new Set(activeMemberships.map((m) => m.userId));

    // 3. Verify payer is active on the expense date
    if (!activeUserIds.has(paidById)) {
      return res.status(400).json({
        error: 'Payer was not an active member of this group on the expense date'
      });
    }

    // 4. Extract participant IDs from splits data and verify they are active on this date
    let participantIds = [];
    if (splitType === 'EQUAL') {
      participantIds = splits;
    } else {
      participantIds = splits.map((s) => s.userId);
    }

    for (const userId of participantIds) {
      if (!activeUserIds.has(userId)) {
        return res.status(400).json({
          error: `Participant ${userId} was not an active member of this group on the expense date`
        });
      }
    }

    // 5. Calculate splits
    let calculatedSplits = [];
    try {
      calculatedSplits = calculateSplits(amount, splitType, splits);
    } catch (splitError) {
      return res.status(400).json({ error: splitError.message });
    }

    // 6. Calculate INR amount
    const rate = typeof exchangeRate === 'number' ? exchangeRate : 1.0;
    const amountInINR = Math.round(amount * rate * 100) / 100;

    // 7. Save to database in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create Expense
      const expense = await tx.expense.create({
        data: {
          groupId,
          description: description.trim(),
          amount,
          currency,
          amountInINR,
          exchangeRate: rate,
          date: expenseDate,
          paidById,
          splitType,
          notes: notes ? notes.trim() : null,
          isRefund,
        },
      });

      // Create ExpenseSplits
      const splitsData = calculatedSplits.map((s) => ({
        expenseId: expense.id,
        userId: s.userId,
        amount: s.amount,
        percentage: s.percentage || null,
        shares: s.shares || null,
      }));

      await tx.expenseSplit.createMany({
        data: splitsData,
      });

      // Fetch newly created splits to return
      const createdSplits = await tx.expenseSplit.findMany({
        where: { expenseId: expense.id },
      });

      return { expense, splits: createdSplits };
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('Create expense error:', error);
    return res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Get all expenses for a group
router.get('/group/:groupId', async (req, res) => {
  const { groupId } = req.params;

  try {
    // Verify user is a member
    const membership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: req.user.id,
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const expenses = await prisma.expense.findMany({
      where: { groupId },
      include: {
        splits: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        paidBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    return res.json(expenses);
  } catch (error) {
    console.error('Get expenses error:', error);
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

export default router;
