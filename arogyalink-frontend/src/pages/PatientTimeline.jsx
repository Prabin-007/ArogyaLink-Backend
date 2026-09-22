import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Video, HeartPulse, Stethoscope, User, Calendar, MapPin, Phone } from 'lucide-react'
import { fetchPatient, fetchEncounters, fetchPatientTimeline } from '../services/api'
import AppShell from '../components/AppShell'
import VitalsModal from '../components/VitalsModal'

export default function PatientTimeline() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [patient, setPatient] = useState(null)
  const [encounters, setEncounters] = useState([])
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [showVitalsModal, setShowVitalsModal] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [pRes, eRes, tRes] = await Promise.all([
        fetchPatient(id),
        fetchEncounters(id),
        fetchPatientTimeline(id)
      ])
      setPatient(pRes.data.data?.patient ?? pRes.data.patient)
      setEncounters(eRes.data.data?.encounters ?? eRes.data.encounters ?? [])
      setTimeline(tRes.data.data?.timeline ?? tRes.data.timeline ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [id])

  if (loading) {
    return <AppShell><div className="loading-center"><span className="spinner" /> Loading timeline...</div></AppShell>
  }

  if (!patient) {
    return <AppShell><div className="alert alert-error">Patient not found</div></AppShell>
  }

  const age = patient.dateOfBirth ? `${new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear()} yrs` : '—'

  return (
    <AppShell>
      <div className="patient-header-card">
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>{patient.name[0]}</div>
        <div className="patient-header-info">
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>{patient.name}</h2>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={14}/> {patient.gender} · {age}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={14}/> {patient.village}, {patient.district}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={14}/> {patient.phone || 'N/A'}</span>
          </div>
        </div>
        <div className="patient-header-actions">
          <button className="btn btn-primary" onClick={() => navigate('/teleconsultations/new', { state: { preselectedPatient: patient } })}>
            <Video size={16} /> Initiate Teleconsultation
          </button>
          <button className="btn btn-outline" onClick={() => setShowVitalsModal(true)}>
            <HeartPulse size={16} /> Record Vitals
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h3 className="section-title"><Stethoscope size={16} /> Encounters</h3>
          {encounters.length === 0 ? (
            <div className="card-empty">No encounters yet.</div>
          ) : (
            encounters.map(enc => (
              <div key={enc.id} className="encounter-card">
                <div className="encounter-card-header">
                  <span className={`badge badge-${enc.type === 'TELECONSULTATION' ? 'specialist' : 'asha'}`}>{enc.type}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(enc.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 13 }}>
                  <strong>Doctor:</strong> {enc.doctor?.name || 'Unassigned'}<br/>
                  <strong>Symptoms:</strong> {enc.symptoms || 'None recorded'}<br/>
                  <strong>Notes:</strong> {enc.clinicalNotes || 'None'}
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <h3 className="section-title"><Calendar size={16} /> Clinical Timeline</h3>
          <div className="timeline-list">
            {timeline.length === 0 ? (
              <div className="card-empty">No events found.</div>
            ) : (
              timeline.map(ev => (
                <div key={ev.id} className="timeline-item">
                  <div className={`timeline-dot ${ev.eventType?.toLowerCase()}`}></div>
                  <div className="timeline-content">
                    <h4>{ev.title || ev.eventType}</h4>
                    <p>{ev.description}</p>
                    <div className="timeline-date">{new Date(ev.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showVitalsModal && (
        <VitalsModal 
          patientId={patient.id} 
          onClose={() => setShowVitalsModal(false)} 
          onSaved={loadData} 
        />
      )}
    </AppShell>
  )
}
