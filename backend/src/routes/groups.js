import express from 'express';
import { prisma } from '../db.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Apply auth middleware to all group endpoints
router.use(auth);

// Create Group
router.post('/', async (req, res) => {
  const { name, description, joinedAt } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const joinDate = joinedAt ? new Date(joinedAt) : new Date();
  if (isNaN(joinDate.getTime())) {
    return res.status(400).json({ error: 'Invalid joinedAt date' });
  }

  try {
    const group = await prisma.$transaction(async (tx) => {
      // 1. Create Group
      const newGroup = await tx.group.create({
        data: {
          name: name.trim(),
          description: description ? description.trim() : null,
        },
      });

      // 2. Add creator as first member
      await tx.groupMembership.create({
        data: {
          groupId: newGroup.id,
          userId: req.user.id,
          joinedAt: joinDate,
        },
      });

      return newGroup;
    });

    return res.status(201).json(group);
  } catch (error) {
    console.error('Create group error:', error);
    return res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get all groups for the authenticated user
router.get('/', async (req, res) => {
  try {
    const memberships = await prisma.groupMembership.findMany({
      where: {
        userId: req.user.id,
      },
      include: {
        group: true,
      },
    });

    // Extract unique groups
    const groups = memberships.map((m) => m.group);
    return res.json(groups);
  } catch (error) {
    console.error('Get groups error:', error);
    return res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get group details by ID (including members)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Verify user is a member of the group
    const userMembership = await prisma.groupMembership.findFirst({
      where: {
        groupId: id,
        userId: req.user.id,
      },
    });

    if (!userMembership) {
      return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
    }

    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isGuest: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    return res.json(group);
  } catch (error) {
    console.error('Get group by ID error:', error);
    return res.status(500).json({ error: 'Failed to fetch group details' });
  }
});

// Add member to group
router.post('/:id/members', async (req, res) => {
  const { id: groupId } = req.params;
  const { email, name, joinedAt } = req.body;

  if (!email && !name) {
    return res.status(400).json({ error: 'Either email or name is required to add a member' });
  }

  const joinDate = joinedAt ? new Date(joinedAt) : new Date();
  if (isNaN(joinDate.getTime())) {
    return res.status(400).json({ error: 'Invalid joinedAt date' });
  }

  try {
    // 1. Verify caller is a member
    const userMembership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: req.user.id,
      },
    });

    if (!userMembership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 2. Find or create User to add
    let targetUser = null;

    if (email) {
      targetUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      });
    }

    // If user not found, create a guest user
    if (!targetUser) {
      const guestName = name || email.split('@')[0];
      targetUser = await prisma.user.create({
        data: {
          name: guestName.trim(),
          email: email ? email.toLowerCase().trim() : `guest-${Date.now()}-${Math.random().toString(36).substring(2, 7)}@spreetree.local`,
          passwordHash: '', // Guests don't have passwords
          isGuest: true,
        },
      });
    }

    // 3. Check if user already has an active membership in this group
    const activeMembership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: targetUser.id,
        leftAt: null,
      },
    });

    if (activeMembership) {
      return res.status(400).json({ error: 'User is already an active member of this group' });
    }

    // 4. Create membership record
    const membership = await prisma.groupMembership.create({
      data: {
        groupId,
        userId: targetUser.id,
        joinedAt: joinDate,
        leftAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isGuest: true,
          },
        },
      },
    });

    return res.status(201).json(membership);
  } catch (error) {
    console.error('Add member error:', error);
    return res.status(500).json({ error: 'Failed to add member to group' });
  }
});

// Remove member from group (set leftAt)
router.delete('/:id/members/:userId', async (req, res) => {
  const { id: groupId, userId } = req.params;
  const { leftAt } = req.body; // Allow specifying leftAt date, defaults to now

  const leaveDate = leftAt ? new Date(leftAt) : new Date();
  if (isNaN(leaveDate.getTime())) {
    return res.status(400).json({ error: 'Invalid leftAt date' });
  }

  try {
    // 1. Verify caller is a member
    const userMembership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: req.user.id,
      },
    });

    if (!userMembership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 2. Find the active membership for target user
    const membership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId,
        leftAt: null,
      },
    });

    if (!membership) {
      return res.status(404).json({ error: 'Active membership not found for this user in this group' });
    }

    if (leaveDate < new Date(membership.joinedAt)) {
      return res.status(400).json({ error: 'leave date cannot be before join date' });
    }

    // 3. Update the leftAt column
    const updatedMembership = await prisma.groupMembership.update({
      where: {
        id: membership.id,
      },
      data: {
        leftAt: leaveDate,
      },
    });

    return res.json({
      message: 'Member successfully removed from group',
      membership: updatedMembership,
    });
  } catch (error) {
    console.error('Remove member error:', error);
    return res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Get group balances and simplified debts (Steps 8 & 9)
router.get('/:id/balances', async (req, res) => {
  const { id: groupId } = req.params;

  try {
    // 1. Verify caller is a member
    const userMembership = await prisma.groupMembership.findFirst({
      where: {
        groupId,
        userId: req.user.id,
      },
    });

    if (!userMembership) {
      return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
    }

    // 2. Fetch all memberships (both active and past) to include everyone who was ever in the group
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isGuest: true,
          },
        },
      },
    });

    // 3. Initialize balance tracking objects for each unique user
    const userBalances = {};
    memberships.forEach((m) => {
      if (!userBalances[m.user.id]) {
        userBalances[m.user.id] = {
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          isGuest: m.user.isGuest,
          totalPaid: 0.0,
          totalOwed: 0.0,
          totalSentSettlements: 0.0,
          totalReceivedSettlements: 0.0,
          netBalance: 0.0,
          ledger: [],
        };
      }
    });

    // 4. Fetch all expenses in this group with their splits
    const expenses = await prisma.expense.findMany({
      where: { groupId },
      include: { splits: true },
    });

    // 5. Fetch all settlements in this group
    const settlements = await prisma.settlement.findMany({
      where: { groupId },
    });

    // 6. Aggregate expenses & splits
    expenses.forEach((expense) => {
      const sign = expense.isRefund ? -1 : 1;
      const amountInINR = expense.amountInINR;

      // Credit the payer
      if (userBalances[expense.paidById]) {
        userBalances[expense.paidById].totalPaid += sign * amountInINR;
      }

      // Debit all split participants
      expense.splits.forEach((split) => {
        if (userBalances[split.userId]) {
          const splitAmountInINR = split.amount * expense.exchangeRate;
          userBalances[split.userId].totalOwed += sign * splitAmountInINR;

          // Push record to ledger (Rohan's requirement)
          userBalances[split.userId].ledger.push({
            expenseId: expense.id,
            description: expense.description,
            date: expense.date,
            amount: expense.amount,
            currency: expense.currency,
            amountInINR: expense.amountInINR,
            exchangeRate: expense.exchangeRate,
            isRefund: expense.isRefund,
            userPaid: expense.paidById === split.userId ? (sign * amountInINR) : 0.0,
            userOwed: sign * splitAmountInINR,
            netContribution: (expense.paidById === split.userId ? (sign * amountInINR) : 0.0) - (sign * splitAmountInINR),
          });
        }
      });
    });

    // 7. Aggregate settlements
    settlements.forEach((settlement) => {
      if (userBalances[settlement.paidById]) {
        userBalances[settlement.paidById].totalSentSettlements += settlement.amount;
      }
      if (userBalances[settlement.receivedById]) {
        userBalances[settlement.receivedById].totalReceivedSettlements += settlement.amount;
      }
    });

    // 8. Calculate final rounded net balances
    const debtorBalances = [];
    const creditorBalances = [];
    const membersList = [];

    Object.keys(userBalances).forEach((userId) => {
      const u = userBalances[userId];
      u.totalPaid = Math.round(u.totalPaid * 100) / 100;
      u.totalOwed = Math.round(u.totalOwed * 100) / 100;
      u.totalSentSettlements = Math.round(u.totalSentSettlements * 100) / 100;
      u.totalReceivedSettlements = Math.round(u.totalReceivedSettlements * 100) / 100;
      
      const net = (u.totalPaid - u.totalOwed) + u.totalSentSettlements - u.totalReceivedSettlements;
      u.netBalance = Math.round(net * 100) / 100;

      // Sort ledgers chronologically by date
      u.ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

      membersList.push(u);

      if (u.netBalance < -0.01) {
        debtorBalances.push({ userId: u.userId, name: u.name, balance: u.netBalance });
      } else if (u.netBalance > 0.01) {
        creditorBalances.push({ userId: u.userId, name: u.name, balance: u.netBalance });
      }
    });

    // 9. Greedy Debt Simplification Algorithm (Aisha's requirement)
    debtorBalances.sort((a, b) => a.balance - b.balance); // Most negative first (e.g. -500 before -200)
    creditorBalances.sort((a, b) => b.balance - a.balance); // Most positive first (e.g. 500 before 200)

    const suggestedSettlements = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtorBalances.length && cIdx < creditorBalances.length) {
      const debtor = debtorBalances[dIdx];
      const creditor = creditorBalances[cIdx];

      const amountToPay = Math.min(-debtor.balance, creditor.balance);
      const roundedAmount = Math.round(amountToPay * 100) / 100;

      if (roundedAmount > 0.01) {
        suggestedSettlements.push({
          from: debtor.userId,
          fromName: debtor.name,
          to: creditor.userId,
          toName: creditor.name,
          amount: roundedAmount,
        });
      }

      debtor.balance += roundedAmount;
      creditor.balance -= roundedAmount;

      if (Math.abs(debtor.balance) < 0.01) {
        dIdx++;
      }
      if (Math.abs(creditor.balance) < 0.01) {
        cIdx++;
      }
    }

    return res.json({
      groupId,
      members: membersList,
      suggestedSettlements,
    });
  } catch (error) {
    console.error('Calculate balances error:', error);
    return res.status(500).json({ error: 'Failed to calculate group balances' });
  }
});

export default router;
