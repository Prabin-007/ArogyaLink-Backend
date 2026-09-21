import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope, RefreshCw, Video } from 'lucide-react'
import { fetchTeleconsultDoctors } from '../services/api'
import AppShell from '../components/AppShell'

export default function DoctorDirectory() {
  const navigate = useNavigate()
  const [doctors, setDoctors]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetchTeleconsultDoctors()
      setDoctors(res.data.data?.doctors ?? res.data.doctors ?? [])
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load doctors')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = doctors.filter(d => {
    const matchRole = roleFilter === 'ALL' || d.role === roleFilter
    if (!search) return matchRole
    const q = search.toLowerCase()
    return matchRole && (
      d.name?.toLowerCase().includes(q) ||
      d.identifier?.toLowerCase().includes(q) ||
      d.phone?.includes(q)
    )
  })

  const specialists = doctors.filter(d => d.role === 'SPECIALIST').length
  const phcDoctors  = doctors.filter(d => d.role === 'DOCTOR').length

  return (
    <AppShell
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by name, ID, phone…"
    >
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <div className="page-eyebrow"><Stethoscope size={12} /> Doctor Directory</div>
            <h1 className="page-title">Doctors & Specialists</h1>
            <p className="page-subtitle">Available for teleconsultation</p>
          </div>
          <div className="page-actions">
            <button className="btn btn-outline btn-sm" onClick={load}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/teleconsultations/new')}>
              <Video size={14} /> New Teleconsultation
            </button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Total Available</div>
          <div className="stat-value">{doctors.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PHC Doctors</div>
          <div className="stat-value">{phcDoctors}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Specialists</div>
          <div className="stat-value">{specialists}</div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Role filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {['ALL', 'DOCTOR', 'SPECIALIST'].map(r => (
          <button
            key={r}
            className={`btn btn-sm ${roleFilter === r ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setRoleFilter(r)}
          >
            {r === 'ALL' ? 'All' : r === 'DOCTOR' ? 'PHC Doctors' : 'Specialists'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="doctor-grid">
          {filtered.map(d => (
            <div key={d.id} className="doctor-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="avatar" style={{ width: 44, height: 44, fontSize: 17 }}>
                  {(d.name || '?')[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="doctor-card-name">{d.name}</div>
                  <span className={`badge badge-${d.role?.toLowerCase()}`}>{d.role}</span>
                </div>
              </div>
              <div className="doctor-card-meta">📋 {d.identifier}</div>
              <div className="doctor-card-meta">📞 {d.phone}</div>
              <div className="doctor-card-meta" style={{ fontSize: 11 }}>
                Active since {new Date(d.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
              </div>
              <button
                className="btn btn-primary btn-block btn-sm"
                onClick={() => navigate('/teleconsultations/new', { state: { preselectedDoctor: d } })}
              >
                <Video size={12} /> Request Consultation
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1' }}>
              <div className="card"><div className="card-empty">No doctors found matching your search.</div></div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
