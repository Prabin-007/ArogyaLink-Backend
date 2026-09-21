import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Video, Users, Hourglass, CheckCircle2, XCircle, RefreshCw, Plus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { fetchMyTeleconsults } from '../services/api'
import AppShell from '../components/AppShell'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
function isToday(d) {
  const t = new Date(d), n = new Date()
  return t.toDateString() === n.toDateString()
}
function statusBadge(s) {
  return <span className={`badge badge-${s.toLowerCase()}`}>{s}</span>
}
function roleLabel(r) {
  const m = { ASHA: 'ASHA Worker', ANM: 'ANM', DOCTOR: 'PHC Doctor', SPECIALIST: 'Specialist' }
  return m[r] || r
}

export default function Dashboard() {
  const { user } = useAuth()
  const socket = useSocket()
  const navigate = useNavigate()
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetchMyTeleconsults()
      setRequests(res.data.data?.requests ?? res.data.requests ?? [])
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load your requests')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Live socket: when doctor accepts, navigate straight to room
  useEffect(() => {
    if (!socket) return
    function onAccepted({ requestId, roomId }) {
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'ACCEPTED', roomId } : r))
      navigate(`/room/${roomId}`)
    }
    function onRejected({ requestId }) {
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'REJECTED' } : r))
    }
    function onCancelled({ requestId }) {
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'CANCELLED' } : r))
    }
    socket.on('teleconsultation-accepted', onAccepted)
    socket.on('teleconsultation-rejected', onRejected)
    socket.on('teleconsultation-cancelled', onCancelled)
    return () => {
      socket.off('teleconsultation-accepted', onAccepted)
      socket.off('teleconsultation-rejected', onRejected)
      socket.off('teleconsultation-cancelled', onCancelled)
    }
  }, [socket, navigate])

  const today       = requests.filter(r => isToday(r.createdAt))
  const pending     = requests.filter(r => r.status === 'CREATED')
  const accepted    = requests.filter(r => r.status === 'ACCEPTED')
  const todayAccepted = today.filter(r => r.status === 'ACCEPTED')

  const filtered = requests.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.patient?.name?.toLowerCase().includes(q) ||
      r.doctor?.name?.toLowerCase().includes(q)  ||
      r.reason?.toLowerCase().includes(q)
    )
  })

  return (
    <AppShell
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search requests, patients, doctors…"
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
            <h1 className="page-title">{greeting()}, {user?.name}</h1>
            <p className="page-subtitle">
              {roleLabel(user?.role)} · {pending.length} pending · {accepted.length} accepted
            </p>
          </div>
          <div className="page-actions">
            <button className="btn btn-outline btn-sm" onClick={load}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/teleconsultations/new')}>
              <Plus size={14} /> New Teleconsultation
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Stat Cards ── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label"><Hourglass size={12} /> Pending</div>
          <div className="stat-value warning">{pending.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><CheckCircle2 size={12} /> Accepted Today</div>
          <div className="stat-value success">{todayAccepted.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Video size={12} /> Total Requests</div>
          <div className="stat-value">{requests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Users size={12} /> Today's Activity</div>
          <div className="stat-value">{today.length}</div>
        </div>
      </div>

      {/* ── Active Accepted Rooms ── */}
      {accepted.length > 0 && (
        <div className="section">
          <div className="section-title"><Video size={14} color="var(--brand)" /> Active Rooms</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {accepted.map(r => (
              <div key={r.id} className="card" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{r.patient?.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Dr. {r.doctor?.name}</div>
                </div>
                <button className="btn btn-success btn-sm" onClick={() => navigate(`/room/${r.roomId}`)}>
                  <Video size={12} /> Rejoin
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── All Requests List ── */}
      <div className="section">
        <div className="section-title">
          <XCircle size={14} color="var(--text-muted)" /> All My Requests
          <span className="section-subtitle">{filtered.length} records</span>
        </div>

        {loading ? (
          <div className="loading-center"><span className="spinner" /> Loading requests…</div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <div className="card-empty">
              📋 No teleconsultation requests yet.<br />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/teleconsultations/new')}>
                <Plus size={12} /> Create your first request
              </button>
            </div>
          </div>
        ) : (
          <div className="queue-list">
            {filtered.map(r => (
              <div key={r.id} className="request-card">
                <div className="avatar sm">{(r.patient?.name || '?')[0].toUpperCase()}</div>
                <div className="request-info">
                  <div className="request-patient">{r.patient?.name || 'Unknown patient'}</div>
                  <div className="request-meta">
                    Dr. {r.doctor?.name} · {r.doctor?.role}
                    · {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div className="request-reason">"{r.reason}"</div>
                </div>
                <div className="request-actions">
                  {statusBadge(r.status)}
                  {r.status === 'ACCEPTED' && r.roomId && (
                    <button className="btn btn-success btn-sm" onClick={() => navigate(`/room/${r.roomId}`)}>
                      <Video size={12} /> Join
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
