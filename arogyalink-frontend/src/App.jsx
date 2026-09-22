import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DoctorDashboard from './pages/DoctorDashboard'
import TeleconsultationRoom from './pages/TeleconsultationRoom'
import Patients from './pages/Patients'
import DoctorDirectory from './pages/DoctorDirectory'
import NewTeleconsultation from './pages/NewTeleconsultation'
import GuestDashboard from './pages/GuestDashboard'
import PatientTimeline from './pages/PatientTimeline'
import Referrals from './pages/Referrals'
import FollowUps from './pages/FollowUps'

function ProtectedRoute({ children, roles }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <GuestDashboard />} />
      <Route path="/guest" element={<GuestDashboard />} />

      {/* Shared dashboard — role-aware */}
      <Route path="/dashboard" element={
        <ProtectedRoute>
          {user?.role === 'DOCTOR' || user?.role === 'SPECIALIST'
            ? <DoctorDashboard />
            : <Dashboard />}
        </ProtectedRoute>
      } />

      {/* ASHA/ANM/DOCTOR requester flow */}
      <Route path="/teleconsultations/new" element={
        <ProtectedRoute roles={['ASHA','ANM','DOCTOR','SPECIALIST']}>
          <NewTeleconsultation />
        </ProtectedRoute>
      } />

      {/* Video call room */}
      <Route path="/room/:roomId" element={
        <ProtectedRoute>
          <TeleconsultationRoom />
        </ProtectedRoute>
      } />

      {/* Patient list */}
      <Route path="/patients" element={
        <ProtectedRoute>
          <Patients />
        </ProtectedRoute>
      } />

      {/* Patient clinical timeline */}
      <Route path="/patients/:id/timeline" element={
        <ProtectedRoute>
          <PatientTimeline />
        </ProtectedRoute>
      } />

      {/* Referrals management */}
      <Route path="/referrals" element={
        <ProtectedRoute>
          <Referrals />
        </ProtectedRoute>
      } />

      {/* Follow-ups management */}
      <Route path="/follow-ups" element={
        <ProtectedRoute>
          <FollowUps />
        </ProtectedRoute>
      } />

      {/* Doctor directory */}
      <Route path="/doctors" element={
        <ProtectedRoute>
          <DoctorDirectory />
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
