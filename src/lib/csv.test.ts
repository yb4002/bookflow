import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('quotes, escapes and neutralizes formulas', () => {
    const csv = toCsv([['Name', 'Notes'], ['Dana, Levi', 'said "hi"'], ['=HYPERLINK("x")', '-5'], ['נועה', null]])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual(['Name,Notes', '"Dana, Levi","said ""hi"""', `"'=HYPERLINK(""x"")",'-5`, 'נועה,'])
  })
})
