import { describe, expect, it } from 'vitest'
import { defaultPhoneCountry, toE164 } from './phone'

describe('toE164', () => {
  it('reads local Israeli numbers', () => {
    expect(toE164('052-555-0101', 'IL')).toBe('+972525550101')
    expect(toE164('03 555 1234', 'IL')).toBe('+97235551234')
    expect(toE164('+972 52 555 0101', 'IL')).toBe('+972525550101')
    expect(toE164('00972525550101', 'IL')).toBe('+972525550101')
    expect(toE164('972525550101', 'IL')).toBe('+972525550101')
  })
  it('reads North American numbers', () => {
    expect(toE164('(555) 010-2030', 'US')).toBe('+15550102030')
    expect(toE164('1 555 010 2030', 'US')).toBe('+15550102030')
    expect(toE164('+44 20 7946 0958', 'US')).toBe('+442079460958') // international stays international
  })
  it('rejects impossible numbers', () => {
    expect(toE164('12345', 'US')).toBeNull()
    expect(toE164('call me', 'IL')).toBeNull()
    expect(toE164('+12', 'IL')).toBeNull()
  })
  it('picks a sensible default country', () => {
    expect(defaultPhoneCountry('he', 'UTC')).toBe('IL')
    expect(defaultPhoneCountry('en', 'Asia/Jerusalem')).toBe('IL')
    expect(defaultPhoneCountry('en', 'America/Chicago')).toBe('US')
  })
})
