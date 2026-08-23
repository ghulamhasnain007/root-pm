/**
 * pages/staff/StaffDetailPage.tsx — View and manage a single staff member.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { authApi } from '../../lib/authApi';

interface StaffMember {
  // Matches auth-service's publicUser() shape exactly — see the same note
  // in StaffListPage.tsx. No userId field exists on the real response.
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

const ROLE_OPTIONS = ['member', 'admin', 'owner'];

export default function StaffDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  const [member, setMember] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newRole, setNewRole] = useState('');
  const [saving, setSaving] = useState(false);

  const isOwner = currentUser?.role === 'owner';
  const isSelf = currentUser?.userId === userId;
  const canChangeRole = isOwner && !isSelf;
  const canRemove = isOwner && !isSelf;

  useEffect(() => {
    if (!currentUser?.orgId || !userId) return;
    authApi.listStaff(currentUser.orgId)
      // GET /orgs/:orgId/staff returns a raw array directly, not wrapped
      // in { staff: [...] } — same bug that was in StaffListPage.tsx.
      .then(data => {
        const list: StaffMember[] = Array.isArray(data) ? data : [];
        const found = list.find((s: StaffMember) => s.id === userId);
        if (found) {
          setMember(found);
          setNewRole(found.role);
        } else {
          setError('Staff member not found');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [currentUser?.orgId, userId]);

  const handleRoleChange = async () => {
    if (!currentUser?.orgId || !userId) return;
    setSaving(true);
    try {
      await authApi.changeRole(currentUser.orgId, userId, newRole);
      setMember(prev => prev ? { ...prev, role: newRole } : prev);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!currentUser?.orgId || !userId) return;
    if (!confirm('Remove this staff member from the org?')) return;
    setSaving(true);
    try {
      await authApi.removeStaff(currentUser.orgId, userId);
      navigate('/staff');
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--t-mid)', fontSize: 14 }}>Loading...</p>;
  if (error && !member) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;
  if (!member) return <p style={{ color: 'var(--t-lo)', fontSize: 14 }}>Staff member not found.</p>;

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/staff" style={{ fontSize: 13, color: 'var(--c-blue)', textDecoration: 'none' }}>
          <i className="ti ti-arrow-left" style={{ marginRight: 4 }} /> Back to staff
        </Link>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{member.name || member.email}</h1>
      <p style={{ fontSize: 13, color: 'var(--t-lo)', marginBottom: 24 }}>{member.email}</p>

      {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Role section */}
      <div style={{ padding: 20, borderRadius: 10, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Role</h2>
        {canChangeRole ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={newRole} onChange={e => setNewRole(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--c-border2)', background: 'var(--c-base)', color: 'var(--t-hi)', fontSize: 13 }}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            <button onClick={handleRoleChange} disabled={saving || newRole === member.role} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: newRole !== member.role ? 'var(--c-blue)' : 'var(--c-border2)',
              color: '#fff', fontSize: 13, cursor: saving ? 'wait' : 'pointer',
            }}>
              {saving ? 'Saving...' : 'Update'}
            </button>
          </div>
        ) : (
          <span style={{
            padding: '2px 8px', borderRadius: 4,
            background: member.role === 'owner' ? 'rgba(16,185,129,.1)' : 'var(--c-raised)',
            color: member.role === 'owner' ? 'var(--c-green)' : 'var(--t-mid)',
            fontSize: 12,
          }}>
            {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
          </span>
        )}
        {isSelf && <p style={{ fontSize: 11, color: 'var(--t-lo)', marginTop: 6 }}>You cannot change your own role.</p>}
      </div>

      {/* Remove section */}
      {canRemove && (
        <div style={{ padding: 20, borderRadius: 10, border: '1px solid var(--c-border)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#ef4444' }}>Danger zone</h2>
          <button onClick={handleRemove} disabled={saving} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #ef4444',
            background: 'transparent', color: '#ef4444', fontSize: 13,
            cursor: saving ? 'wait' : 'pointer',
          }}>
            Remove from org
          </button>
        </div>
      )}
    </div>
  );
}
