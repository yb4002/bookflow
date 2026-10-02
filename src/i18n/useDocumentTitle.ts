import { useEffect } from 'react'

/**
 * Page-specific document title. The I18nProvider falls back to the app title
 * (`meta.title`) whenever no page title is active.
 */
let pageTitle: string | null = null
export const getPageTitle = () => pageTitle

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    pageTitle = title
    if (title) document.title = title
    return () => {
      pageTitle = null
    }
  }, [title])
}
