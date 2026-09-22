import { useState, useEffect } from 'react'
import { FileText } from 'lucide-react'
import { fetchAssignedFollowUps, fetchOverdueFollowUps, updateFollowUp } from '../services/api'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'

const TABS = ['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'ESCALATED']

export default function FollowUps() {
  const { user } = useAuth()
  const [followups, setFollowups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('ALL')

  const isFieldWorker = user?.role === 'ASHA' || user?.role === 'ANM'

  async function load() {
    setLoading(true)
    try {
      const res = isFieldWorker ? await fetchAssignedFollowUps() : await fetchOverdueFollowUps()
      setFollowups(res.data.data?.followUps ?? res.data.followUps ?? [])
    } catch (e) {
      setError('Failed to load follow-ups.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [isFieldWorker])

  async function handleAction(id, data) {
    try {
      await updateFollowUp(id, data)
      load()
    } catch (e) {
      alert('Failed to update follow-up')
    }
  }

  const filtered = followups.filter(f => activeTab === 'ALL' || f.status === activeTab)

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-eyebrow"><FileText size={12} /> Follow-ups</div>
        <h1 className="page-title">{isFieldWorker ? 'My Assigned Follow-ups' : 'Overdue Follow-ups'}</h1>
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
        <div className="loading-center"><span className="spinner" /> Loading follow-ups...</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="card-empty">No follow-ups found.</div></div>
      ) : (
        <div className="queue-list">
          {filtered.map(f => {
            const isOverdue = new Date(f.dueDate) < new Date() && ['PENDING', 'IN_PROGRESS'].includes(f.status)
            return (
              <div key={f.id} className={`followup-card ${isOverdue ? 'followup-overdue' : ''}`}>
                <div className="avatar">{f.patient?.name?.[0] || '?'}</div>
                <div className="followup-info">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>{f.patient?.name || 'Unknown Patient'}</div>
                    <span className="badge badge-created">{f.status}</span>
                    {isOverdue && <span className="badge badge-rejected">Overdue</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Due: {new Date(f.dueDate).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Notes: {f.notes || 'No instructions provided.'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Assigned to: {f.assignedWorker?.name || 'Unassigned'}
                  </div>
                </div>
                
                {isFieldWorker && ['PENDING', 'IN_PROGRESS'].includes(f.status) && (
                  <div className="followup-actions">
                    <button className="btn btn-success btn-sm" onClick={() => handleAction(f.id, { status: 'COMPLETED', outcome: 'Completed by field worker' })}>
                      Complete
                    </button>
                    <button className="btn btn-outline btn-sm" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }} onClick={() => handleAction(f.id, { status: 'MISSED' })}>
                      Missed
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleAction(f.id, { status: 'ESCALATED', notes: 'Patient condition worsening' })}>
                      Escalate
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
