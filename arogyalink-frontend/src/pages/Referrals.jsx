import { useState, useEffect } from 'react'
import { ClipboardList } from 'lucide-react'
import { fetchReferrals, updateReferralStatus } from '../services/api'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'

const TABS = ['ALL', 'CREATED', 'ACCEPTED', 'TREATED', 'COMPLETED']

export default function Referrals() {
  const { user } = useAuth()
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('ALL')

  async function load() {
    setLoading(true)
    try {
      const res = await fetchReferrals()
      setReferrals(res.data.data?.referrals ?? res.data.referrals ?? [])
    } catch (e) {
      setError('Failed to load referrals.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleStatusUpdate(id, status) {
    try {
      await updateReferralStatus(id, { status })
      load()
    } catch (e) {
      alert('Failed to update status')
    }
  }

  const isDoctor = user?.role === 'DOCTOR' || user?.role === 'SPECIALIST'

  const filtered = referrals.filter(r => {
    const matchesTab = activeTab === 'ALL' || r.status === activeTab
    const matchesSearch = !search || r.patient?.name?.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })

  return (
    <AppShell search={search} onSearchChange={setSearch} searchPlaceholder="Search referrals by patient name...">
      <div className="page-header">
        <div className="page-eyebrow"><ClipboardList size={12} /> Referrals</div>
        <h1 className="page-title">Referral Management</h1>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t} className={`btn ${activeTab === t ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading referrals...</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="card-empty">No referrals found.</div></div>
      ) : (
        <div className="queue-list">
          {filtered.map(ref => (
            <div key={ref.id} className="referral-card">
              <div className="avatar">{ref.patient?.name?.[0] || '?'}</div>
              <div className="referral-info">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{ref.patient?.name || 'Unknown Patient'}</div>
                  <span className={`badge priority-${ref.priority?.toLowerCase()}`}>{ref.priority}</span>
                  <span className="badge badge-accepted">{ref.status}</span>
                </div>
                <div className="referral-facilities">
                  From: {ref.referringFacility} → To: {ref.receivingFacility}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Reason: {ref.reasonForReferral}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Created {new Date(ref.createdAt).toLocaleDateString()} by {ref.referredBy?.name}
                </div>
              </div>
              
              {isDoctor && (
                <div className="referral-actions">
                  <select 
                    className="form-control" 
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    value={ref.status}
                    onChange={(e) => handleStatusUpdate(ref.id, e.target.value)}
                  >
                    <option value="CREATED">Created</option>
                    <option value="ACCEPTED">Accepted</option>
                    <option value="TREATED">Treated</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  )
}
