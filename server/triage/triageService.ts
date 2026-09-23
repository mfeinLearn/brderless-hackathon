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

const SECURITY_CATEGORIES = new Set(['security']);
const PRIVACY_CATEGORIES = new Set(['privacy', 'data_request']);

export interface PolicyFloor {
  escalate: boolean;
  reply: string;
}

/**
 * Retrieved policy sets a floor. The model may raise escalate and may not lower it.
 * A privacy export is routed to the privacy team instead of fulfilled by the agent.
 */
export function applyPolicyFloors(
  category: string,
  escalate: boolean,
  reply: string,
  docIds: readonly string[]
): PolicyFloor {
  const cat = category.trim().toLowerCase();
  let nextEscalate = escalate;
  let nextReply = reply;

  if (SECURITY_CATEGORIES.has(cat) && docIds.includes('policy-security-incident')) {
    nextEscalate = true;
  }

  if (PRIVACY_CATEGORIES.has(cat) && docIds.includes('policy-data-privacy')) {
    nextEscalate = true;
    nextReply = [
      'Hi, thanks for reaching out.',
      'We have received your request and routed it to the privacy team for identity verification. Support agents cannot provide the export directly.',
      'Best regards,\nSupport Team',
    ].join('\n\n');
  }

  return { escalate: nextEscalate, reply: nextReply };
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
  const floored = applyPolicyFloors(
    parsed.category,
    parsed.escalate,
    parsed.reply,
    retrieved.map((r) => r.doc.id)
  );

  const result: TriageResult = {
    ticketId: ticket.id,
    category: parsed.category,
    urgency: parsed.urgency,
    escalate: floored.escalate,
    reply: enforceActiveRefundWindow(ticket, floored.reply),
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
