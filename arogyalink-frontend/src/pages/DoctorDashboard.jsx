import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, CheckCircle2, XCircle, Video,
  Clock, RefreshCw, Hourglass, UserCheck
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { fetchIncoming, acceptTeleconsult, rejectTeleconsult } from '../services/api'
import AppShell from '../components/AppShell'

function isToday(d) {
  const t = new Date(d), n = new Date()
  return t.toDateString() === n.toDateString()
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function genderIcon(g) { return g === 'MALE' ? '♂' : g === 'FEMALE' ? '♀' : '⚧' }

export default function DoctorDashboard() {
  const { user } = useAuth()
  const socket   = useSocket()
  const navigate = useNavigate()

  const [allRequests, setAllRequests] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [busyId, setBusyId]           = useState(null)
  const [search, setSearch]           = useState('')
  const [tab, setTab]                 = useState('queue') // 'queue' | 'history'

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetchIncoming('all')
      setAllRequests(res.data.data?.requests ?? res.data.requests ?? [])
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load requests')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Live socket events
  useEffect(() => {
    if (!socket) return
    function onNew(req) {
      setAllRequests(prev => [req, ...prev])
    }
    socket.on('new-teleconsultation-request', onNew)
    return () => socket.off('new-teleconsultation-request', onNew)
  }, [socket])

  async function handleAccept(id) {
    setBusyId(id)
    try {
      const res = await acceptTeleconsult(id)
      const updated = res.data.data?.request ?? res.data.request
      setAllRequests(prev => prev.map(r => r.id === id ? updated : r))
      navigate(`/room/${updated.roomId}`)
    } catch (e) {
      setError(e.response?.data?.message || 'Could not accept request')
    } finally { setBusyId(null) }
  }

  async function handleReject(id) {
    setBusyId(id)
    try {
      const res = await rejectTeleconsult(id)
      const updated = res.data.data?.request ?? res.data.request
      setAllRequests(prev => prev.map(r => r.id === id ? updated : r))
    } catch (e) {
      setError(e.response?.data?.message || 'Could not reject request')
    } finally { setBusyId(null) }
  }

  const pending  = allRequests.filter(r => r.status === 'CREATED')
  const accepted = allRequests.filter(r => r.status === 'ACCEPTED')
  const today    = allRequests.filter(r => isToday(r.createdAt))
  const acceptedToday = today.filter(r => r.status === 'ACCEPTED').length
  const rejectedToday = today.filter(r => r.status === 'REJECTED').length

  const queueFiltered = pending.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return r.patient?.name?.toLowerCase().includes(q) ||
           r.requester?.name?.toLowerCase().includes(q) ||
           r.reason?.toLowerCase().includes(q)
  })
  const historyFiltered = allRequests.filter(r => r.status !== 'CREATED').filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return r.patient?.name?.toLowerCase().includes(q) || r.reason?.toLowerCase().includes(q)
  })

  return (
    <AppShell
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search patients, reason…"
      notificationCount={pending.length}
    >
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <div className="page-eyebrow">
              <span className="live-dot" />
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="page-title">
              {user?.role === 'SPECIALIST' ? '' : 'Dr. '}{user?.name}
            </h1>
            <p className="page-subtitle">
              {user?.role} · {pending.length} patient{pending.length !== 1 ? 's' : ''} waiting · {accepted.length} room{accepted.length !== 1 ? 's' : ''} open
            </p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Stat Cards ── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label"><Hourglass size={12} /> Waiting Now</div>
          <div className="stat-value warning">{pending.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Video size={12} /> Open Rooms</div>
          <div className="stat-value">{accepted.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><CheckCircle2 size={12} /> Accepted Today</div>
          <div className="stat-value success">{acceptedToday}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><XCircle size={12} /> Declined Today</div>
          <div className="stat-value danger">{rejectedToday}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Clock size={12} /> Requests Today</div>
          <div className="stat-value">{today.length}</div>
        </div>
      </div>

      {/* ── Active / Accepted Rooms ── */}
      {accepted.length > 0 && (
        <div className="section">
          <div className="section-title"><Video size={14} color="var(--brand)" /> Active Consultation Rooms</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
            {accepted.map(r => (
              <div key={r.id} className="card" style={{ margin: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className="avatar">{(r.patient?.name || '?')[0]}</div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.patient?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {r.patient?.village}, {r.patient?.district}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Requested by <strong>{r.requester?.name}</strong> ({r.requester?.role})
                </div>
                <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)', marginBottom: 10 }}>
                  "{r.reason}"
                </div>
                <div style={{ fontSize: 11, background: 'var(--bg)', borderRadius: 6, padding: '4px 8px', marginBottom: 10, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  Room: {r.roomId}
                </div>
                <button className="btn btn-success btn-block btn-sm" onClick={() => navigate(`/room/${r.roomId}`)}>
                  <Video size={12} /> Rejoin Room
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs: Queue / History ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[['queue', `Waiting Queue (${pending.length})`], ['history', 'History']].map(([key, label]) => (
          <button
            key={key}
            className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(key)}
          >
            {key === 'queue' ? <Activity size={12} /> : <UserCheck size={12} />} {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading…</div>
      ) : tab === 'queue' ? (
        <div className="section">
          <div className="section-title"><Activity size={14} color="var(--warning)" /> Live Waiting Queue</div>
          {queueFiltered.length === 0 ? (
            <div className="card"><div className="card-empty">✅ No patients waiting right now.</div></div>
          ) : (
            <div className="queue-list">
              {queueFiltered.map(r => (
                <div key={r.id} className="request-card" style={{ borderLeft: '3px solid var(--warning)' }}>
                  <div className="avatar">{(r.patient?.name || '?')[0]}</div>
                  <div className="request-info">
                    <div className="request-patient">
                      {r.patient?.name}
                      <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>
                        {genderIcon(r.patient?.gender)}
                        {r.patient?.dateOfBirth ? ` · ${new Date().getFullYear() - new Date(r.patient.dateOfBirth).getFullYear()} yrs` : ''}
                      </span>
                    </div>
                    <div className="request-meta">
                      From <strong>{r.requester?.name}</strong> ({r.requester?.role})
                      · {r.patient?.village}, {r.patient?.district}
                      · <span style={{ color: 'var(--warning)' }}>{timeAgo(r.createdAt)}</span>
                    </div>
                    <div className="request-reason">"{r.reason}"</div>
                  </div>
                  <div className="request-actions">
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => handleAccept(r.id)}
                      disabled={busyId === r.id}
                    >
                      {busyId === r.id ? <span className="spinner sm" /> : <CheckCircle2 size={12} />}
                      Accept
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleReject(r.id)}
                      disabled={busyId === r.id}
                    >
                      <XCircle size={12} /> Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="section">
          <div className="section-title"><UserCheck size={14} /> Consultation History</div>
          {historyFiltered.length === 0 ? (
            <div className="card"><div className="card-empty">No history yet.</div></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Location</th>
                    <th>Requested By</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {historyFiltered.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.patient?.name}</strong></td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.patient?.village}, {r.patient?.district}</td>
                      <td>{r.requester?.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({r.requester?.role})</span></td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        {r.reason}
                      </td>
                      <td><span className={`badge badge-${r.status.toLowerCase()}`}>{r.status}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {new Date(r.createdAt).toLocaleDateString('en-IN')}
                      </td>
                      <td>
                        {r.status === 'ACCEPTED' && r.roomId && (
                          <button className="btn btn-sm btn-outline" onClick={() => navigate(`/room/${r.roomId}`)}>
                            <Video size={11} /> Rejoin
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
