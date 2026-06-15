const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Gets authentication headers containing the JWT token from localStorage.
 */
function getHeaders(isMultipart = false) {
  const token = localStorage.getItem('token');
  const headers = {};
  
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * Custom fetch client wrapper.
 */
async function request(endpoint, options = {}) {
  const isMultipart = options.body instanceof FormData;
  const config = {
    ...options,
    headers: {
      ...getHeaders(isMultipart),
      ...(options.headers || {})
    }
  };

  const response = await fetch(`${API_BASE}${endpoint}`, config);
  
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

export const api = {
  // Auth
  register: (name, email, password) => 
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    }),
    
  login: (email, password) => 
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  // Groups
  getGroups: () => request('/groups'),
  
  getGroup: (id) => request(`/groups/${id}`),
  
  createGroup: (name, description, joinedAt) => 
    request('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description, joinedAt })
    }),
    
  getBalances: (groupId) => request(`/groups/${groupId}/balances`),
  
  addMember: (groupId, name, email, joinedAt) => 
    request(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ name, email, joinedAt })
    }),
    
  removeMember: (groupId, userId, leftAt) => 
    request(`/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
      body: JSON.stringify({ leftAt })
    }),
    
  updateMemberDates: (groupId, userId, joinedAt, leftAt) =>
    request(`/groups/${groupId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ joinedAt, leftAt })
    }),

  // Expenses
  createExpense: (expenseData) => 
    request('/expenses', {
      method: 'POST',
      body: JSON.stringify(expenseData)
    }),

  // Settlements
  createSettlement: (settlementData) => 
    request('/settlements', {
      method: 'POST',
      body: JSON.stringify(settlementData)
    }),

  // Imports
  uploadCSV: (groupId, file) => {
    const formData = new FormData();
    formData.append('groupId', groupId);
    formData.append('file', file);
    return request('/imports/upload', {
      method: 'POST',
      body: formData
    });
  },
  
  resolveAnomaly: (anomalyId, status, resolvedAction) => 
    request(`/imports/anomalies/${anomalyId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status, resolvedAction })
    }),
    
  finalizeImport: (importSessionId, resolvedRows) => 
    request('/imports/finalize', {
      method: 'POST',
      body: JSON.stringify({ importSessionId, resolvedRows })
    })
};
