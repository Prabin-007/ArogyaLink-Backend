import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Video, Users, Stethoscope, Clock, UserPlus, PhoneCall, ClipboardList } from 'lucide-react'
import { fetchTeleconsultDoctors } from '../services/api'

export default function GuestDashboard() {
  const navigate = useNavigate()
  const [doctors, setDoctors] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchTeleconsultDoctors()
      .then(res => setDoctors(res.data.data?.doctors ?? res.data.doctors ?? []))
      .catch(() => setError('Could not load doctors at this moment.'))
  }, [])

  return (
    <div className="guest-page">
      <nav className="guest-nav">
        <div className="guest-nav-brand">
          <div className="logo-icon">🏥</div>
          <div className="logo-title" style={{ fontSize: 18 }}>ArogyaLink</div>
        </div>
        <button className="btn btn-outline" onClick={() => navigate('/login')}>
          Staff / Doctor Login
        </button>
      </nav>

      <section className="guest-hero">
        <h1>Rural Health Teleconsultation Platform</h1>
        <p>Connecting ASHA workers and rural patients with specialized healthcare professionals through high-quality video consultations in their native languages.</p>
        <button className="btn btn-primary btn-lg" onClick={() => navigate('/login')}>
          Get Started → Login
        </button>
      </section>

      <section className="guest-section">
        <div className="stat-grid guest-metrics">
          <div className="stat-card">
            <div className="stat-label"><Video size={14} /> Total Teleconsultations</div>
            <div className="stat-value">1,247</div>
          </div>
          <div className="stat-card">
            <div className="stat-label"><Users size={14} /> Active Field Staff</div>
            <div className="stat-value">86</div>
          </div>
          <div className="stat-card">
            <div className="stat-label"><Stethoscope size={14} /> Active Doctors</div>
            <div className="stat-value">34</div>
          </div>
          <div className="stat-card">
            <div className="stat-label"><Clock size={14} /> Avg Response Time</div>
            <div className="stat-value">4.2 min</div>
          </div>
        </div>
      </section>

      <section className="guest-section">
        <h2 className="guest-section-title">How Teleconsultation Works</h2>
        <p className="guest-section-sub">A seamless flow from village registration to specialist prescription</p>
        
        <div className="guest-steps">
          <div className="guest-step-card">
            <div className="guest-step-num"><UserPlus size={18} /></div>
            <h3>Step 1</h3>
            <p>ASHA/ANM registers patient in their village.</p>
          </div>
          <div className="guest-step-card">
            <div className="guest-step-num"><Video size={18} /></div>
            <h3>Step 2</h3>
            <p>Request teleconsultation with a specialist.</p>
          </div>
          <div className="guest-step-card">
            <div className="guest-step-num"><PhoneCall size={18} /></div>
            <h3>Step 3</h3>
            <p>Doctor accepts & video call begins.</p>
          </div>
          <div className="guest-step-card">
            <div className="guest-step-num"><ClipboardList size={18} /></div>
            <h3>Step 4</h3>
            <p>Prescription & follow-up recorded seamlessly.</p>
          </div>
        </div>
      </section>

      <section className="guest-section">
        <h2 className="guest-section-title">Find Doctors</h2>
        <p className="guest-section-sub">Our verified medical professionals ready to assist</p>
        
        {error ? (
          <div className="alert alert-error">{error}</div>
        ) : (
          <div className="doctor-grid guest-doctors">
            {doctors.map(doc => (
              <div key={doc.id} className="doctor-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="avatar">{doc.name[0]}</div>
                  <div>
                    <div className="doctor-card-name">{doc.name}</div>
                    <div className="doctor-card-role">{doc.role}</div>
                  </div>
                </div>
                <div className="doctor-card-meta">ID: {doc.id.slice(0, 8)}...</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="guest-footer">
        © 2026 ArogyaLink — Rural Health Teleconsultation Platform
      </footer>
    </div>
  )
}
