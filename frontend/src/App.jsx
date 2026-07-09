import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Groups from './pages/Groups';
import GroupDashboard from './pages/GroupDashboard';
import ImportDashboard from './pages/ImportDashboard';
import { ShieldAlert, Users, LayoutDashboard, LogOut } from 'lucide-react';
import './App.css';

// Route guard to protect pages requiring authentication
function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// Navigation Header component
function Navigation() {
  const location = useLocation();
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  if (!token || location.pathname === '/login') {
    return null; // hide navigation on login and unauthenticated screens
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  };

  return (
    <header className="nav-header">
      <div className="nav-content">
        <Link to="/groups" className="nav-logo">
          <ShieldAlert size={24} /> Spreetail
        </Link>
        <nav className="nav-links">
          <Link 
            to="/groups" 
            className={`nav-link ${location.pathname.startsWith('/groups') ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <LayoutDashboard size={16} /> Dashboard
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginLeft: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '20px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Logged in as <strong style={{ color: 'var(--text-primary)' }}>{user.name}</strong>
            </span>
            <button 
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{ padding: '6px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <LogOut size={12} /> Exit
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}

function App() {
  return (
    <Router>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Navigation />
        <main style={{ flex: 1, width: '100%' }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route path="/groups" element={
              <ProtectedRoute>
                <Groups />
              </ProtectedRoute>
            } />
            
            <Route path="/groups/:id" element={
              <ProtectedRoute>
                <GroupDashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/import" element={
              <ProtectedRoute>
                <ImportDashboard />
              </ProtectedRoute>
            } />
            
            {/* Catch-all redirect to /groups */}
            <Route path="*" element={<Navigate to="/groups" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
