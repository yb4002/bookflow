import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/auth/RequireAuth'
import { LandingPage } from '@/features/landing/LandingPage'

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage'))
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage'))
const ServicesPage = lazy(() => import('@/features/services/ServicesPage'))
// Public, customer-facing pages (no app shell).
const BookingPage = lazy(() => import('@/features/booking/BookingPage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const SignupPage = lazy(() => import('@/features/auth/SignupPage'))
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'))
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage'))
const ManageBookingPage = lazy(() => import('@/features/booking/ManageBookingPage'))
const AccountPage = lazy(() => import('@/features/account/AccountPage'))
const AcceptInvitePage = lazy(() => import('@/features/auth/AcceptInvitePage'))
const VerifyEmailPage = lazy(() => import('@/features/auth/VerifyEmailPage'))
const NotFoundPage = lazy(() => import('@/features/system/NotFoundPage'))
const LegalPage = lazy(() => import('@/features/system/LegalPage'))

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </>
  )
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <LandingPage /> },
      {
        path: '/app',
        // Dashboard routes require a signed-in user (server enforces it on every API call too).
        element: (
          <RequireAuth requireOnboarded>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'services', element: <RequireAuth requireOwner><ServicesPage /></RequireAuth> },
          { path: 'account', element: <AccountPage /> },
        ],
      },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/accept-invite', element: <AcceptInvitePage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      {
        path: '/onboarding',
        element: (
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        ),
      },
      { path: '/book/:slug', element: <BookingPage /> },
      { path: '/book/:slug/manage/:token', element: <ManageBookingPage /> },
      { path: '/privacy', element: <LegalPage doc="privacy" /> },
      { path: '/terms', element: <LegalPage doc="terms" /> },
      { path: '/app/*', element: <Navigate to="/app" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
