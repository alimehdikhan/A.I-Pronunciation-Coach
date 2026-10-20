import { ArrowClockwiseIcon, CompassIcon, WarningOctagonIcon } from '@phosphor-icons/react'
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Link, Navigate, useRouteError } from 'react-router'
import { EmptyState } from '@/components/common'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import PracticePage from '@/pages/PracticePage'

const AuthPage = lazy(() => import('@/pages/AuthPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const CoachPage = lazy(() => import('@/pages/CoachPage'))
const JourneyPage = lazy(() => import('@/pages/JourneyPage'))
const CheckupPage = lazy(() => import('@/pages/CheckupPage'))

const DrillsPage = lazy(() => import('@/pages/DrillsPage'))
const SoundsPage = lazy(() => import('@/pages/SoundsPage'))
const ProgressPage = lazy(() => import('@/pages/ProgressPage'))
const SpeakPage = lazy(() => import('@/pages/SpeakPage'))
const InterviewPage = lazy(() => import('@/pages/InterviewPage'))
const BaselinePage = lazy(() => import('@/pages/BaselinePage'))
const SharedPage = lazy(() => import('@/pages/SharedPage'))
const ForgotPage = lazy(() => import('@/pages/ResetPage').then((m) => ({ default: m.ForgotPage })))
const ResetPage = lazy(() => import('@/pages/ResetPage').then((m) => ({ default: m.ResetPage })))
const HomePage = lazy(() => import('@/pages/HomePage'))
const PrivacyPage = lazy(() => import('@/pages/LegalPages').then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import('@/pages/LegalPages').then((m) => ({ default: m.TermsPage })))
const AboutPage = lazy(() => import('@/pages/LegalPages').then((m) => ({ default: m.AboutPage })))
const HelpPage = lazy(() => import('@/pages/HelpPage').then((m) => ({ default: m.HelpPage })))

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
          <Link to="/practice">Go to Practice</Link>
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
      // A teacher opens a shared attempt without an account, so it sits outside the app too.
      { path: 'shared/:token', element: <Suspense fallback={null}><SharedPage /></Suspense> },
      { path: 'forgot', element: <Suspense fallback={null}><ForgotPage /></Suspense> },
      { path: 'reset', element: <Suspense fallback={null}><ResetPage /></Suspense> },
      // The public home page; the app itself starts at /practice.
      { index: true, element: <Suspense fallback={null}><HomePage /></Suspense> },
      { path: 'welcome', element: <Navigate to="/" replace /> },
      // Readable before signing in or onboarding, so they sit outside the app shell.
      { path: 'privacy', element: <Suspense fallback={null}><PrivacyPage /></Suspense> },
      { path: 'terms', element: <Suspense fallback={null}><TermsPage /></Suspense> },
      { path: 'about', element: <Suspense fallback={null}><AboutPage /></Suspense> },
      { path: 'help', element: <Suspense fallback={null}><HelpPage /></Suspense> },
    ],
  },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: 'practice', element: <PracticePage /> },
      { path: 'interview', element: <InterviewPage /> },
      { path: 'interview/cv', element: <InterviewPage tab="cv" /> },
      { path: 'interview/group', element: <InterviewPage tab="group" /> },
      { path: 'speak', element: <SpeakPage /> },
      { path: 'before-after', element: <BaselinePage /> },
      { path: 'journey', element: <JourneyPage /> },
      { path: 'checkup', element: <CheckupPage /> },
      { path: 'coach', element: <CoachPage /> },
      { path: 'drills', element: <DrillsPage /> },
      { path: 'sounds', element: <SoundsPage /> },
      { path: 'progress', element: <ProgressPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
