/**
 * A triage or ticket response may resolve after the agent has selected a
 * different ticket. Apply it only when it still matches the selection.
 */
export function shouldApplyTicketResult(
  responseTicketId: string,
  selectedTicketId: string
): boolean {
  return responseTicketId === selectedTicketId;
}
