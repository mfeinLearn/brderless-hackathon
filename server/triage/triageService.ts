import type { Ticket, TriageResult } from '../../shared/types';
import { db } from '../store';
import { searchPolicies } from '../retrieval/policySearch';
import { buildTriagePrompt, SYSTEM_PROMPT } from './promptBuilder';
import { parseTriageResponse } from './parser';
import { getLLMClient } from '../llm/client';

/** Active refund policy (policy-refund-v3): full refund only within 30 days of purchase. */
export const ACTIVE_REFUND_WINDOW_DAYS = 30;

const REFUND_APPROVAL =
  /refund has been approved|started the refund process|no manager approval is required/i;

export function purchaseAgeDays(ticket: Ticket): number | null {
  if (!ticket.purchaseDate) return null;
  return Math.floor(
    (new Date(ticket.createdAt).getTime() - new Date(ticket.purchaseDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

/**
 * The model may draft an approval, including when the customer message tells it to.
 * A purchase outside the active window cannot be stored as an approved refund.
 */
export function enforceActiveRefundWindow(ticket: Ticket, reply: string): string {
  const age = purchaseAgeDays(ticket);
  if (age === null || age <= ACTIVE_REFUND_WINDOW_DAYS) return reply;
  if (!REFUND_APPROVAL.test(reply)) return reply;
  return [
    'Hi, thanks for reaching out.',
    `Unfortunately your purchase falls outside our ${ACTIVE_REFUND_WINDOW_DAYS}-day refund window, so we are unable to process a refund.`,
    'Best regards,\nSupport Team',
  ].join('\n\n');
}

export async function runTriage(ticket: Ticket): Promise<TriageResult> {
  const query = `${ticket.subject} ${ticket.message}`;
  const retrieved = searchPolicies(query, db.policies, 3);

  const prompt = buildTriagePrompt(
    ticket,
    retrieved.map((r) => r.doc)
  );

  const llm = getLLMClient();
  const raw = await llm.complete({ system: SYSTEM_PROMPT, user: prompt });
  const parsed = parseTriageResponse(raw);

  const result: TriageResult = {
    ticketId: ticket.id,
    category: parsed.category,
    urgency: parsed.urgency,
    escalate: parsed.escalate,
    reply: enforceActiveRefundWindow(ticket, parsed.reply),
    reasoning: parsed.reasoning,
    citations: retrieved.map((r) => ({
      docId: r.doc.id,
      title: r.doc.title,
      snippet: r.doc.body.slice(0, 140) + '…',
    })),
    generatedAt: new Date().toISOString(),
  };

  db.triageResults.set(ticket.id, result);
  console.log(`[triage] ${ticket.id} -> ${result.category}/${result.urgency}`);
  return result;
}
