import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './csv'

describe('parseCsv', () => {
  it('handles quotes, newlines in cells, BOM, and comma/semicolon/tab delimiters', () => {
    expect(parseCsv('﻿Name,Phone\r\n"Levi, Dana","052-555 0101"\r\n"Multi\nline",x\n\n')).toEqual([['Name', 'Phone'], ['Levi, Dana', '052-555 0101'], ['Multi\nline', 'x']])
    expect(parseCsv('שם;טלפון\nנועה;0525550101')).toEqual([['שם', 'טלפון'], ['נועה', '0525550101']])
    expect(parseCsv('a\tb\n1\t"2 ""x"""')).toEqual([['a', 'b'], ['1', '2 "x"']])
  })
  it('round-trips our own export', () => {
    expect(parseCsv(toCsv([['A', 'B'], ['x,y', 'he said "hi"']]))).toEqual([['A', 'B'], ['x,y', 'he said "hi"']])
  })
})
