/**
 * pages/staff/StaffInvitePage.tsx — Invite a new staff member.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { authApi } from '../../lib/authApi';

export default function StaffInvitePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const isOwner = user?.role === 'owner';
  const canChangeRole = isOwner;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.orgId) return;
    setError('');
    setLoading(true);
    try {
      await authApi.inviteStaff(user.orgId, email, role);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Invite failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Invite sent</h1>
        <p style={{ fontSize: 14, color: 'var(--t-mid)', marginBottom: 24 }}>
          An invitation has been sent to <strong>{email}</strong>. They will receive an email with a link to create their account.
        </p>
        <Link to="/staff" style={{ color: 'var(--c-blue)', fontSize: 14 }}>Back to staff list</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Invite staff member</h1>

      {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Email address</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="colleague@example.com"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }} />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>Role</span>
          <select value={role} onChange={e => setRole(e.target.value)} disabled={!canChangeRole}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 14 }}>
            <option value="member">Member</option>
            {canChangeRole && <option value="admin">Admin</option>}
          </select>
          {!canChangeRole && <p style={{ fontSize: 11, color: 'var(--t-lo)', marginTop: 4 }}>Only the owner can assign admin role.</p>}
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" disabled={loading} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: 'var(--c-blue)', color: '#fff', fontSize: 14, fontWeight: 500,
            cursor: loading ? 'wait' : 'pointer',
          }}>
            {loading ? 'Sending...' : 'Send invite'}
          </button>
          <Link to="/staff" style={{
            padding: '10px 20px', borderRadius: 8,
            border: '1px solid var(--c-border2)', background: 'transparent',
            color: 'var(--t-mid)', fontSize: 14, textDecoration: 'none',
          }}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
