import { useCallback, useState } from 'react'
import { differenceInMinutes } from 'date-fns'
import type { DayAvailability, TimeSlot } from '@/domain/availability'
import type { AppointmentView, CancellationReason } from '@/domain/types'
import { BookingError, repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'

export type ManageMode = 'view' | 'reschedule' | 'cancel'
export type ManageError = 'slot_taken' | 'window_closed' | 'generic'

const DAYS_SHOWN = 14

const toError = (e: unknown): ManageError =>
  e instanceof BookingError
    ? e.code === 'slot_unavailable'
      ? 'slot_taken'
      : e.code === 'change_window_closed'
        ? 'window_closed'
        : 'generic'
    : 'generic'

/**
 * State machine for a customer managing one booking:
 * view → reschedule (pick slot → confirm) → view, or view → cancel (reason → confirm) → cancelled.
 * All writes go through the repository, which re-validates on its side.
 */
export function useManagedBooking(slug: string, token: string) {
  const q = useQuery(() => Promise.all([repo.getPublicProfile(slug), repo.getBookingByReference(slug, token)]), [slug, token])
  const [profile, loaded] = q.data ?? []
  const [booking, setBooking] = useState<AppointmentView>()
  const current = booking ?? loaded

  const [mode, setMode] = useState<ManageMode>('view')
  const [error, setError] = useState<ManageError>()
  const [submitting, setSubmitting] = useState(false)
  const [justRescheduled, setJustRescheduled] = useState(false)

  // Reschedule state
  const [days, setDays] = useState<DayAvailability[]>()
  const [date, setDate] = useState<Date>()
  const [slot, setSlot] = useState<TimeSlot>()

  // Cancel state
  const [reason, setReason] = useState<CancellationReason>()

  const policyHours = profile?.business.policies.cancellationWindowHours ?? 24
  const start = current ? new Date(current.start) : undefined
  const isActive = current?.status === 'confirmed' || current?.status === 'pending'
  const isPast = !!start && start <= new Date()
  const insideWindow = !!start && differenceInMinutes(start, new Date()) < policyHours * 60
  const canChange = isActive && !isPast && !insideWindow

  const loadDays = useCallback(async () => {
    if (!current?.manageToken) return
    setDays(undefined)
    const result = await repo.getRescheduleAvailability(slug, current.manageToken, new Date(), DAYS_SHOWN)
    // The booking's own slot shows as "Current", so it must not count as a free time.
    const own = new Date(current.start).getTime()
    const marked = result.map((d) => ({ ...d, slots: d.slots.map((s) => (s.start.getTime() === own ? { ...s, available: false } : s)) }))
    setDays(marked)
    setDate((prev) => {
      // Stay on the day the customer was looking at (it may now show as full) — never jump silently.
      if (prev && marked.some((d) => d.date.getTime() === prev.getTime())) return prev
      const sameDay = marked.find((d) => d.date.toDateString() === new Date(current.start).toDateString() && d.slots.some((s) => s.available))
      return (sameDay ?? marked.find((d) => d.slots.some((s) => s.available)))?.date
    })
  }, [slug, current?.manageToken, current?.start])

  const startReschedule = () => {
    setError(undefined)
    setSlot(undefined)
    setJustRescheduled(false)
    setMode('reschedule')
    void loadDays()
  }

  const startCancel = () => {
    setError(undefined)
    setReason(undefined)
    setJustRescheduled(false)
    setMode('cancel')
  }

  const back = () => {
    setError(undefined)
    setMode('view')
  }

  const confirmReschedule = async () => {
    if (!current?.manageToken || !slot) return
    setSubmitting(true)
    setError(undefined)
    try {
      setBooking(await repo.rescheduleBooking(slug, current.manageToken, slot.start.toISOString()))
      setJustRescheduled(true)
      setMode('view')
    } catch (e) {
      const err = toError(e)
      setError(err)
      if (err === 'slot_taken') {
        setSlot(undefined)
        void loadDays()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmCancel = async () => {
    if (!current?.manageToken) return
    setSubmitting(true)
    setError(undefined)
    try {
      setBooking(await repo.cancelBooking(slug, current.manageToken, reason))
      setMode('view')
    } catch (e) {
      setError(toError(e))
    } finally {
      setSubmitting(false)
    }
  }

  return {
    loading: q.loading && !q.data,
    loadError: !q.data && !!q.error,
    retry: q.refetch,
    profile,
    booking: current,
    mode,
    error,
    submitting,
    justRescheduled,
    policyHours,
    isActive,
    isPast,
    insideWindow,
    canChange,
    reschedule: { days, date, slot, setDate: (d: Date) => (setDate(d), setSlot(undefined)), setSlot, confirm: confirmReschedule },
    cancel: { reason, setReason, confirm: confirmCancel },
    startReschedule,
    startCancel,
    back,
  }
}
