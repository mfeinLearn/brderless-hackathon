export interface ParsedTriage {
  category: string;
  urgency: 'high' | 'medium' | 'low';
  escalate: boolean;
  reply: string;
  reasoning: string;
}

const URGENCY_SYNONYMS: Record<string, ParsedTriage['urgency']> = {
  high: 'high',
  urgent: 'high',
  medium: 'medium',
  normal: 'medium',
  low: 'low',
};

/** Closed set the ticket list compares with === and the badge CSS classes use. */
export function normalizeUrgency(raw: string): ParsedTriage['urgency'] {
  const canonical = URGENCY_SYNONYMS[raw.trim().toLowerCase()];
  if (!canonical) {
    throw new Error(`Model response has unknown urgency: ${raw}`);
  }
  return canonical;
}

/**
 * Extract the triage JSON from a model response. Models sometimes wrap JSON
 * in code fences or prose, so we locate the outermost object first.
 */
export function parseTriageResponse(raw: string): ParsedTriage {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  const parsed = JSON.parse(raw.slice(start, end + 1));

  for (const field of ['category', 'urgency', 'escalate', 'reply']) {
    if (!(field in parsed)) {
      throw new Error(`Model response missing field: ${field}`);
    }
  }

  return {
    category: String(parsed.category),
    urgency: normalizeUrgency(String(parsed.urgency)),
    escalate: Boolean(parsed.escalate),
    reply: String(parsed.reply),
    reasoning: String(parsed.reasoning ?? ''),
  };
}
