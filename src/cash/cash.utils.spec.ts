import { cashLabel, formatSeqNo, hasContractNumber } from './cash.utils';

describe('dogovor raqami', () => {
  it('"0", "00", bo\'sh va probel - dogovor berilmagan', () => {
    for (const v of ['0', '00', '', '   ', ' 0 ', null, undefined]) {
      expect(hasContractNumber(v)).toBe(false);
    }
  });

  it('haqiqiy raqamlar', () => {
    for (const v of ['695', '   689', '0695', 'A-12']) {
      expect(hasContractNumber(v)).toBe(true);
    }
  });

  it('ichki ID 5 xonali', () => {
    expect(formatSeqNo(1)).toBe('00001');
    expect(formatSeqNo(42)).toBe('00042');
    expect(formatSeqNo(123456)).toBe('123456');
  });

  it('xabarlardagi nom', () => {
    expect(cashLabel({ cash_number: '695', seq_no: 100 })).toBe('№695');
    expect(cashLabel({ cash_number: '0', seq_no: 42 })).toBe('ID 00042');
    expect(cashLabel({ cash_number: '', seq_no: 7 })).toBe('ID 00007');
  });
});
