import type { Appointment, AvailabilityOffer, Business, Customer, ID, Service, StaffMember } from '@/domain/types'

/**
 * Persistent schema. Bump SCHEMA_VERSION and add a migration in database.ts whenever
 * a stored shape changes. Maps 1:1 onto future SQL tables (every tenant row has businessId).
 */
export const SCHEMA_VERSION = 1

export interface Tables {
  businesses: Business
  staff: StaffMember
  services: Service
  customers: Customer
  appointments: Appointment
  /** Smart Fill availability offers (and per-recipient delivery state). */
  offers: AvailabilityOffer
}

export type TableName = keyof Tables
export const TABLE_NAMES: TableName[] = ['businesses', 'staff', 'services', 'customers', 'appointments', 'offers']

export interface DbMeta {
  schemaVersion: number
  /** When the current dataset was created (seeded or reset). */
  seededAt: string
}

export type Row = { id: ID }
