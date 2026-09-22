import { useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Video, Users, Stethoscope, ClipboardList,
  Bell, LogOut, Search, UserCheck, Activity, HeartPulse, FileText
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'

function initials(name = '') {
  return name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function roleColor(role) {
  const m = { ASHA: 'asha', ANM: 'anm', DOCTOR: 'doctor', SPECIALIST: 'specialist' }
  return m[role] || 'doctor'
}

function roleLabel(role) {
  const m = { ASHA: 'ASHA Worker', ANM: 'ANM', DOCTOR: 'PHC Doctor', SPECIALIST: 'Specialist', HOSPITAL_ADMIN: 'Hospital Admin', SYSTEM_ADMIN: 'System Admin' }
  return m[role] || role
}

const FIELD_NAV = [
  { icon: LayoutDashboard, label: 'Dashboard',        path: '/dashboard' },
  { icon: Video,           label: 'Teleconsultation', path: '/teleconsultations/new' },
  { icon: Users,           label: 'Patients',         path: '/patients' },
  { icon: Stethoscope,     label: 'Doctors',          path: '/doctors' },
  { icon: ClipboardList, label: 'Referrals',    path: '/referrals' },
  { icon: FileText,      label: 'Follow-ups',   path: '/follow-ups' },
  { icon: ClipboardList,   label: 'My Requests',      path: '/dashboard', disabled: false },
]

const DOCTOR_NAV = [
  { icon: LayoutDashboard, label: 'Dashboard',    path: '/dashboard' },
  { icon: Activity,        label: 'Live Queue',   path: '/dashboard' },
  { icon: Video,           label: 'Video Rooms',  path: '/dashboard' },
  { icon: Users,           label: 'Patients',     path: '/patients' },
  { icon: ClipboardList, label: 'Referrals',    path: '/referrals' },
  { icon: FileText,      label: 'Follow-ups',   path: '/follow-ups' },
  { icon: UserCheck,       label: 'My History',   path: '/dashboard' },
  { icon: HeartPulse,      label: 'Health Data',  path: '/dashboard', disabled: true },
]

export default function AppShell({ children, search, onSearchChange, searchPlaceholder = 'Search…', notificationCount = 0 }) {
  const { user, logout } = useAuth()
  const socket = useSocket()
  const navigate = useNavigate()
  const location = useLocation()

  const isDoctor = user?.role === 'DOCTOR' || user?.role === 'SPECIALIST'
  const navItems = isDoctor ? DOCTOR_NAV : FIELD_NAV

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">🏥</div>
          <div>
            <div className="logo-title">ArogyaLink</div>
            <div className="logo-sub">Teleconsultation</div>
          </div>
        </div>

        <div className="sidebar-section">Navigation</div>
        <nav className="sidebar-nav">
          {navItems.map(({ icon: Icon, label, path, disabled }) => {
            const active = location.pathname === path && label === 'Dashboard'
              ? true
              : location.pathname === path
            return (
              <button
                key={label}
                className={`nav-item${active ? ' active' : ''}`}
                disabled={disabled}
                title={disabled ? 'Coming soon' : undefined}
                onClick={() => !disabled && navigate(path)}
              >
                <Icon size={15} />
                {label}
                {label === 'Live Queue' && notificationCount > 0 && (
                  <span className="nav-badge">{notificationCount}</span>
                )}
                {label === 'Dashboard' && notificationCount > 0 && (
                  <span className="nav-badge">{notificationCount}</span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="avatar">{initials(user?.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
              <span className={`badge badge-${roleColor(user?.role)}`} style={{ marginTop: 2 }}>{roleLabel(user?.role)}</span>
            </div>
          </div>
          <button className="btn btn-outline btn-block btn-sm" onClick={logout}>
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-search">
            <Search size={14} color="var(--text-muted)" />
            <input
              placeholder={searchPlaceholder}
              value={search ?? ''}
              onChange={e => onSearchChange?.(e.target.value)}
            />
          </div>
          <div className="topbar-right">
            <div className="icon-btn" title="Notifications">
              <Bell size={15} />
              {notificationCount > 0 && <span className="dot" />}
            </div>
            <div className="avatar sm">{initials(user?.name)}</div>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  )
}
