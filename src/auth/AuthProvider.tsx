import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, AuthError, onUnauthorized } from '@/data/api/client'
import { repo } from '@/data/repositories'

export interface Me {
  user: { id: string; email: string; name: string; emailVerified?: boolean }
  role: 'owner' | 'staff'
  /** The team member (calendar) this login is linked to. */
  staffId?: string
  business: { id: string; name: string; onboardingCompleted: boolean; published: boolean; /** One of the seeded demo tenants. */ demo?: boolean }
  /** Every business this user can act for (business switcher). */
  businesses?: { id: string; name: string; role: 'owner' | 'staff' }[]
}

export interface InvitationInfo {
  businessName: string
  email: string
  role: 'owner' | 'staff'
  existingUser: boolean
}

export interface SignupInput {
  name: string
  email: string
  password: string
  businessName: string
  locale: 'en' | 'he'
  timezone: string
  acceptTerms: boolean
  /** Honeypot (must stay empty). */
  website?: string
}

type Status = 'loading' | 'authenticated' | 'anonymous'

interface AuthValue {
  status: Status
  me: Me | null
  /** Server offers the one-click demo login. */
  demoMode: boolean
  /** True when the user was signed out by an expired/revoked session (not by choice). */
  expired: boolean
  login: (email: string, password: string) => Promise<Me>
  demoLogin: () => Promise<Me>
  signup: (input: SignupInput) => Promise<Me>
  logout: () => Promise<void>
  requestPasswordReset: (email: string, locale: 'en' | 'he') => Promise<void>
  resetPassword: (token: string, password: string) => Promise<Me>
  /** Re-reads the session (e.g. after finishing onboarding or renaming the business). */
  refresh: () => Promise<void>
  describeInvitation: (token: string) => Promise<InvitationInfo>
  acceptInvitation: (token: string, password: string, name?: string) => Promise<Me>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  signOutOthers: () => Promise<number>
  updateName: (name: string) => Promise<void>
  switchBusiness: (businessId: string) => Promise<Me>
  verifyEmail: (token: string) => Promise<void>
  resendVerification: (locale: 'en' | 'he') => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Session state for the whole app. The session itself lives in an HttpOnly cookie the browser can't read. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [expired, setExpired] = useState(false)

  const load = useCallback(async () => {
    try {
      const { demoMode: demo, ...m } = await api<Me & { demoMode: boolean }>('GET', '/auth/me')
      setMe(m)
      setDemoMode(demo)
      setStatus('authenticated')
    } catch {
      setMe(null)
      setStatus('anonymous')
      api<{ demoMode: boolean }>('GET', '/config').then((c) => setDemoMode(c.demoMode), () => {})
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Any API call that finds the session gone signs the UI out.
  useEffect(
    () =>
      onUnauthorized(() => {
        setMe((current) => {
          if (current) setExpired(true)
          return null
        })
        setStatus('anonymous')
      }),
    [],
  )

  // Keep the header/guards in sync when the business is renamed, published or finishes onboarding.
  useEffect(() => {
    if (status !== 'authenticated') return
    return repo.onChange((topics) => {
      if (topics.includes('business')) void load()
    })
  }, [status, load])

  const signedIn = useCallback((m: Me) => {
    setMe(m)
    setExpired(false)
    setStatus('authenticated')
    return m
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      demoMode,
      expired,
      login: async (email, password) => signedIn(await api<Me>('POST', '/auth/login', { email, password })),
      demoLogin: async () => signedIn(await api<Me>('POST', '/auth/demo-login')),
      signup: async (input) => signedIn(await api<Me>('POST', '/auth/signup', input)),
      logout: async () => {
        await api('POST', '/auth/logout').catch(() => {})
        setMe(null)
        setExpired(false)
        setStatus('anonymous')
      },
      requestPasswordReset: async (email, locale) => {
        await api('POST', '/auth/forgot-password', { email, locale })
      },
      resetPassword: async (token, password) => signedIn(await api<Me>('POST', '/auth/reset-password', { token, password })),
      refresh: load,
      describeInvitation: (token) => api<InvitationInfo>('GET', `/auth/invitations/${encodeURIComponent(token)}`),
      acceptInvitation: async (token, password, name) => signedIn(await api<Me>('POST', '/auth/invitations/accept', { token, password, name })),
      changePassword: async (currentPassword, newPassword) => {
        await api('POST', '/auth/change-password', { currentPassword, newPassword })
      },
      signOutOthers: async () => (await api<{ signedOut: number }>('POST', '/auth/logout-others')).signedOut,
      updateName: async (name) => {
        signedIn(await api<Me>('PATCH', '/auth/profile', { name }))
      },
      switchBusiness: async (businessId) => {
        const m = signedIn(await api<Me>('POST', '/auth/switch', { businessId }))
        // Everything on screen belonged to the previous business: start clean.
        window.location.assign('/app')
        return m
      },
      verifyEmail: async (token) => {
        await api('POST', '/auth/verify-email', { token })
      },
      resendVerification: async (locale) => {
        await api('POST', '/auth/verify-email/resend', { locale })
      },
    }),
    [status, me, demoMode, expired, signedIn, load],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export { ApiError, AuthError }
