import { describe, expect, it } from 'vitest';
import { buildTriageLog } from '../server/triage/triageService';

describe('buildTriageLog', () => {
  it('includes retrieved docs, prompt length, a short preview, and the raw model output', () => {
    const prompt = [
      'Ticket T-1002: Refund request',
      'Customer: Marcus Chen (pro plan, $41/mo)',
      'user@example.com',
      'Internal notes:',
      '- Fraud risk score: 87',
      'sk-secretkey12345678',
      'Relevant policies:',
      '### Refund Policy (v3)',
    ].join('\n');
    const raw = '{"category":"refund","reply":"refused"} mail user@example.com';

    const log = buildTriageLog({
      ticketId: 'T-1002',
      retrieved: [{ id: 'policy-refund-v3', status: 'active', audience: 'public' }],
      prompt,
      raw,
    });

    expect(log).toEqual(
      expect.objectContaining({
        ticketId: 'T-1002',
        retrieved: [{ id: 'policy-refund-v3', status: 'active', audience: 'public' }],
        promptLength: prompt.length,
      })
    );
    expect(log.promptPreview.length).toBeLessThanOrEqual(240);
    expect(log.promptPreview).not.toContain('user@example.com');
    expect(log.promptPreview).not.toContain('Fraud risk score');
    expect(log.promptPreview).not.toContain('sk-secretkey12345678');
    expect(log.raw).toContain('"category":"refund"');
    expect(log.raw).not.toContain('user@example.com');
    expect(log).not.toHaveProperty('internalNotes');
    expect(JSON.stringify(log)).not.toContain('user@example.com');
  });
});
