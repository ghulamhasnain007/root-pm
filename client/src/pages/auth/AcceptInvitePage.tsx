/**
 * pages/auth/AcceptInvitePage.tsx — Accept invite and create account.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const { acceptInvite } = useAuth();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // No email field here on purpose — the invite is already tied to a
      // specific email server-side (set when the invite was created);
      // asking the invitee to retype it adds a field that could mismatch
      // for no benefit. Goes through AuthContext (not authApi directly) so
      // React's `user` state updates immediately — see AuthContext's
      // acceptInvite for why that distinction matters here.
      await acceptInvite(inviteToken, password, name);
      navigate('/overview');
    } catch (err: any) {
      setError(err.message || 'Failed to accept invite');
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
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, textAlign: 'center' }}>Accept invite</h1>

        {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {!inviteToken && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontSize: 13, marginBottom: 16 }}>
            No invite token in URL. Use the link from your email.
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Name</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <button type="submit" disabled={loading || !inviteToken} style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: inviteToken ? 'var(--c-blue)' : 'var(--c-border2)', color: '#fff', fontSize: 14, fontWeight: 500,
          cursor: loading || !inviteToken ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Accepting...' : 'Accept invite'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--t-lo)' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--c-blue)' }}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
