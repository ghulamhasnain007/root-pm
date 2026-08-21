/**
 * pages/auth/RegisterPage.tsx — Registration page (accepts invite token).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authApi } from '../../lib/authApi';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('token') || '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.register(email, password, name, inviteToken);
      navigate('/verify-email');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
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
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, textAlign: 'center' }}>Create account</h1>

        {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {!inviteToken && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontSize: 13, marginBottom: 16 }}>
            No invite token. Ask your org owner for an invite link.
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Name</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <button type="submit" disabled={loading || !inviteToken} style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: inviteToken ? 'var(--c-blue)' : 'var(--c-border2)', color: '#fff', fontSize: 14, fontWeight: 500,
          cursor: loading || !inviteToken ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Creating...' : 'Create account'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--t-lo)' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--c-blue)' }}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
