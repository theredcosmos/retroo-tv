import { parseJamCode } from './jam-panel.component';

describe('parseJamCode', () => {
  it('accepts a bare code in any case, with spaces or a dash', () => {
    expect(parseJamCode('k7q2xm')).toBe('K7Q2XM');
    expect(parseJamCode('  K7Q 2XM ')).toBe('K7Q2XM');
    expect(parseJamCode('K7Q-2XM')).toBe('K7Q2XM');
  });

  it('pulls the code out of a pasted invite link', () => {
    expect(parseJamCode('https://retroo.tv/jam/s7uj2q')).toBe('S7UJ2Q');
    expect(parseJamCode('join us! http://localhost:4200/jam/S7UJ2Q/')).toBe('S7UJ2Q');
  });

  it('rejects anything that is not a 6-character code', () => {
    expect(parseJamCode('')).toBeNull();
    expect(parseJamCode('ABC12')).toBeNull();
    expect(parseJamCode('ABC1234')).toBeNull();
    expect(parseJamCode('https://retroo.tv/jam/ABC1234')).toBeNull();
    expect(parseJamCode('K7Q2X!')).toBeNull();
  });
});
