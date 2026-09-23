import { useEffect, useRef, useState } from 'react';
import type { Ticket, TriageResult } from '../../shared/types';
import { fetchTicket, fetchTriage, generateTriage } from '../api';
import { shouldApplyTicketResult } from '../ticketSelection';
import { TriagePanel } from './TriagePanel';

interface Props {
  ticketId: string;
  onTriageComplete: () => void;
}

export function TicketView({ ticketId, onTriageComplete }: Props) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [triageLoading, setTriageLoading] = useState(true);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [seenTicketId, setSeenTicketId] = useState(ticketId);
  const selectedIdRef = useRef(ticketId);
  selectedIdRef.current = ticketId;

  if (seenTicketId !== ticketId) {
    setSeenTicketId(ticketId);
    setTicket(null);
    setTriage(null);
    setTriageError(null);
    setTriageLoading(true);
  }

  useEffect(() => {
    const requestedId = ticketId;
    let active = true;
    const stillSelected = (responseTicketId: string) =>
      active && shouldApplyTicketResult(responseTicketId, selectedIdRef.current);

    setTriageLoading(true);
    setTriageError(null);

    fetchTicket(requestedId)
      .then((next) => {
        if (stillSelected(next.id)) setTicket(next);
      })
      .catch(() => {
        if (stillSelected(requestedId)) setTicket(null);
      });

    // Load the existing triage, or generate one on first view.
    fetchTriage(requestedId)
      .catch(() => generateTriage(requestedId).then((r) => (onTriageComplete(), r)))
      .then((result) => {
        if (result && stillSelected(result.ticketId)) setTriage(result);
      })
      .catch((e: Error) => {
        if (stillSelected(requestedId)) setTriageError(e.message);
      })
      .finally(() => {
        if (stillSelected(requestedId)) setTriageLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ticketId]);

  const regenerate = () => {
    const requestedId = ticketId;
    setTriageLoading(true);
    setTriageError(null);
    generateTriage(requestedId)
      .then((result) => {
        if (!shouldApplyTicketResult(result.ticketId, selectedIdRef.current)) return;
        setTriage(result);
        onTriageComplete();
      })
      .catch((e: Error) => {
        if (shouldApplyTicketResult(requestedId, selectedIdRef.current)) {
          setTriageError(e.message);
        }
      })
      .finally(() => {
        if (shouldApplyTicketResult(requestedId, selectedIdRef.current)) {
          setTriageLoading(false);
        }
      });
  };

  if (!ticket) return <div className="empty-state">Loading ticket…</div>;

  return (
    <div className="ticket-view">
      <section className="ticket-details card">
        <div className="ticket-details-header">
          <h2>{ticket.subject}</h2>
          <span className="ticket-id">{ticket.id}</span>
        </div>
        <dl className="customer-meta">
          <div>
            <dt>Customer</dt>
            <dd>
              {ticket.customer.name} ({ticket.customer.email})
            </dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd className={`plan plan-${ticket.customer.plan}`}>{ticket.customer.plan}</dd>
          </div>
          <div>
            <dt>Monthly spend</dt>
            <dd>${ticket.customer.monthlySpendUsd}</dd>
          </div>
          {ticket.purchaseDate && (
            <div>
              <dt>Purchase date</dt>
              <dd>{new Date(ticket.purchaseDate).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
        <h3>Customer message</h3>
        <blockquote className="customer-message">{ticket.message}</blockquote>
        {ticket.internalNotes.length > 0 && (
          <>
            <h3>
              Internal notes <span className="internal-tag">internal only</span>
            </h3>
            <ul className="internal-notes">
              {ticket.internalNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <TriagePanel
        triage={triage}
        loading={triageLoading}
        error={triageError}
        onRegenerate={regenerate}
      />
    </div>
  );
}
