import express from 'express';
import { prisma } from '../db.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Apply auth middleware
router.use(auth);

// Record a settlement (Step 9)
router.post('/', async (req, res) => {
  const {
    groupId,
    paidById, // Payer (person sending money)
    receivedById, // Payee (person receiving money)
    amount,
    date,
    notes,
  } = req.body;

  if (!groupId || !paidById || !receivedById || typeof amount !== 'number' || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: 'Settlement amount must be greater than zero' });
  }

  if (paidById === receivedById) {
    return res.status(400).json({ error: 'Cannot record a settlement to yourself' });
  }

  const settlementDate = new Date(date);
  if (isNaN(settlementDate.getTime())) {
    return res.status(400).json({ error: 'Invalid settlement date' });
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
      return res.status(403).json({ error: 'Access denied' });
    }

    // 2. Fetch memberships on the settlement date to ensure both users are members
    const activeMemberships = await prisma.groupMembership.findMany({
      where: {
        groupId,
        joinedAt: { lte: settlementDate },
        OR: [
          { leftAt: null },
          { leftAt: { gte: settlementDate } }
        ]
      }
    });

    const activeUserIds = new Set(activeMemberships.map((m) => m.userId));

    if (!activeUserIds.has(paidById)) {
      return res.status(400).json({
        error: 'Payer was not a member of this group on the settlement date'
      });
    }

    if (!activeUserIds.has(receivedById)) {
      return res.status(400).json({
        error: 'Receiver was not a member of this group on the settlement date'
      });
    }

    // 3. Create the Settlement record
    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        paidById,
        receivedById,
        amount: Math.round(amount * 100) / 100, // round to 2 decimal places
        currency: 'INR',
        date: settlementDate,
        notes: notes ? notes.trim() : null,
      },
      include: {
        paidBy: {
          select: { id: true, name: true },
        },
        receivedBy: {
          select: { id: true, name: true },
        },
      },
    });

    return res.status(201).json(settlement);
  } catch (error) {
    console.error('Create settlement error:', error);
    return res.status(500).json({ error: 'Failed to record settlement' });
  }
});

// Get all settlements in a group
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

    const settlements = await prisma.settlement.findMany({
      where: { groupId },
      include: {
        paidBy: {
          select: { id: true, name: true },
        },
        receivedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { date: 'desc' },
    });

    return res.json(settlements);
  } catch (error) {
    console.error('Get settlements error:', error);
    return res.status(500).json({ error: 'Failed to fetch settlements' });
  }
});

export default router;
