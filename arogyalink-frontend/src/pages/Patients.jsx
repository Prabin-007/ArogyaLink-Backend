import { useEffect, useState } from 'react'
import { Users, Search, RefreshCw, MapPin, Phone, Calendar } from 'lucide-react'
import { fetchPatients } from '../services/api'
import AppShell from '../components/AppShell'

function calcAge(dob) {
  if (!dob) return '—'
  return `${new Date().getFullYear() - new Date(dob).getFullYear()} yrs`
}

export default function Patients() {
  const [patients, setPatients] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetchPatients()
      setPatients(res.data.data?.patients ?? res.data.patients ?? [])
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load patients')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = patients.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name?.toLowerCase().includes(q) ||
           p.village?.toLowerCase().includes(q) ||
           p.district?.toLowerCase().includes(q) ||
           p.phone?.includes(q)
  })

  return (
    <AppShell
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search patients by name, village, phone…"
    >
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <div className="page-eyebrow"><Users size={12} /> Patients</div>
            <h1 className="page-title">Patient Registry</h1>
            <p className="page-subtitle">{filtered.length} of {patients.length} patients</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading patients…</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="card-empty">📋 No patients found.</div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Gender / Age</th>
                <th><MapPin size={11} style={{ verticalAlign: -1 }} /> Location</th>
                <th><Phone size={11} style={{ verticalAlign: -1 }} /> Phone</th>
                <th><Calendar size={11} style={{ verticalAlign: -1 }} /> Registered</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar sm">{(p.name || '?')[0]}</div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.id.slice(0, 8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td>{p.gender} · {calcAge(p.dateOfBirth)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {p.village}, {p.district}<br/>
                    <span style={{ fontSize: 11 }}>{p.state}</span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.phone || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(p.createdAt).toLocaleDateString('en-IN')}
                  </td>
                  <td>
                    <span className={`badge ${p.syncId ? 'badge-accepted' : 'badge-created'}`}>
                      {p.syncId ? 'Synced' : 'Local'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  )
}
