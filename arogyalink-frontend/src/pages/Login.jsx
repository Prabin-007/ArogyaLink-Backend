import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { loginUser } from '../services/api'

const ROLES = ['ASHA', 'ANM', 'DOCTOR', 'SPECIALIST']

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!identifier.trim() || !password.trim()) {
      setError('Please enter your ID and password.')
      return
    }
    setLoading(true)
    try {
      const res = await loginUser({ identifier: identifier.trim(), password })
      const { token, user } = res.data.data ?? res.data
      login(user, token)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-icon" style={{ width: 44, height: 44, borderRadius: 10, fontSize: 22 }}>🏥</div>
          <div>
            <div className="auth-title">ArogyaLink</div>
            <div className="auth-subtitle">Rural Health Teleconsultation Portal</div>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Staff ID / Phone / Email</label>
            <input
              className="form-control"
              placeholder="e.g. ASHA-2024-001 or doctor@phc.gov"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-control"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? <><span className="spinner sm" /> Signing in…</> : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: '14px', background: 'var(--bg)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text-muted)' }}>ROLES IN THIS SYSTEM</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ROLES.map(r => (
              <span key={r} className={`badge badge-${r.toLowerCase()}`}>{r}</span>
            ))}
          </div>
          <div style={{ marginTop: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            ASHA/ANM workers request teleconsultations for patients.<br/>
            Doctors &amp; Specialists accept and conduct the video call.
          </div>
        </div>
      </div>
    </div>
  )
}
