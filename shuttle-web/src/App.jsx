import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './Landing';
import Wizard from './Wizard';
import Dashboard from './Dashboard';

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { this.setState({ info }); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#fee2e2', color: '#991b1b', height: '100vh', overflow: 'auto' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold' }}>Dashboard Crash</h2>
          <p>Please copy the text below and tell the assistant:</p>
          <pre style={{ background: 'white', padding: '10px', marginTop: '10px' }}>{this.state.error?.toString()}</pre>
          <pre style={{ background: 'white', padding: '10px', marginTop: '10px' }}>{this.state.info?.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }) {
  const userStr = localStorage.getItem('takeme_user');
  let user = null;
  try {
    user = userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    user = null;
  }

  if (!user || !user.id || !user.role) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route 
          path="/wizard" 
          element={
            <ProtectedRoute>
              <Wizard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <ErrorBoundary><Dashboard /></ErrorBoundary>
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
