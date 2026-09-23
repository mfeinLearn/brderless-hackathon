import { describe, expect, it } from 'vitest';
import { shouldApplyTicketResult } from '../src/ticketSelection';

describe('shouldApplyTicketResult', () => {
  it('ignores a completion for A once the selected ticket is B', () => {
    expect(shouldApplyTicketResult('T-1003', 'T-1012')).toBe(false);
  });

  it('applies a completion for B when B is still selected', () => {
    expect(shouldApplyTicketResult('T-1012', 'T-1012')).toBe(true);
  });
});
