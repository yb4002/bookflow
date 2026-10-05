import { createHttpRepository } from './httpRepository'
import type { BookFlowRepository } from './types'

export type {
  BookFlowRepository,
  AppointmentQuery,
  PublicBusinessProfile,
  NewBookingInput,
  BookingErrorCode,
  BusinessUpdate,
  DataTopic,
} from './types'
export { BookingError } from './types'

/**
 * Composition root for data access: the BookFlow API (server + relational database).
 * `createLocalRepository` (local-first, browser storage) implements the same contract
 * and is used by tests; screens never know which one they talk to.
 */
export const repo: BookFlowRepository = createHttpRepository()
