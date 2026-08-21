/**
 * pages/auth/VerifyEmailPage.tsx — Email verification page.
 */
import { useState, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { authApi } from '../../lib/authApi';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    token ? 'idle' : 'success'  // If no token, show "check your email"
  );
  const [error, setError] = useState('');

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      await authApi.verifyEmail(token);
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Verification failed');
    }
  };

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c-void)' }}>
        <div style={{ width: 360, padding: 32, borderRadius: 12, background: 'var(--c-raised)', border: '1px solid var(--c-border)', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Check your email</h1>
          <p style={{ fontSize: 14, color: 'var(--t-mid)', marginBottom: 24 }}>
            We sent a verification link to your email. Click the link to verify your account.
          </p>
          <Link to="/login" style={{ color: 'var(--c-blue)', fontSize: 14 }}>Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c-void)' }}>
      <div style={{ width: 360, padding: 32, borderRadius: 12, background: 'var(--c-raised)', border: '1px solid var(--c-border)', textAlign: 'center' }}>
        {status === 'success' ? (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Email verified</h1>
            <p style={{ fontSize: 14, color: 'var(--t-mid)', marginBottom: 24 }}>Your email has been verified.</p>
            <Link to="/login" style={{ color: 'var(--c-blue)', fontSize: 14 }}>Sign in</Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Verify your email</h1>
            {status === 'error' && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</p>}
            <form onSubmit={handleVerify}>
              <button type="submit" disabled={status === 'loading'} style={{
                width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                background: 'var(--c-blue)', color: '#fff', fontSize: 14, fontWeight: 500,
                cursor: status === 'loading' ? 'wait' : 'pointer',
              }}>
                {status === 'loading' ? 'Verifying...' : 'Verify email'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
