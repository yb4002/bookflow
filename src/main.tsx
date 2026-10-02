import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/app/router'
import { ToastProvider } from '@/components/ui/Toast'
import { I18nProvider } from '@/i18n'
import { AuthProvider } from '@/auth/AuthProvider'
import { ErrorBoundary } from '@/features/system/ErrorBoundary'
import { installGlobalErrorReporting } from '@/lib/errorReporting'
import '@/styles/index.css'

installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
)
