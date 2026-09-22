import { useState } from 'react'
import { X, HeartPulse } from 'lucide-react'
import { recordVitals } from '../services/api'

export default function VitalsModal({ patientId, encounterId, onClose, onSaved }) {
  const [formData, setFormData] = useState({
    bloodPressureSystolic: '',
    bloodPressureDiastolic: '',
    heartRate: '',
    oxygenSaturation: '',
    temperature: '',
    weight: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function handleChange(e) {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    
    // Check if at least one field is filled
    if (!Object.values(formData).some(val => val !== '')) {
      setError('Please fill at least one vital sign.')
      return
    }

    setLoading(true)
    try {
      const payload = { patientId, encounterId }
      for (const [k, v] of Object.entries(formData)) {
        if (v) payload[k] = Number(v)
      }
      await recordVitals(payload)
      setSuccess('Vitals recorded successfully!')
      setTimeout(() => {
        onSaved()
        onClose()
      }, 1000)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record vitals')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <div className="modal-header">
          <h2><HeartPulse size={20} /> Record Vitals</h2>
          <button className="btn btn-ghost" onClick={onClose}><X size={20} /></button>
        </div>
        
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="modal-grid">
            <div className="form-group">
              <label className="form-label">BP Systolic</label>
              <input type="number" name="bloodPressureSystolic" className="form-control" placeholder="120" value={formData.bloodPressureSystolic} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">BP Diastolic</label>
              <input type="number" name="bloodPressureDiastolic" className="form-control" placeholder="80" value={formData.bloodPressureDiastolic} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Heart Rate (bpm)</label>
              <input type="number" name="heartRate" className="form-control" placeholder="72" value={formData.heartRate} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">SpO2 (%)</label>
              <input type="number" name="oxygenSaturation" className="form-control" placeholder="98" value={formData.oxygenSaturation} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Temperature (°C)</label>
              <input type="number" name="temperature" className="form-control" placeholder="37.0" step="0.1" value={formData.temperature} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Weight (kg)</label>
              <input type="number" name="weight" className="form-control" placeholder="65" step="0.1" value={formData.weight} onChange={handleChange} />
            </div>
          </div>
          
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Vitals'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
