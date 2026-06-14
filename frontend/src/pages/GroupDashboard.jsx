import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { 
  Users, UserPlus, UserMinus, DollarSign, ArrowLeft, Upload, 
  TrendingUp, TrendingDown, ArrowRightLeft, Calendar, FileText, Plus, Info
} from 'lucide-react';

export default function GroupDashboard() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [balances, setBalances] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Selected member for Rohan's Ledger View (Step 17)
  const [selectedMember, setSelectedMember] = useState(null);
  
  // Modals
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  
  // Form states
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberJoinDate, setMemberJoinDate] = useState('2026-02-01');
  const [removeUserId, setRemoveUserId] = useState('');
  const [memberLeftDate, setMemberLeftDate] = useState('2026-03-31');

  // Manual Expense states
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCurrency, setExpCurrency] = useState('INR');
  const [expRate, setExpRate] = useState('1.0');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expPayer, setExpPayer] = useState('');
  const [expSplitType, setExpSplitType] = useState('EQUAL');
  const [expParticipants, setExpParticipants] = useState([]); // list of user IDs

  // Manual Settlement states
  const [setFrom, setSetFrom] = useState('');
  const [setTo, setSetTo] = useState('');
  const [setAmount, setSetAmount] = useState('');
  const [setDate, setSetDate] = useState(new Date().toISOString().split('T')[0]);
  const [setNotes, setSetNotes] = useState('');

  useEffect(() => {
    fetchDashboardData();
  }, [groupId]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError('');
    try {
      const groupData = await api.getGroup(groupId);
      setGroup(groupData);
      
      const balanceData = await api.getBalances(groupId);
      setBalances(balanceData);
      
      // Select the first member's ledger by default if available
      if (balanceData && balanceData.members.length > 0) {
        setSelectedMember(balanceData.members[0]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const isoJoinDate = new Date(`${memberJoinDate}T00:00:00.000Z`).toISOString();
      await api.addMember(groupId, memberName, memberEmail || null, isoJoinDate);
      setShowMemberModal(false);
      setMemberName('');
      setMemberEmail('');
      fetchDashboardData();
    } catch (err) {
      setError(err.message || 'Failed to add member');
    }
  };

  const handleRemoveMember = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const isoLeftDate = new Date(`${memberLeftDate}T23:59:59.000Z`).toISOString();
      await api.removeMember(groupId, removeUserId, isoLeftDate);
      setShowRemoveModal(false);
      fetchDashboardData();
    } catch (err) {
      setError(err.message || 'Failed to remove member');
    }
  };

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createExpense({
        groupId,
        description: expDesc,
        amount: parseFloat(expAmount),
        currency: expCurrency,
        exchangeRate: parseFloat(expRate),
        date: new Date(`${expDate}T12:00:00.000Z`).toISOString(),
        paidById: expPayer,
        splitType: expSplitType,
        splits: expSplitType === 'EQUAL' ? expParticipants : expParticipants.map(id => ({ userId: id, amount: parseFloat(expAmount) / expParticipants.length })), // standard equal split approximation
        notes: ''
      });
      setShowExpenseModal(false);
      setExpDesc('');
      setExpAmount('');
      fetchDashboardData();
    } catch (err) {
      setError(err.message || 'Failed to create expense');
    }
  };

  const handleCreateSettlement = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createSettlement({
        groupId,
        paidById: setFrom,
        receivedById: setTo,
        amount: parseFloat(setAmount),
        date: new Date(`${setDate}T12:00:00.000Z`).toISOString(),
        notes: setNotes
      });
      setShowSettlementModal(false);
      setSetAmount('');
      setSetNotes('');
      fetchDashboardData();
    } catch (err) {
      setError(err.message || 'Failed to record settlement');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-secondary)' }}>
        Loading Group Dashboard...
      </div>
    );
  }

  if (error && !group) {
    return (
      <div className="app-container">
        <Link to="/groups" className="btn btn-secondary" style={{ marginBottom: '20px' }}>
          <ArrowLeft size={16} /> Back to Groups
        </Link>
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)', padding: '20px', borderRadius: '12px' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container animate-fade-in">
      {/* Navbar Breadcrumbs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <Link to="/groups" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>
          <ArrowLeft size={16} /> Back to Groups
        </Link>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Link to={`/import?groupId=${groupId}`} className="btn btn-secondary">
            <Upload size={16} /> Import CSV Spreadsheet
          </Link>
          <button onClick={() => {
            setExpPayer(balances?.members[0]?.userId || '');
            setExpParticipants(balances?.members.map(m => m.userId) || []);
            setShowExpenseModal(true);
          }} className="btn btn-primary">
            <Plus size={16} /> Record Expense
          </button>
          <button onClick={() => {
            setSetFrom(balances?.members[0]?.userId || '');
            setSetTo(balances?.members[1]?.userId || '');
            setShowSettlementModal(true);
          }} className="btn btn-secondary" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
            <ArrowRightLeft size={16} /> Settle Up
          </button>
        </div>
      </div>

      {/* Main Dashboard Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '32px', alignItems: 'start' }} className="grid-cols-2">
        
        {/* Left Side: Members Timeline & Balances (Step 16) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Group details card */}
          <div className="glass-card">
            <h2 style={{ fontSize: '1.6rem', marginBottom: '6px' }}>{group.name}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>{group.description}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span>Created: {new Date(group.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Members List (Step 16) */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={18} style={{ color: 'var(--primary)' }} /> Members History
              </h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setShowMemberModal(true)} className="btn btn-secondary" style={{ padding: '6px 8px' }} title="Add Member">
                  <UserPlus size={14} />
                </button>
                <button onClick={() => {
                  if (balances && balances.members.length > 0) {
                    setRemoveUserId(balances.members[0].userId);
                    setShowRemoveModal(true);
                  }
                }} className="btn btn-secondary" style={{ padding: '6px 8px' }} title="Remove Member">
                  <UserMinus size={14} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {balances?.members.map((m) => {
                const isSelected = selectedMember?.userId === m.userId;
                // Find matching membership record
                const membership = group.memberships.find(mem => mem.userId === m.userId);
                
                return (
                  <div 
                    key={m.userId}
                    onClick={() => setSelectedMember(m)}
                    style={{ 
                      padding: '12px', 
                      borderRadius: '10px', 
                      background: isSelected ? 'var(--primary-glow)' : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: '600', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {m.name} {m.isGuest && <span className="badge badge-blue" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>Guest</span>}
                      </span>
                      <span style={{ 
                        fontWeight: '700', 
                        fontSize: '0.95rem',
                        color: m.netBalance >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {m.netBalance >= 0 ? `+₹${m.netBalance.toFixed(2)}` : `-₹${Math.abs(m.netBalance).toFixed(2)}`}
                      </span>
                    </div>
                    {/* Membership history dates */}
                    {membership && (
                      <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span>Joined: {new Date(membership.joinedAt).toLocaleDateString()}</span>
                        {membership.leftAt && (
                          <span style={{ color: 'var(--accent-red)' }}>Left: {new Date(membership.leftAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Settle-up transfers simplified panel (Aisha's Rule) */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ArrowRightLeft size={18} style={{ color: 'var(--primary)' }} /> Settle-up Payments
            </h3>
            
            {balances?.suggestedSettlements.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
                🎉 Everyone is fully settled up!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {balances?.suggestedSettlements.map((s, idx) => (
                  <div key={idx} style={{ 
                    padding: '10px 14px', 
                    borderRadius: '8px', 
                    background: 'rgba(255,255,255,0.02)', 
                    borderLeft: '3px solid var(--primary)',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ fontWeight: '600' }}>{s.fromName}</span> pays{' '}
                    <span style={{ fontWeight: '600' }}>{s.toName}</span>
                    <div style={{ fontWeight: '700', fontSize: '1.05rem', color: 'var(--text-primary)', marginTop: '4px' }}>
                      ₹{s.amount.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Ledger View (Step 17) */}
        <div>
          {selectedMember ? (
            <div className="glass-card" style={{ minHeight: '500px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FileText size={22} style={{ color: 'var(--primary)' }} /> {selectedMember.name}'s Ledger
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                    Detail of all transactions and split contributions
                  </p>
                </div>
                
                {/* Stats widget for selected member */}
                <div style={{ display: 'flex', gap: '20px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Paid</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'flex-end' }}>
                      <TrendingUp size={16} /> ₹{selectedMember.totalPaid.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Owed</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'flex-end' }}>
                      <TrendingDown size={16} /> ₹{selectedMember.totalOwed.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {selectedMember.ledger.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-secondary)' }}>
                  This member has no logged splits or expenses in their timeline.
                </div>
              ) : (
                <div className="table-container">
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th style={{ textAlign: 'right' }}>Original Amount</th>
                        <th style={{ textAlign: 'right' }}>Amount Paid</th>
                        <th style={{ textAlign: 'right' }}>Your Share</th>
                        <th style={{ textAlign: 'right' }}>Net Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMember.ledger.map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ fontSize: '0.85rem' }}>
                            {new Date(item.date).toLocaleDateString()}
                          </td>
                          <td>
                            <div style={{ fontWeight: '500' }}>{item.description}</div>
                            {item.isRefund && <span className="badge badge-red" style={{ fontSize: '0.6rem', padding: '1px 5px', marginTop: '4px' }}>Refund</span>}
                          </td>
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {item.isRefund ? 'REFUND' : 'EXPENSE'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {item.currency === 'USD' ? `$${item.amount.toFixed(2)}` : `₹${item.amount.toFixed(2)}`}
                            {item.currency === 'USD' && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                rate: {item.exchangeRate}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: '600', color: item.userPaid > 0 ? 'var(--accent-green)' : 'inherit' }}>
                            {item.userPaid > 0 ? `₹${item.userPaid.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', color: item.userOwed > 0 ? 'var(--accent-red)' : 'inherit' }}>
                            {item.userOwed > 0 ? `₹${item.userOwed.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ 
                            textAlign: 'right', 
                            fontWeight: '700',
                            color: item.netContribution >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                          }}>
                            {item.netContribution >= 0 ? `+₹${item.netContribution.toFixed(2)}` : `-₹${Math.abs(item.netContribution).toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              Select a member to view their ledger.
            </div>
          )}
        </div>
      </div>

      {/* 1. Add Member Modal */}
      {showMemberModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '450px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '8px' }}><UserPlus size={22} style={{ color: 'var(--primary)' }} /> Add Member</h2>
              <button onClick={() => setShowMemberModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>

            <form onSubmit={handleAddMember}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input type="text" className="form-input" placeholder="Sam" value={memberName} onChange={(e) => setMemberName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Email (Optional)</label>
                <input type="email" className="form-input" placeholder="sam@example.com" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Join Date</label>
                <input type="date" className="form-input" value={memberJoinDate} onChange={(e) => setMemberJoinDate(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" onClick={() => setShowMemberModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary">Add Member</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Remove Member Modal */}
      {showRemoveModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '450px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '8px' }}><UserMinus size={22} style={{ color: 'var(--accent-red)' }} /> Remove Member</h2>
              <button onClick={() => setShowRemoveModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>

            <form onSubmit={handleRemoveMember}>
              <div className="form-group">
                <label className="form-label">Select Member</label>
                <select className="form-input" value={removeUserId} onChange={(e) => setRemoveUserId(e.target.value)} required>
                  {balances?.members.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Leave Date</label>
                <input type="date" className="form-input" value={memberLeftDate} onChange={(e) => setMemberLeftDate(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" onClick={() => setShowRemoveModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-danger">Record Departure</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Record Expense Modal */}
      {showExpenseModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '8px' }}><Plus size={20} style={{ color: 'var(--primary)' }} /> Record Expense</h2>
              <button onClick={() => setShowExpenseModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>

            <form onSubmit={handleCreateExpense}>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input type="text" className="form-input" placeholder="WiFi Bill" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input type="number" step="any" className="form-input" placeholder="1200" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-input" value={expCurrency} onChange={(e) => setExpCurrency(e.target.value)}>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Rate</label>
                  <input type="number" step="any" className="form-input" value={expRate} onChange={(e) => setExpRate(e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Expense Date</label>
                <input type="date" className="form-input" value={expDate} onChange={(e) => setExpDate(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Paid By</label>
                <select className="form-input" value={expPayer} onChange={(e) => setExpPayer(e.target.value)} required>
                  {balances?.members.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Split Participants (Select All)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '120px', overflowY: 'auto', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  {balances?.members.map(m => (
                    <label key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                      <input 
                        type="checkbox" 
                        checked={expParticipants.includes(m.userId)} 
                        onChange={(e) => {
                          if (e.target.checked) {
                            setExpParticipants([...expParticipants, m.userId]);
                          } else {
                            setExpParticipants(expParticipants.filter(id => id !== m.userId));
                          }
                        }}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" onClick={() => setShowExpenseModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary">Save Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Record Settlement Modal */}
      {showSettlementModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '8px' }}><ArrowRightLeft size={20} style={{ color: 'var(--primary)' }} /> Log Settlement</h2>
              <button onClick={() => setShowSettlementModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>

            <form onSubmit={handleCreateSettlement}>
              <div className="form-group">
                <label className="form-label">Sender (Who Paid)</label>
                <select className="form-input" value={setFrom} onChange={(e) => setSetFrom(e.target.value)} required>
                  {balances?.members.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Receiver (Who Received)</label>
                <select className="form-input" value={setTo} onChange={(e) => setSetTo(e.target.value)} required>
                  {balances?.members.map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Amount (INR)</label>
                <input type="number" step="any" className="form-input" placeholder="5000" value={setAmount} onChange={(e) => setSetAmount(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={setDate} onChange={(e) => setSetDate(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <input type="text" className="form-input" placeholder="Paid back rent balance" value={setNotes} onChange={(e) => setSetNotes(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" onClick={() => setShowSettlementModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary">Save Payment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
