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

const LOG_PREVIEW_LIMIT = 240;
const LOG_RAW_LIMIT = 1000;

export interface TriageLogDoc {
  id: string;
  status: string;
  audience: string;
}

export interface TriageLog {
  ticketId: string;
  retrieved: TriageLogDoc[];
  promptLength: number;
  promptPreview: string;
  raw: string;
}

function redactForLog(text: string): string {
  return text
    .replace(/Internal notes:[\s\S]*?(?=\n(?:Relevant policies:|Triage this ticket)|$)/gi, 'Internal notes: [redacted]\n')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/g, '[redacted-secret]');
}

/** One server log record. Not part of the HTTP response. */
export function buildTriageLog(input: {
  ticketId: string;
  retrieved: { id: string; status?: string; audience?: string }[];
  prompt: string;
  raw: string;
}): TriageLog {
  const promptPreview = redactForLog(input.prompt).slice(0, LOG_PREVIEW_LIMIT);
  return {
    ticketId: input.ticketId,
    retrieved: input.retrieved.map((doc) => ({
      id: doc.id,
      status: doc.status ?? '',
      audience: doc.audience ?? '',
    })),
    promptLength: input.prompt.length,
    promptPreview,
    raw: redactForLog(input.raw).slice(0, LOG_RAW_LIMIT),
  };
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
  console.log(
    `[triage] ${JSON.stringify(
      buildTriageLog({
        ticketId: ticket.id,
        retrieved: retrieved.map((r) => ({
          id: r.doc.id,
          status: r.doc.status,
          audience: r.doc.audience,
        })),
        prompt,
        raw,
      })
    )}`
  );
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
  return result;
}
