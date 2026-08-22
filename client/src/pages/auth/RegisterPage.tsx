/**
 * pages/auth/RegisterPage.tsx — Self-serve organization registration.
 *
 * This is the ONLY self-serve entry point in the whole system: creates a
 * brand-new org plus its first (Owner) account. Every other account is
 * created via AcceptInvitePage, which requires an existing Owner/Admin to
 * have sent an invite first — there is no "join an existing org" flow.
 * Registration does not log the user in: the account starts
 * pending_verification and can't log in until the emailed verification
 * link is clicked (see VerifyEmailPage).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../../lib/authApi';

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--c-border2)', background: 'var(--c-base)',
  color: 'var(--t-hi)', fontSize: 14,
} as const;
const labelStyle = { display: 'block', marginBottom: 16 } as const;
const labelTextStyle = { fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' } as const;

export default function RegisterPage() {
  const navigate = useNavigate();

  const [orgName, setOrgName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.register(orgName, ownerEmail, ownerPassword, ownerName);
      // Registration returns no tokens — the account is pending_verification
      // and cannot log in yet. Route to a "check your email" screen, passing
      // the email along so it can offer a resend-verification action.
      navigate(`/verify-email?email=${encodeURIComponent(ownerEmail)}`);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c-void)' }}>
      <form onSubmit={handleSubmit} style={{
        width: 380, padding: 32, borderRadius: 12,
        background: 'var(--c-raised)', border: '1px solid var(--c-border)',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, textAlign: 'center' }}>Create your organization</h1>
        <p style={{ fontSize: 13, color: 'var(--t-lo)', textAlign: 'center', marginBottom: 24 }}>
          You'll be the Owner — invite the rest of your team afterward.
        </p>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <label style={labelStyle}>
          <span style={labelTextStyle}>Organization name</span>
          <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} required
            minLength={2} placeholder="Acme Inc" style={inputStyle} />
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>Your name</span>
          <input type="text" value={ownerName} onChange={e => setOwnerName(e.target.value)} required
            style={inputStyle} />
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>Your email</span>
          <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} required
            style={inputStyle} />
        </label>

        <label style={{ ...labelStyle, marginBottom: 24 }}>
          <span style={labelTextStyle}>Password</span>
          <input type="password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)}
            required minLength={10} style={inputStyle} />
          <span style={{ fontSize: 11, color: 'var(--t-lo)', marginTop: 4, display: 'block' }}>At least 10 characters</span>
        </label>

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: 'var(--c-blue)', color: '#fff', fontSize: 14, fontWeight: 500,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
        }}>
          {loading ? 'Creating…' : 'Create organization'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--t-lo)' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--c-blue)' }}>Sign in</Link>
        </p>
        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: 'var(--t-lo)' }}>
          Joining an existing team? You'll need an invite link from your org's Owner or Admin.
        </p>
      </form>
    </div>
  );
}
