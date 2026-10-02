/** Public booking URLs — one place to change when custom domains arrive. */
export const bookingPath = (slug: string) => `/book/${slug}`
/** The client's private manage link (by unguessable token). */
export const managePath = (slug: string, token: string) => `/book/${slug}/manage/${token}`
/** Absolute, shareable URL for the current deployment. */
export const bookingUrl = (slug: string) => `${window.location.origin}${bookingPath(slug)}`
