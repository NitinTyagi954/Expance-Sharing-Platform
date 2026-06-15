import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { 
  Upload, FileText, AlertTriangle, CheckCircle, XCircle, 
  Settings, RefreshCw, ArrowLeft, ArrowRight, Play, Edit2
} from 'lucide-react';

export default function ImportDashboard() {
  const [searchParams] = useSearchParams();
  const groupId = searchParams.get('groupId');
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Importer states
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(83.0);
  
  // User Resolutions map
  // Key: rowNumber -> resolved row object
  const [resolvedRows, setResolvedRows] = useState({});
  // Key: anomalyId -> status ('APPROVED' | 'REJECTED' | 'MODIFIED')
  const [anomalyStatuses, setAnomalyStatuses] = useState({});
  
  // Row inline edit states
  const [editingRowNumber, setEditingRowNumber] = useState(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editPayer, setEditPayer] = useState('');
  const [editSplitType, setEditSplitType] = useState('EQUAL');
  const [editSplitDetails, setEditSplitDetails] = useState('');

  useEffect(() => {
    if (groupId) {
      fetchGroupDetails();
    }
  }, [groupId]);

  const fetchGroupDetails = async () => {
    try {
      const data = await api.getGroup(groupId);
      setGroup(data);
    } catch (err) {
      setError('Failed to fetch group details');
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError('');
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError('');
    try {
      const data = await api.uploadCSV(groupId, file);
      setSession(data.session);
      setRows(data.rows);
      const sortedAnomalies = (data.session.anomalies || []).sort((a, b) => a.rowNumber - b.rowNumber);
      setAnomalies(sortedAnomalies);
      setExchangeRate(data.exchangeRate || 83.0);
      
      // Initialize resolved rows map with parsed rows copy
      const rowsMap = {};
      data.rows.forEach(r => {
        rowsMap[r.rowNumber] = { ...r };
      });
      setResolvedRows(rowsMap);

      // Initialize statuses map
      const statusesMap = {};
      sortedAnomalies.forEach(anom => {
        statusesMap[anom.id] = 'PENDING';
      });
      setAnomalyStatuses(statusesMap);
    } catch (err) {
      setError(err.message || 'Failed to upload and parse CSV file');
    } finally {
      setLoading(false);
    }
  };

  // 1. Approve suggested resolution (Step 18)
  const handleApprove = async (anom) => {
    try {
      const actionDetails = JSON.parse(anom.suggestedAction);
      const rowNum = anom.rowNumber;
      const updatedRow = { ...resolvedRows[rowNum] };

      if (actionDetails.action === 'DISCARD' || actionDetails.action === 'SKIP_ROW') {
        updatedRow.isSkipped = true;
      } else if (actionDetails.action === 'CONVERT_TO_SETTLEMENT') {
        updatedRow.isSettlement = true;
        // Settlements in CSV are paidBy pays splitWith[0]
        updatedRow.isRefund = false;
      } else if (actionDetails.action === 'MARK_AS_REFUND') {
        updatedRow.isRefund = true;
        updatedRow.amount = Math.abs(updatedRow.amount);
      } else if (actionDetails.action === 'DEFAULT_TO_INR') {
        updatedRow.currency = 'INR';
      } else if (actionDetails.action === 'NORMALIZE_NAME') {
        updatedRow.paidBy = actionDetails.suggestedName;
      } else if (actionDetails.action === 'REMOVE_INACTIVE_PARTICIPANT') {
        // remove participant from splitWith array
        if (updatedRow.splitWith) {
          updatedRow.splitWith = updatedRow.splitWith.filter(name => name !== actionDetails.participantName);
        }
      } else if (actionDetails.action === 'USE_SPLIT_DETAILS') {
        updatedRow.splitType = 'SHARE';
      } else if (actionDetails.action === 'NORMALIZE_PERCENTAGES') {
        updatedRow.splitDetails = actionDetails.normalizedDetails;
      } else if (actionDetails.action === 'CREATE_GUEST') {
        // system auto creates guest user upon commit
      } else if (actionDetails.action === 'AUTOCORRECT_AMOUNT') {
        updatedRow.amount = actionDetails.parsedAmount;
      }

      setResolvedRows({
        ...resolvedRows,
        [rowNum]: updatedRow
      });

      // Submit resolution state to backend
      await api.resolveAnomaly(anom.id, 'APPROVED', actionDetails);
      setAnomalyStatuses({
        ...anomalyStatuses,
        [anom.id]: 'APPROVED'
      });
    } catch (err) {
      setError(`Failed to approve resolution: ${err.message}`);
    }
  };

  // 1.5. Approve all auto-approvable anomalies
  const handleApproveAll = async () => {
    const pendingAnomalies = anomalies.filter(anom => anomalyStatuses[anom.id] === 'PENDING');
    const autoApprovable = pendingAnomalies.filter(anom => {
      const actionDetails = JSON.parse(anom.suggestedAction || '{}');
      return !['REQUIRE_PAYER', 'REQUIRE_DATE', 'SELECT_DATE_FORMAT', 'RESOLVE_CONFLICT'].includes(actionDetails.action);
    });

    if (autoApprovable.length === 0) return;

    setLoading(true);
    setError('');
    try {
      const newResolvedRows = { ...resolvedRows };
      const newStatuses = { ...anomalyStatuses };

      for (const anom of autoApprovable) {
        const actionDetails = JSON.parse(anom.suggestedAction);
        const rowNum = anom.rowNumber;
        const updatedRow = { ...newResolvedRows[rowNum] };

        if (actionDetails.action === 'DISCARD' || actionDetails.action === 'SKIP_ROW') {
          updatedRow.isSkipped = true;
        } else if (actionDetails.action === 'CONVERT_TO_SETTLEMENT') {
          updatedRow.isSettlement = true;
          updatedRow.isRefund = false;
        } else if (actionDetails.action === 'MARK_AS_REFUND') {
          updatedRow.isRefund = true;
          updatedRow.amount = Math.abs(updatedRow.amount);
        } else if (actionDetails.action === 'DEFAULT_TO_INR') {
          updatedRow.currency = 'INR';
        } else if (actionDetails.action === 'NORMALIZE_NAME') {
          updatedRow.paidBy = actionDetails.suggestedName;
        } else if (actionDetails.action === 'REMOVE_INACTIVE_PARTICIPANT') {
          if (updatedRow.splitWith) {
            updatedRow.splitWith = updatedRow.splitWith.filter(name => name !== actionDetails.participantName);
          }
        } else if (actionDetails.action === 'USE_SPLIT_DETAILS') {
          updatedRow.splitType = 'SHARE';
        } else if (actionDetails.action === 'NORMALIZE_PERCENTAGES') {
          updatedRow.splitDetails = actionDetails.normalizedDetails;
        } else if (actionDetails.action === 'CREATE_GUEST') {
          // system auto creates guest user upon commit
        } else if (actionDetails.action === 'AUTOCORRECT_AMOUNT') {
          updatedRow.amount = actionDetails.parsedAmount;
        }

        newResolvedRows[rowNum] = updatedRow;
        newStatuses[anom.id] = 'APPROVED';
      }

      // Send requests to backend in parallel
      await Promise.all(
        autoApprovable.map(anom => 
          api.resolveAnomaly(anom.id, 'APPROVED', JSON.parse(anom.suggestedAction))
        )
      );

      setResolvedRows(newResolvedRows);
      setAnomalyStatuses(newStatuses);
    } catch (err) {
      setError(`Failed to approve all anomalies: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. Reject anomaly/discard row (Step 18)
  const handleReject = async (anom) => {
    try {
      const rowNum = anom.rowNumber;
      const updatedRow = { ...resolvedRows[rowNum] };
      updatedRow.isSkipped = true; // Rejecting skips the row

      setResolvedRows({
        ...resolvedRows,
        [rowNum]: updatedRow
      });

      await api.resolveAnomaly(anom.id, 'REJECTED', { action: 'DISCARD' });
      setAnomalyStatuses({
        ...anomalyStatuses,
        [anom.id]: 'REJECTED'
      });
    } catch (err) {
      setError(`Failed to reject anomaly: ${err.message}`);
    }
  };

  // 3. Open Inline modify form (Step 18)
  const handleStartModify = (anom) => {
    const rowNum = anom.rowNumber;
    const row = resolvedRows[rowNum];
    setEditingRowNumber(rowNum);
    setEditDesc(row.description);
    setEditAmount(row.amount !== null ? row.amount : '');
    setEditDate(row.date ? new Date(row.date).toISOString().split('T')[0] : '');
    setEditPayer(row.paidBy || row.paidByRaw || '');
    setEditSplitType(row.splitType || 'EQUAL');
    setEditSplitDetails(row.splitDetails || '');
  };

  // Save Inline manual modification (Step 18)
  const handleSaveModify = async (anom) => {
    try {
      const rowNum = anom.rowNumber;
      const updatedRow = { 
        ...resolvedRows[rowNum],
        description: editDesc,
        amount: parseFloat(editAmount),
        date: new Date(`${editDate}T12:00:00.000Z`).toISOString(),
        paidBy: editPayer,
        splitType: editSplitType,
        splitDetails: editSplitDetails,
        isSkipped: false
      };

      setResolvedRows({
        ...resolvedRows,
        [rowNum]: updatedRow
      });

      // Submit resolution status to backend
      const resolvedAction = {
        action: 'MODIFY_ROW',
        fields: { description: editDesc, amount: editAmount, date: editDate, paidBy: editPayer, splitType: editSplitType, splitDetails: editSplitDetails }
      };

      await api.resolveAnomaly(anom.id, 'MODIFIED', resolvedAction);
      setAnomalyStatuses({
        ...anomalyStatuses,
        [anom.id]: 'MODIFIED'
      });
      setEditingRowNumber(null);
    } catch (err) {
      setError(`Failed to save modification: ${err.message}`);
    }
  };

  // 4. Finalize Import commit (Step 18)
  const handleFinalize = async () => {
    setLoading(true);
    setError('');
    try {
      // Map resolvedRows back to array
      const finalRows = Object.values(resolvedRows);
      
      // Validate all unskipped rows before submitting
      for (const row of finalRows) {
        if (row.isSkipped || row.action === 'SKIP_ROW') continue;

        const paidBy = (row.paidBy || row.paidByRaw || '').trim();
        if (!paidBy) {
          throw new Error(`Row ${row.rowNumber} is missing a payer name. Please click "Modify" to set one, or "Reject" to discard the row.`);
        }

        if (!row.date) {
          throw new Error(`Row ${row.rowNumber} is missing a date. Please click "Modify" to set one, or "Reject" to discard the row.`);
        }
      }
      
      const res = await api.finalizeImport(session.id, finalRows);
      alert(res.message);
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err.message || 'Failed to finalize import session');
    } finally {
      setLoading(false);
    }
  };

  // Calculate statistics for UI
  const totalRowsCount = rows.length;
  const correctRowsCount = rows.filter(row => !anomalies.some(anom => anom.rowNumber === row.rowNumber)).length;
  const manualReviewCount = new Set(anomalies.filter(anom => anomalyStatuses[anom.id] === 'PENDING').map(anom => anom.rowNumber)).size;
  const readyToImportCount = rows.filter(row => {
    const resolved = resolvedRows[row.rowNumber];
    if (resolved?.isSkipped) return false;
    const rowAnoms = anomalies.filter(anom => anom.rowNumber === row.rowNumber);
    const hasPending = rowAnoms.some(anom => anomalyStatuses[anom.id] === 'PENDING');
    return !hasPending;
  }).length;

  const pendingAutoApprovable = anomalies
    .filter(anom => anomalyStatuses[anom.id] === 'PENDING')
    .filter(anom => {
      const actionDetails = JSON.parse(anom.suggestedAction || '{}');
      return !['REQUIRE_PAYER', 'REQUIRE_DATE', 'SELECT_DATE_FORMAT', 'RESOLVE_CONFLICT'].includes(actionDetails.action);
    });
  const autoApprovableCount = pendingAutoApprovable.length;

  return (
    <div className="app-container animate-fade-in">
      {/* Breadcrumb nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
        <Link to={`/groups/${groupId}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>CSV Import Review</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Import spreadsheet records to {group?.name || 'group'} and audit transaction anomalies
        </p>
      </div>

      {error && (
        <div style={{ 
          backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', 
          color: 'var(--accent-red)', padding: '16px', borderRadius: '12px', marginBottom: '24px'
        }}>
          {error}
        </div>
      )}

      {/* Upload Screen */}
      {!session && (
        <div className="glass-card" style={{ maxWidth: '600px', margin: '0 auto', padding: '40px' }}>
          <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
            <div style={{ 
              width: '80px', height: '80px', borderRadius: '20px', 
              background: 'var(--primary-glow)', color: 'var(--primary)',
              display: 'flex', justifyContent: 'center', alignItems: 'center'
            }}>
              <Upload size={36} />
            </div>
            
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>Upload Expenses CSV</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '350px' }}>
                Upload the messy `expenses_export.csv` file directly. The app will audit and highlight issues.
              </p>
            </div>

            <div style={{ width: '100%' }}>
              <input 
                type="file" 
                accept=".csv" 
                id="csvFile" 
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <label 
                htmlFor="csvFile" 
                style={{ 
                  display: 'block', width: '100%', padding: '20px', 
                  border: '2px dashed rgba(255,255,255,0.1)', borderRadius: '12px',
                  textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s',
                  background: 'rgba(255,255,255,0.01)'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
              >
                {file ? (
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{file.name}</span>
                ) : (
                  <span style={{ color: 'var(--text-secondary)' }}>Click to select a file...</span>
                )}
              </label>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '14px' }}
              disabled={!file || loading}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : 'Process CSV Sheet'}
            </button>
          </form>
        </div>
      )}

      {/* Review Screen (Step 18) */}
      {session && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* Stats Bar */}
          <div style={{ 
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', 
            background: 'var(--bg-card)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)'
          }} className="grid-cols-2">
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Rows</span>
              <h4 style={{ fontSize: '2rem', fontWeight: '700', marginTop: '6px' }}>{totalRowsCount}</h4>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Manually Review</span>
              <h4 style={{ fontSize: '2rem', fontWeight: '700', marginTop: '6px', color: 'var(--accent-yellow)' }}>{manualReviewCount}</h4>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Correct Rows</span>
              <h4 style={{ fontSize: '2rem', fontWeight: '700', marginTop: '6px', color: 'var(--accent-green)' }}>{correctRowsCount}</h4>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Ready to Import</span>
              <h4 style={{ fontSize: '2rem', fontWeight: '700', marginTop: '6px', color: 'var(--accent-blue)' }}>{readyToImportCount}</h4>
            </div>
          </div>

          {/* Anomaly Review Table */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <AlertTriangle size={20} style={{ color: 'var(--accent-yellow)' }} /> Audit Anomalies Log (Meera's rule)
              </h3>
              {autoApprovableCount > 0 && (
                <button 
                  onClick={handleApproveAll} 
                  className="btn btn-primary" 
                  disabled={loading}
                  style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                >
                  Approve All ({autoApprovableCount})
                </button>
              )}
            </div>

            <div className="table-container">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Anomaly Type</th>
                    <th>Audit Description</th>
                    <th>Resolution Actions</th>
                    <th>Audit Status</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((anom) => {
                    const status = anomalyStatuses[anom.id];
                    const isEditing = editingRowNumber === anom.rowNumber;
                    const actionDetails = JSON.parse(anom.suggestedAction || '{}');
                    const canAutoApprove = !['REQUIRE_PAYER', 'REQUIRE_DATE', 'SELECT_DATE_FORMAT', 'RESOLVE_CONFLICT'].includes(actionDetails.action);

                    return (
                      <React.Fragment key={anom.id}>
                        <tr>
                          <td>{anom.rowNumber}</td>
                          <td>
                            <span className={`badge ${
                              anom.anomalyType === 'DUPLICATE' ? 'badge-red' :
                              anom.anomalyType === 'SETTLEMENT' ? 'badge-blue' :
                              anom.anomalyType === 'NEGATIVE_AMOUNT' ? 'badge-red' : 'badge-yellow'
                            }`}>
                              {anom.anomalyType}
                            </span>
                          </td>
                          <td style={{ maxWidth: '300px', lineHeight: '1.4' }}>
                            <div>{anom.description}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                              Suggested: {actionDetails.action}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {canAutoApprove ? (
                                <button 
                                  onClick={() => handleApprove(anom)}
                                  className="btn btn-secondary"
                                  style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--accent-green)', borderColor: status === 'APPROVED' ? 'var(--accent-green)' : 'rgba(255,255,255,0.08)' }}
                                >
                                  Approve
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', alignSelf: 'center', paddingRight: '4px', fontStyle: 'italic' }}>
                                  Manual action required
                                </span>
                              )}
                              <button 
                                onClick={() => handleReject(anom)}
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--accent-red)', borderColor: status === 'REJECTED' ? 'var(--accent-red)' : 'rgba(255,255,255,0.08)' }}
                              >
                                Reject
                              </button>
                              <button 
                                onClick={() => handleStartModify(anom)}
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--accent-yellow)', borderColor: status === 'MODIFIED' ? 'var(--accent-yellow)' : 'rgba(255,255,255,0.08)' }}
                              >
                                <Edit2 size={12} /> Modify
                              </button>
                            </div>
                          </td>
                          <td>
                            {status === 'PENDING' && <span className="badge badge-yellow">Pending Review</span>}
                            {status === 'APPROVED' && <span className="badge badge-green"><CheckCircle size={12} style={{ marginRight: '4px' }} /> Approved</span>}
                            {status === 'REJECTED' && <span className="badge badge-red"><XCircle size={12} style={{ marginRight: '4px' }} /> Discarded</span>}
                            {status === 'MODIFIED' && <span className="badge badge-blue"><Settings size={12} style={{ marginRight: '4px' }} /> Overridden</span>}
                          </td>
                        </tr>

                        {/* Inline modify panel (Step 18) */}
                        {isEditing && (
                          <tr>
                            <td colSpan="5" style={{ background: 'rgba(245, 158, 11, 0.03)', padding: '20px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }} className="grid-cols-2">
                                <div className="form-group">
                                  <label className="form-label">Description</label>
                                  <input type="text" className="form-input" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Amount</label>
                                  <input type="number" step="any" className="form-input" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Date</label>
                                  <input type="date" className="form-input" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Payer Name</label>
                                  <input type="text" className="form-input" value={editPayer} onChange={(e) => setEditPayer(e.target.value)} />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Split Type</label>
                                  <select className="form-input" value={editSplitType} onChange={(e) => setEditSplitType(e.target.value)}>
                                    <option value="EQUAL">EQUAL</option>
                                    <option value="PERCENTAGE">PERCENTAGE</option>
                                    <option value="SHARE">SHARE</option>
                                    <option value="UNEQUAL">UNEQUAL</option>
                                  </select>
                                </div>
                                <div className="form-group">
                                  <label className="form-label">Split Details</label>
                                  <input type="text" className="form-input" placeholder="Aisha 30%; Rohan 30%" value={editSplitDetails} onChange={(e) => setEditSplitDetails(e.target.value)} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setEditingRowNumber(null)} className="btn btn-secondary" style={{ padding: '6px 12px' }}>Cancel</button>
                                <button onClick={() => handleSaveModify(anom)} className="btn btn-primary" style={{ padding: '6px 12px' }}>Save Changes</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action commit bar */}
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>Confirm finalized import</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                All anomalies have resolutions logged. Click finalize to commit to the ledger.
              </p>
            </div>
            <button 
              onClick={handleFinalize} 
              className="btn btn-primary" 
              style={{ padding: '14px 28px' }}
              disabled={loading}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Play size={16} /> Finalize CSV Import</span>}
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
