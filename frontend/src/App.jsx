// Shared - Phase 2 - App.jsx - Routes + auth guards

import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { authStore, useUser } from './utils/auth'
import { getToken } from './utils/api'
import { canCreateWorkflow, canViewReports, canViewAudit, canEditWorkflow, canEditForm, canCreateForm, canManageUsers, canManageDocuments, isSuperAdmin, isTenantShell, isOrgAdmin, canViewTeam } from './utils/permissions'

// Self-registration disabled — admins create users via the Admin Panel.
// import Register from './pages/Register'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Business from './pages/Bussiness/index'
import DocumentsDashboard from './pages/DocumentsDashboard'
import S3Dashboard from './pages/S3Dashboard'
import AdminPanel from './pages/AdminPanel'
import Team from './pages/Team'
import Departments from './pages/Departments'
import RolesPermissions from './pages/RolesPermissions'
import OrgSettings from './pages/OrgSettings'
import Billing from './pages/Billing'
import Workflows from './pages/Workflows'
import NewWorkflow from './pages/NewWorkflow'
import Forms from './pages/Forms'
import NewForm from './pages/NewForm'
import FillForm from './pages/FillForm'
import FormResponses from './pages/FormResponses'
import PublicForm from './pages/PublicForm'
import OAuthCallback from './pages/OAuthCallback'
import TaskInbox from './pages/TaskInbox'
import TaskDetail from './pages/TaskDetail'
import Analytics from './pages/Analytics'
import AuditLog from './pages/AuditLog'
import Notifications from './pages/Notifications'
import Profile from './pages/Profile'
import PlatformPanel from './pages/PlatformPanel'
import PlatformActivity from './pages/PlatformActivity'
import PlatformHealth from './pages/PlatformHealthIntegrated'
import PlatformUsage from './pages/PlatformUsage'
import PlatformPlans from './pages/PlatformPlans'
import PlatformAdmins from './pages/PlatformAdmins'
import ChangePassword from './pages/ChangePassword'
import DocumentAssistedForm from './pages/DocumentAssistedForm'
import StartupSplash from './pages/startup_splash/StartupSplash'
import Toaster from './components/Toaster'
import ConfirmDialog from './components/ConfirmDialog'
import UserGuideHost from './components/UserGuideHost'
import { toast } from './lib/toastStore'

// Users flagged mustChangePassword (e.g. a freshly provisioned org admin) are
// held on /change-password until they set a real password.
function needsPasswordChange(user, location) {
  return Boolean(user?.mustChangePassword) && location.pathname !== '/change-password'
}

function RequireAuth({ children }) {
  const user = useUser()
  const location = useLocation()
  const token = getToken()
  if (!token || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (needsPasswordChange(user, location)) {
    return <Navigate to="/change-password" replace />
  }
  return children
}

function AccessDeniedRedirect({ message = 'You do not have access to that page.' }) {
  useEffect(() => {
    toast.info(message)
  }, [message])
  return <Navigate to="/dashboard" replace />
}

// Requires auth AND a role check. Logged-out users go to /login; logged-in
// users who fail the role check (e.g. an Employee hitting /workflows) are
// bounced back to their dashboard. Mirrors the nav-visibility rules.
function RequireRole({ can, children }) {
  const user = useUser()
  const location = useLocation()
  const token = getToken()
  if (!token || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (needsPasswordChange(user, location)) {
    return <Navigate to="/change-password" replace />
  }
  if (typeof can === 'function' && !can(user)) {
    return <AccessDeniedRedirect />
  }
  return children
}

// Workspace pages (forms, requests, reports, user admin) belong to a tenant.
// Platform staff have no workspace, so they land back on the platform console
// instead of an empty or borrowed org. The API refuses the same calls.
function RequireTenant({ children }) {
  return <RequireRole can={isTenantShell}>{children}</RequireRole>
}

function RequireDms({ children }) {
  const user = useUser()
  const location = useLocation()
  const token = getToken()
  if (!token || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (needsPasswordChange(user, location)) {
    return <Navigate to="/change-password" replace />
  }
  if (!canManageDocuments(user)) {
    return <AccessDeniedRedirect />
  }
  if (user.dmsEnabled === false) {
    return <AccessDeniedRedirect message="Document management is not enabled for this workspace." />
  }
  return children
}

function RequireS3({ children }) {
  const user = useUser()
  const location = useLocation()
  const token = getToken()
  if (!token || !user) return <Navigate to="/login" replace state={{ from: location }} />
  if (needsPasswordChange(user, location)) return <Navigate to="/change-password" replace />
  if (!canManageDocuments(user)) return <AccessDeniedRedirect />
  if (user.s3Enabled === false) return <AccessDeniedRedirect message="S3 storage is not enabled for this workspace." />
  return children
}

function PublicOnly({ children }) {
  const user = useUser()
  const token = getToken()
  if (token && user) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

function AuthenticatedTourHost() {
  const user = useUser()
  const location = useLocation()
  const token = getToken()
  if (!token || !user) return null
  if (user.mustChangePassword) return null
  // Public / auth screens never show the application demo overlay.
  if (
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/forgot-password') ||
    location.pathname.startsWith('/reset-password') ||
    location.pathname.startsWith('/change-password') ||
    location.pathname.startsWith('/f/') ||
    location.pathname.startsWith('/oauth/')
  ) {
    return null
  }
  return <UserGuideHost />
}

const STARTUP_SPLASH_MIN_MS = 1000
const STARTUP_SPLASH_COMPLETE_HOLD_MS = 200

function App() {
  const [ready, setReady] = useState(() => !getToken())
  const [minimumSplashElapsed, setMinimumSplashElapsed] = useState(false)
  const [estimatedProgress, setEstimatedProgress] = useState(0)
  const [splashDismissed, setSplashDismissed] = useState(false)
  const refreshInFlight = useRef(false)
  const startupComplete = ready && minimumSplashElapsed

  useEffect(() => {
    // Show the splash on each full page load, not on client-side navigation.
    // Progress is a visual estimate; only the real session check can unlock 100%.
    const startedAt = performance.now()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let progressFrame
    const advanceProgress = (now) => {
      if (reducedMotion.matches) return
      // The first frame timestamp can slightly precede this effect's start.
      const elapsed = Math.max(0, now - startedAt)
      const progress = Math.min(90, Math.floor(elapsed / STARTUP_SPLASH_MIN_MS * 90))
      setEstimatedProgress(progress)
      if (progress < 90) progressFrame = window.requestAnimationFrame(advanceProgress)
    }
    if (!reducedMotion.matches) progressFrame = window.requestAnimationFrame(advanceProgress)

    const splashTimer = window.setTimeout(() => {
      window.cancelAnimationFrame(progressFrame)
      setEstimatedProgress(90)
      setMinimumSplashElapsed(true)
    }, STARTUP_SPLASH_MIN_MS)
    return () => {
      window.clearTimeout(splashTimer)
      window.cancelAnimationFrame(progressFrame)
    }
  }, [])

  useEffect(() => {
    if (!startupComplete) return
    // Keep the completed bar visible briefly before rendering the destination.
    const completionTimer = window.setTimeout(() => setSplashDismissed(true), STARTUP_SPLASH_COMPLETE_HOLD_MS)
    return () => window.clearTimeout(completionTimer)
  }, [startupComplete])

  useEffect(() => {
    // On boot, if we have a token try to refresh user info. This kicks invalid
    // tokens out via the /api wrapper's 401 redirect.
    const token = getToken()
    if (token) {
      authStore.refresh().finally(() => setReady(true))
    }
  }, [])

  useEffect(() => {
    const refreshAccess = () => {
      if (!getToken() || document.visibilityState === 'hidden' || refreshInFlight.current) return
      refreshInFlight.current = true
      authStore.refresh({ preserveOnError: true }).finally(() => {
        refreshInFlight.current = false
      })
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshAccess()
    }
    window.addEventListener('focus', refreshAccess)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshAccess)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  if (!splashDismissed) {
    return <StartupSplash progress={startupComplete ? 100 : estimatedProgress} />
  }

  return (
    <BrowserRouter>
      <Toaster />
      <ConfirmDialog />
      {/* Tour lives at app root so it survives Form/Workflow builders (no AppShell). */}
      <AuthenticatedTourHost />
      <Routes>
        <Route path="/" element={<Business />} />
        {/* Self-registration disabled — only admins create users via the Admin Panel.
            /register now falls through to the catch-all below and redirects to /login. */}
        {/* <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} /> */}
        <Route path="/login"    element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/business"        element={<Business />} />
        
        {/* Public (unauthenticated) form links — collect data from non-users */}
        <Route path="/f/:token" element={<PublicForm />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />

        <Route path="/dashboard"     element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/documents"     element={<RequireDms><DocumentsDashboard /></RequireDms>} />
        <Route path="/s3-storage"    element={<RequireS3><S3Dashboard /></RequireS3>} />
        <Route path="/forms"          element={<RequireTenant><Forms /></RequireTenant>} />
        <Route path="/forms/new"      element={<RequireRole can={canCreateForm}><NewForm /></RequireRole>} />
        <Route path="/forms/pdf-autofill" element={<RequireRole can={canCreateForm}><DocumentAssistedForm /></RequireRole>} />
        <Route path="/forms/:id/fill" element={<RequireTenant><FillForm /></RequireTenant>} />
        <Route path="/forms/:id/responses" element={<RequireRole can={canCreateForm}><FormResponses /></RequireRole>} />
        <Route path="/tasks"         element={<RequireTenant><TaskInbox /></RequireTenant>} />
        <Route path="/tasks/:id"     element={<RequireTenant><TaskDetail /></RequireTenant>} />
        <Route path="/analytics"     element={<RequireRole can={canViewReports}><Analytics /></RequireRole>} />
        <Route path="/audit-log"     element={<RequireRole can={canViewAudit}><AuditLog /></RequireRole>} />
        <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
        <Route path="/profile"       element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />
        <Route path="/workflows"          element={<RequireRole can={canCreateWorkflow}><Workflows /></RequireRole>} />
        <Route path="/workflows/new"      element={<RequireRole can={canCreateWorkflow}><NewWorkflow /></RequireRole>} />
        <Route path="/workflows/:id/edit" element={<RequireRole can={canEditWorkflow}><NewWorkflow /></RequireRole>} />
        <Route path="/forms/:id/edit"     element={<RequireRole can={canEditForm}><NewForm /></RequireRole>} />
        <Route path="/admin"         element={<RequireRole can={canManageUsers}><AdminPanel /></RequireRole>} />
        {/* Shell 3 — a leader operating: the people they answer for */}
        <Route path="/team"          element={<RequireRole can={canViewTeam}><Team /></RequireRole>} />
        {/* Shell 2 — configuring the workspace itself, Org Admin only */}
        <Route path="/departments"   element={<RequireRole can={canManageUsers}><Departments /></RequireRole>} />
        <Route path="/roles"         element={<RequireRole can={canManageUsers}><RolesPermissions /></RequireRole>} />
        <Route path="/settings"      element={<RequireRole can={isOrgAdmin}><OrgSettings /></RequireRole>} />
        <Route path="/billing"       element={<RequireRole can={isOrgAdmin}><Billing /></RequireRole>} />
        <Route path="/platform"      element={<RequireRole can={isSuperAdmin}><PlatformPanel /></RequireRole>} />
        <Route path="/usage"         element={<RequireRole can={isSuperAdmin}><PlatformUsage /></RequireRole>} />
        <Route path="/activity"      element={<RequireRole can={isSuperAdmin}><PlatformActivity /></RequireRole>} />
        <Route path="/health"        element={<RequireRole can={isSuperAdmin}><PlatformHealth /></RequireRole>} />
        <Route path="/plans"         element={<RequireRole can={isSuperAdmin}><PlatformPlans /></RequireRole>} />
        <Route path="/admins"        element={<RequireRole can={isSuperAdmin}><PlatformAdmins /></RequireRole>} />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
