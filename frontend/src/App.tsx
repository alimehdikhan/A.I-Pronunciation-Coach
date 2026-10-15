import { ArrowClockwiseIcon, CompassIcon, WarningOctagonIcon } from '@phosphor-icons/react'
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Link, useRouteError } from 'react-router'
import { EmptyState } from '@/components/common'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import PracticePage from '@/pages/PracticePage'

const AuthPage = lazy(() => import('@/pages/AuthPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const CoachPage = lazy(() => import('@/pages/CoachPage'))

const DrillsPage = lazy(() => import('@/pages/DrillsPage'))
const SoundsPage = lazy(() => import('@/pages/SoundsPage'))
const ProgressPage = lazy(() => import('@/pages/ProgressPage'))

function RouteError() {
  const error = useRouteError() as Error | undefined
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <EmptyState
        icon={<WarningOctagonIcon weight="fill" />}
        title="Something went wrong"
        description={error?.message ?? 'An unexpected error occurred.'}
        action={
          <Button size="lg" onClick={() => window.location.reload()}>
            <ArrowClockwiseIcon weight="bold" /> Reload
          </Button>
        }
      />
    </div>
  )
}

function NotFound() {
  return (
    <EmptyState
      icon={<CompassIcon weight="fill" />}
      title="Page not found"
      description="That page doesn’t exist."
      action={
        <Button asChild size="lg">
          <Link to="/">Go to Practice</Link>
        </Button>
      }
    />
  )
}

export const router = createBrowserRouter([
  // Sign-in pages sit outside the app shell: no sidebar, just the form.
  {
    errorElement: <RouteError />,
    children: [
      { path: 'login', element: <Suspense fallback={null}><AuthPage mode="login" /></Suspense> },
      { path: 'signup', element: <Suspense fallback={null}><AuthPage mode="signup" /></Suspense> },
    ],
  },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <PracticePage /> },
      { path: 'coach', element: <CoachPage /> },
      { path: 'drills', element: <DrillsPage /> },
      { path: 'sounds', element: <SoundsPage /> },
      { path: 'progress', element: <ProgressPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
