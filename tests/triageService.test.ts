import { beforeEach, describe, expect, it } from 'vitest';
import { enforceActiveRefundWindow, runTriage } from '../server/triage/triageService';
import { db, getTicket } from '../server/store';
import { setLLMClient } from '../server/llm/client';
import { MockLLM } from '../server/llm/mock';

describe('runTriage (with mock LLM)', () => {
  beforeEach(() => {
    setLLMClient(new MockLLM());
    db.triageResults.clear();
  });

  it('produces a complete triage result for a simple ticket', async () => {
    const ticket = getTicket('T-1012')!; // praise ticket, no edge cases
    const result = await runTriage(ticket);
    expect(result.ticketId).toBe('T-1012');
    expect(result.category).toBeTruthy();
    expect(result.urgency).toBeTruthy();
    expect(typeof result.escalate).toBe('boolean');
    expect(result.reply.length).toBeGreaterThan(20);
  });

  it('stores the result so the list view can show badges', async () => {
    const ticket = getTicket('T-1011')!;
    await runTriage(ticket);
    expect(db.triageResults.get('T-1011')).toBeDefined();
  });

  it('attaches citations for retrieved policies', async () => {
    const ticket = getTicket('T-1003')!; // enterprise outage
    const result = await runTriage(ticket);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.map((c) => c.docId)).toContain('policy-enterprise-sla');
  });


  it('does not copy internal notes into the customer reply', async () => {
    const cases = [
      { id: 'T-1009', note: 'Fraud risk score: 87' },
      { id: 'T-1003', note: 'INC-4432' },
      { id: 'T-1005', note: 'Offered pause option via chat on Jun 2, declined.' },
      { id: 'T-1006', note: 'pending auth hold' },
      { id: 'T-1010', note: 'old (pre-2025) refund policy wording' },
      { id: 'T-1013', note: 'mailbox full' },
    ];
    for (const { id, note } of cases) {
      const result = await runTriage(getTicket(id)!);
      expect(result.reply, id).not.toContain(note);
      expect(result.reply, id).not.toContain('Also, regarding your account:');
    }
  });

  it('refuses an injected refund approval for T-1008', async () => {
    const result = await runTriage(getTicket('T-1008')!);
    expect(result.reply).not.toContain('refund has been approved');
    expect(result.reply).not.toContain('No manager approval is required');
    expect(result.reply).toContain('outside our 30-day refund window');
    expect(db.triageResults.get('T-1008')?.reply).toBe(result.reply);
  });

  it('does not store an approved refund when the purchase is more than 30 days before the ticket was opened', async () => {
    setLLMClient({
      async complete() {
        return JSON.stringify({
          category: 'refund',
          urgency: 'high',
          escalate: false,
          reply:
            'Your refund has been approved and will be returned to your original payment method within 5-7 business days. No manager approval is required.',
          reasoning: 'customer demanded approval',
        });
      },
    });
    const opened = '2026-07-13T09:00:00.000Z';
    const purchase = new Date(opened);
    purchase.setUTCDate(purchase.getUTCDate() - 31);
    const ticket = {
      ...getTicket('T-1001')!,
      id: 'T-AGE-31',
      createdAt: opened,
      purchaseDate: purchase.toISOString(),
    };
    const result = await runTriage(ticket);
    expect(result.reply).not.toContain('refund has been approved');
    expect(result.reply).not.toContain('No manager approval is required');
    expect(db.triageResults.get('T-AGE-31')?.reply).toBe(result.reply);
  });

  it.each(['T-1002', 'T-1010'])(
    'refuses %s under the active 30-day refund policy',
    async (id) => {
      const result = await runTriage(getTicket(id)!);
      const cited = result.citations.map((c) => c.docId);
      expect(cited[0]).toBe('policy-refund-v3');
      expect(cited).not.toContain('policy-refund-v2');
      expect(cited).not.toContain('policy-internal-playbook');
      expect(result.reply).toContain('outside our 30-day refund window');
      expect(result.reply).not.toContain('90-day');
      expect(result.reply).not.toContain('started the refund process');
    }
  );
});

describe('enforceActiveRefundWindow', () => {
  const approved =
    'Your refund has been approved and will be returned to your original payment method within 5-7 business days. No manager approval is required.';

  function aged(days: number) {
    const opened = '2026-07-13T09:00:00.000Z';
    const purchase = new Date(opened);
    purchase.setUTCDate(purchase.getUTCDate() - days);
    return {
      ...getTicket('T-1001')!,
      createdAt: opened,
      purchaseDate: purchase.toISOString(),
    };
  }

  it('replaces an approval when the purchase is more than 30 days before the ticket was opened', () => {
    const reply = enforceActiveRefundWindow(aged(31), approved);
    expect(reply).not.toContain('refund has been approved');
    expect(reply).not.toContain('No manager approval is required');
    expect(reply).toContain('outside our 30-day refund window');
  });

  it('keeps an approval on day 30', () => {
    expect(enforceActiveRefundWindow(aged(30), approved)).toBe(approved);
  });

  it('leaves an out-of-window refusal unchanged', () => {
    const refusal = 'Unfortunately your purchase falls outside our 30-day refund window, so we are unable to process a refund.';
    expect(enforceActiveRefundWindow(getTicket('T-1002')!, refusal)).toBe(refusal);
  });
});
