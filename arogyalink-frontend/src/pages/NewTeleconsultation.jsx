import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Video, ChevronLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { fetchTeleconsultDoctors, fetchPatients, createTeleconsult } from '../services/api'
import AppShell from '../components/AppShell'

const LANGUAGES = [
  { code: 'hi', label: 'Hindi' }, { code: 'mr', label: 'Marathi' },
  { code: 'bn', label: 'Bengali' }, { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' }, { code: 'en', label: 'English' }
]

export default function NewTeleconsultation() {
  const { user }  = useAuth()
  const navigate  = useNavigate()

  // Step 1: pick doctor, Step 2: pick patient + reason
  const [step, setStep]           = useState(1)
  const [doctors, setDoctors]     = useState([])
  const [patients, setPatients]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]     = useState(null)

  const [doctorSearch, setDoctorSearch]   = useState('')
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedDoctor, setSelectedDoctor] = useState(null)
  const [form, setForm] = useState({ patientId: '', reason: '', sourceLanguage: 'hi', targetLanguage: 'en' })

  useEffect(() => {
    Promise.all([
      fetchTeleconsultDoctors().catch(() => ({ data: { data: { doctors: [] } } })),
      fetchPatients().catch(() => ({ data: { data: { patients: [] } } }))
    ]).then(([dRes, pRes]) => {
      setDoctors(dRes.data.data?.doctors ?? dRes.data.doctors ?? [])
      setPatients(pRes.data.data?.patients ?? pRes.data.patients ?? [])
    }).catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [])

  const filteredDoctors = doctors.filter(d => {
    if (!doctorSearch) return true
    const q = doctorSearch.toLowerCase()
    return d.name?.toLowerCase().includes(q) || d.role?.toLowerCase().includes(q) || d.identifier?.toLowerCase().includes(q)
  })
  const filteredPatients = patients.filter(p => {
    if (!patientSearch) return true
    const q = patientSearch.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.village?.toLowerCase().includes(q) || p.phone?.includes(q)
  })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.patientId) return setError('Please select a patient')
    if (!form.reason.trim()) return setError('Please enter a reason for the consultation')
    setError(''); setSubmitting(true)
    try {
      const res = await createTeleconsult({
        patientId: form.patientId,
        doctorId: selectedDoctor.id,
        reason: form.reason.trim()
      })
      setSuccess(res.data.data?.request ?? res.data.request)
    } catch (e) {
      setError(e.response?.data?.message || 'Could not create request')
    } finally { setSubmitting(false) }
  }

  if (success) return (
    <AppShell>
      <div style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 60, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Request Sent!</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Dr. <strong>{selectedDoctor?.name}</strong> has been notified. You'll be redirected automatically when they accept.
        </p>
        <div className="card" style={{ textAlign: 'left', marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Request ID</div>
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{success.id}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 4 }}>Status</div>
          <span className="badge badge-created">{success.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-outline" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
          <button className="btn btn-primary" onClick={() => { setSuccess(null); setStep(1); setSelectedDoctor(null); setForm({ patientId: '', reason: '', sourceLanguage: 'hi', targetLanguage: 'en' }) }}>
            New Request
          </button>
        </div>
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {/* Header */}
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => step === 1 ? navigate('/dashboard') : setStep(1)}>
              <ChevronLeft size={16} /> {step === 1 ? 'Dashboard' : 'Back'}
            </button>
          </div>
          <h1 className="page-title"><Video size={20} style={{ verticalAlign: -4 }} /> New Teleconsultation</h1>
          <p className="page-subtitle">Connect a patient with a doctor or specialist via video call</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['Select Doctor', 'Patient & Reason'].map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: step > i + 1 ? 'var(--success)' : step === i + 1 ? 'var(--brand)' : 'var(--border)',
                color: step >= i + 1 ? '#fff' : 'var(--text-muted)'
              }}>{step > i + 1 ? '✓' : i + 1}</div>
              <span style={{ fontSize: 13, fontWeight: step === i + 1 ? 700 : 400, color: step === i + 1 ? 'var(--text)' : 'var(--text-muted)' }}>{label}</span>
              {i < 1 && <span style={{ color: 'var(--border)', padding: '0 4px' }}>›</span>}
            </div>
          ))}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ── Step 1: Pick Doctor ── */}
        {step === 1 && (
          <div>
            <div className="section-title">Available Doctors & Specialists</div>
            <div className="topbar-search" style={{ marginBottom: 16, maxWidth: '100%' }}>
              <Search size={14} color="var(--text-muted)" />
              <input placeholder="Search by name, role, ID…" value={doctorSearch} onChange={e => setDoctorSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%' }} />
            </div>

            {loading ? (
              <div className="loading-center"><span className="spinner" /> Loading doctors…</div>
            ) : (
              <div className="doctor-grid">
                {filteredDoctors.map(d => (
                  <div
                    key={d.id}
                    className="doctor-card"
                    style={{ cursor: 'pointer', borderColor: selectedDoctor?.id === d.id ? 'var(--brand)' : undefined, background: selectedDoctor?.id === d.id ? 'var(--brand-light)' : undefined }}
                    onClick={() => setSelectedDoctor(d)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar">{(d.name || '?')[0]}</div>
                      <div style={{ flex: 1 }}>
                        <div className="doctor-card-name">{d.name}</div>
                        <span className={`badge badge-${d.role?.toLowerCase()}`}>{d.role}</span>
                      </div>
                      {selectedDoctor?.id === d.id && <span style={{ color: 'var(--brand)', fontSize: 18 }}>✓</span>}
                    </div>
                    <div className="doctor-card-meta">ID: {d.identifier}</div>
                    <div className="doctor-card-meta" style={{ fontSize: 11 }}>
                      📞 {d.phone}
                    </div>
                  </div>
                ))}
                {filteredDoctors.length === 0 && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div className="card"><div className="card-empty">No doctors found</div></div>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary btn-lg"
                disabled={!selectedDoctor}
                onClick={() => { setError(''); setStep(2) }}
              >
                Next: Select Patient →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Patient & Reason ── */}
        {step === 2 && (
          <form onSubmit={handleSubmit}>
            {/* Selected doctor recap */}
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div className="avatar">{(selectedDoctor?.name || '?')[0]}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{selectedDoctor?.name}</div>
                <span className={`badge badge-${selectedDoctor?.role?.toLowerCase()}`}>{selectedDoctor?.role}</span>
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setStep(1)}>
                Change Doctor
              </button>
            </div>

            {/* Patient selection */}
            <div className="form-group">
              <label className="form-label">Select Patient *</label>
              <div className="topbar-search" style={{ marginBottom: 8, maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px' }}>
                <Search size={14} color="var(--text-muted)" />
                <input placeholder="Search patient by name, village, phone…" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%' }} />
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {filteredPatients.length === 0 ? (
                  <div className="card-empty" style={{ padding: 20 }}>No patients found. <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/patients')}>Register one</button></div>
                ) : filteredPatients.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setForm(f => ({ ...f, patientId: p.id }))}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                      background: form.patientId === p.id ? 'var(--brand-light)' : undefined,
                      borderBottom: '1px solid var(--border)'
                    }}
                  >
                    <div className="avatar sm">{(p.name || '?')[0]}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.village}, {p.district} · {p.gender}</div>
                    </div>
                    {form.patientId === p.id && <span style={{ color: 'var(--brand)', fontWeight: 700 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div className="form-group">
              <label className="form-label">Reason for Consultation *</label>
              <textarea
                className="form-control"
                placeholder="Describe the patient's symptoms or reason for referral (e.g. 'High fever for 3 days, suspected malaria')"
                rows={3}
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>

            {/* Language pair for Bhashini */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Patient's Language (Bhashini ASR)</label>
                <select className="form-control" value={form.sourceLanguage} onChange={e => setForm(f => ({ ...f, sourceLanguage: e.target.value }))}>
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <div className="form-hint">Language the patient speaks during the call</div>
              </div>
              <div className="form-group">
                <label className="form-label">Doctor's Language (Bhashini TTS)</label>
                <select className="form-control" value={form.targetLanguage} onChange={e => setForm(f => ({ ...f, targetLanguage: e.target.value }))}>
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <div className="form-hint">Language for the translated speech output</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setStep(1)}>← Back</button>
              <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || !form.patientId || !form.reason.trim()}>
                {submitting ? <><span className="spinner sm" /> Sending…</> : <><Video size={14} /> Request Teleconsultation</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  )
}
