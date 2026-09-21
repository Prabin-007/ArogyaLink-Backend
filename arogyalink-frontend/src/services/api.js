import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001'
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('al_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginUser  = data => api.post('/api/auth/login', data)
export const fetchMe    = ()   => api.get('/api/auth/me')

// ── Patients ──────────────────────────────────────────────────────────────────
export const fetchPatients     = (params) => api.get('/api/patients', { params })
export const fetchPatient      = id       => api.get(`/api/patients/${id}`)
export const createPatient     = data     => api.post('/api/patients', data)

// ── Encounters ────────────────────────────────────────────────────────────────
export const fetchEncounters   = (patientId) => api.get('/api/encounters', { params: { patientId } })

// ── Teleconsultations ─────────────────────────────────────────────────────────
export const createTeleconsult   = data => api.post('/api/teleconsultations', data)
export const fetchMyTeleconsults = ()   => api.get('/api/teleconsultations/mine')
export const fetchIncoming       = (status = 'CREATED') =>
  api.get(`/api/teleconsultations/incoming${status === 'all' ? '?status=all' : ''}`)
export const acceptTeleconsult   = id  => api.patch(`/api/teleconsultations/${id}/accept`)
export const rejectTeleconsult   = id  => api.patch(`/api/teleconsultations/${id}/reject`)
export const cancelTeleconsult   = id  => api.patch(`/api/teleconsultations/${id}/cancel`)
export const completeTeleconsult = id  => api.patch(`/api/teleconsultations/${id}/complete`)

// ── Doctor directory ──────────────────────────────────────────────────────────
export const fetchTeleconsultDoctors = (role) =>
  api.get('/api/teleconsult-doctors', { params: role ? { role } : {} })
export const fetchTeleconsultDoctor  = id => api.get(`/api/teleconsult-doctors/${id}`)

export default api
