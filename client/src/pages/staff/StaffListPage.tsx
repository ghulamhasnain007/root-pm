/**
 * pages/staff/StaffListPage.tsx — Lists staff members for the current org.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { authApi } from '../../lib/authApi';

interface StaffMember {
  // auth-service's publicUser() returns {id, email, name, role, status} —
  // no userId, no joinedAt. An earlier version of this interface didn't
  // match that shape at all: every row's React key and its link to
  // /staff/:id were built from s.userId, which was always undefined,
  // meaning every row linked to the literal URL /staff/undefined.
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export default function StaffListPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'admin' || isOwner;

  useEffect(() => {
    if (!user?.orgId) return;
    authApi.listStaff(user.orgId)
      // GET /orgs/:orgId/staff returns a raw array directly, not wrapped
      // in { staff: [...] } — see auth-service's registerStaffRoutes.
      .then(data => setStaff(Array.isArray(data) ? data : []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [user?.orgId]);

  if (loading) return <p style={{ color: 'var(--t-mid)', fontSize: 14 }}>Loading staff...</p>;
  if (error) return <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Staff</h1>
          <p style={{ fontSize: 13, color: 'var(--t-lo)', marginTop: 4 }}>{staff.length} member{staff.length !== 1 ? 's' : ''}</p>
        </div>
        {isAdmin && (
          <Link to="/staff/invite" style={{
            padding: '8px 16px', borderRadius: 8, background: 'var(--c-blue)', color: '#fff',
            fontSize: 13, fontWeight: 500, textDecoration: 'none',
          }}>
            + Invite member
          </Link>
        )}
      </div>

      <div style={{ border: '1px solid var(--c-border)', borderRadius: 10, overflow: 'hidden' }}>
        {staff.length === 0 ? (
          <p style={{ padding: 24, color: 'var(--t-lo)', fontSize: 13, textAlign: 'center' }}>No staff members yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--c-raised)', borderBottom: '1px solid var(--c-border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--t-mid)' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--t-mid)' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--t-mid)' }}>Role</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '10px 16px' }}>{s.name || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--t-mid)' }}>{s.email}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4,
                      background: s.role === 'owner' ? 'rgba(16,185,129,.1)' : s.role === 'admin' ? 'rgba(59,130,246,.1)' : 'var(--c-raised)',
                      color: s.role === 'owner' ? 'var(--c-green)' : s.role === 'admin' ? 'var(--c-blue)' : 'var(--t-mid)',
                      fontSize: 12,
                    }}>
                      {ROLE_LABELS[s.role] || s.role}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <Link to={`/staff/${s.id}`} style={{ color: 'var(--t-lo)', textDecoration: 'none', fontSize: 13 }}>
                      <i className="ti ti-chevron-right" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
