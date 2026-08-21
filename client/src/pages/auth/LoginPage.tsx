/**
 * pages/auth/LoginPage.tsx — Login page for the unified dashboard.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/overview');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c-void)' }}>
      <form onSubmit={handleSubmit} style={{
        width: 360, padding: 32, borderRadius: 12,
        background: 'var(--c-raised)', border: '1px solid var(--c-border)',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, textAlign: 'center' }}>Sign in</h1>

        {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: 'var(--c-blue)', color: '#fff', fontSize: 14, fontWeight: 500,
          cursor: loading ? 'wait' : 'pointer',
        }}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--t-lo)' }}>
          No account? <Link to="/accept-invite" style={{ color: 'var(--c-blue)' }}>Accept an invite</Link>
        </p>
      </form>
    </div>
  );
}
