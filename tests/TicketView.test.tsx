// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket, TriageResult } from '../shared/types';

vi.mock('../src/api', () => ({
  fetchTicket: vi.fn(),
  fetchTriage: vi.fn(),
  generateTriage: vi.fn(),
}));

import { fetchTicket, fetchTriage, generateTriage } from '../src/api';
import { TicketView } from '../src/components/TicketView';

const fetchTicketMock = vi.mocked(fetchTicket);
const fetchTriageMock = vi.mocked(fetchTriage);
const generateTriageMock = vi.mocked(generateTriage);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'T-1003',
    subject: 'URGENT: Dashboard down',
    message: 'The dashboard is down.',
    customer: {
      name: 'Priya Raman',
      email: 'priya@example.com',
      plan: 'enterprise',
      accountId: 'acct-1',
      monthlySpendUsd: 4200,
    },
    createdAt: '2026-07-13T09:00:00.000Z',
    purchaseDate: '2026-01-01T00:00:00.000Z',
    status: 'open',
    internalNotes: ['Incident INC-4432'],
    ...overrides,
  };
}

function triage(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    ticketId: 'T-1003',
    category: 'outage',
    urgency: 'high',
    escalate: true,
    reply: 'Service credits will be applied.',
    reasoning: 'Enterprise SLA breach.',
    citations: [{ docId: 'policy-enterprise-sla', title: 'Enterprise SLA', snippet: '99.9%' }],
    generatedAt: '2026-07-13T09:05:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  fetchTicketMock.mockReset();
  fetchTriageMock.mockReset();
  generateTriageMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('TicketView', () => {
  it('shows the ticket, notes, and an existing triage result', async () => {
    fetchTicketMock.mockResolvedValue(ticket());
    fetchTriageMock.mockResolvedValue(triage());
    const onTriageComplete = vi.fn();

    render(<TicketView ticketId="T-1003" onTriageComplete={onTriageComplete} />);

    expect(screen.getByText('Loading ticket…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'URGENT: Dashboard down' })).toBeTruthy();
    expect(screen.getByText(/priya@example.com/)).toBeTruthy();
    expect(screen.getByText('Incident INC-4432')).toBeTruthy();
    expect(screen.getByText('Service credits will be applied.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Regenerate AI Triage' })).toBeTruthy();
    expect(onTriageComplete).not.toHaveBeenCalled();
  });

  it('generates triage on first view and renders a ticket with no purchase date or notes', async () => {
    const plain = ticket({
      id: 'T-1012',
      subject: 'Love the new dashboard!',
      purchaseDate: undefined,
      internalNotes: [],
    });
    fetchTicketMock.mockResolvedValue(plain);
    fetchTriageMock.mockRejectedValue(new Error('missing'));
    generateTriageMock.mockResolvedValue(
      triage({ ticketId: 'T-1012', reply: 'Thanks for the note.', escalate: false, urgency: 'low' })
    );
    const onTriageComplete = vi.fn();

    render(<TicketView ticketId="T-1012" onTriageComplete={onTriageComplete} />);

    expect(await screen.findByText('Thanks for the note.')).toBeTruthy();
    expect(screen.queryByText('Purchase date')).toBeNull();
    expect(screen.queryByText('Internal notes')).toBeNull();
    expect(onTriageComplete).toHaveBeenCalledTimes(1);
  });

  it('stays on the loading state when the ticket request fails', async () => {
    fetchTicketMock.mockRejectedValue(new Error('no ticket'));
    fetchTriageMock.mockResolvedValue(triage());

    render(<TicketView ticketId="T-1003" onTriageComplete={vi.fn()} />);

    await waitFor(() => expect(fetchTicketMock).toHaveBeenCalled());
    await waitFor(() => expect(fetchTriageMock).toHaveBeenCalled());
    expect(screen.getByText('Loading ticket…')).toBeTruthy();
  });

  it('shows an error when the first triage cannot be generated', async () => {
    fetchTicketMock.mockResolvedValue(ticket());
    fetchTriageMock.mockRejectedValue(new Error('missing'));
    generateTriageMock.mockRejectedValue(new Error('generator failed'));

    render(<TicketView ticketId="T-1003" onTriageComplete={vi.fn()} />);

    expect(await screen.findByText('generator failed')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'URGENT: Dashboard down' })).toBeTruthy();
  });

  it('shows a triage error and ignores an empty triage payload', async () => {
    fetchTicketMock.mockResolvedValue(ticket({ internalNotes: [], purchaseDate: undefined }));
    fetchTriageMock.mockResolvedValue(undefined as unknown as TriageResult);

    const view = render(<TicketView ticketId="T-1003" onTriageComplete={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'URGENT: Dashboard down' })).toBeTruthy();
    expect(screen.queryByText('Service credits will be applied.')).toBeNull();

    const failed = deferred<TriageResult>();
    generateTriageMock.mockReturnValue(failed.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI Triage' }));
    failed.reject(new Error('model down'));

    expect(await screen.findByText('model down')).toBeTruthy();
    view.unmount();
  });

  it('drops a late response after the selected ticket changes', async () => {
    const firstTicket = deferred<Ticket>();
    const firstTriage = deferred<TriageResult>();
    const secondTicket = deferred<Ticket>();
    const secondTriage = deferred<TriageResult>();
    fetchTicketMock.mockImplementation((id) =>
      id === 'T-1003' ? firstTicket.promise : secondTicket.promise
    );
    fetchTriageMock.mockImplementation((id) =>
      id === 'T-1003' ? firstTriage.promise : secondTriage.promise
    );
    const onTriageComplete = vi.fn();

    const view = render(<TicketView ticketId="T-1003" onTriageComplete={onTriageComplete} />);
    view.rerender(<TicketView ticketId="T-1012" onTriageComplete={onTriageComplete} />);

    firstTicket.resolve(ticket());
    firstTriage.resolve(triage({ reply: 'Outage reply that must not stick.' }));
    secondTicket.resolve(
      ticket({
        id: 'T-1012',
        subject: 'Love the new dashboard!',
        purchaseDate: undefined,
        internalNotes: [],
      })
    );
    secondTriage.resolve(triage({ ticketId: 'T-1012', reply: 'Dashboard reply.' }));

    expect(await screen.findByRole('heading', { name: 'Love the new dashboard!' })).toBeTruthy();
    expect(await screen.findByText('Dashboard reply.')).toBeTruthy();
    expect(screen.queryByText('Outage reply that must not stick.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'URGENT: Dashboard down' })).toBeNull();
  });

  it('drops a failed ticket load and a failed triage load after switching tickets', async () => {
    const firstTicket = deferred<Ticket>();
    const firstTriage = deferred<TriageResult>();
    fetchTicketMock.mockImplementation((id) =>
      id === 'T-1003' ? firstTicket.promise : Promise.resolve(ticket({ id, subject: 'Second' }))
    );
    fetchTriageMock.mockImplementation((id) =>
      id === 'T-1003' ? firstTriage.promise : Promise.resolve(triage({ ticketId: id, reply: 'Second reply' }))
    );

    const view = render(<TicketView ticketId="T-1003" onTriageComplete={vi.fn()} />);
    view.rerender(<TicketView ticketId="T-1012" onTriageComplete={vi.fn()} />);
    firstTicket.reject(new Error('gone'));
    firstTriage.reject(new Error('late failure'));

    expect(await screen.findByRole('heading', { name: 'Second' })).toBeTruthy();
    expect(screen.queryByText('gone')).toBeNull();
    expect(screen.queryByText('late failure')).toBeNull();
  });

  it('replaces the draft when regenerate finishes for the selected ticket', async () => {
    fetchTicketMock.mockResolvedValue(ticket({ purchaseDate: undefined, internalNotes: [] }));
    fetchTriageMock.mockResolvedValue(triage({ reply: 'first draft' }));
    generateTriageMock.mockResolvedValue(triage({ reply: 'second draft' }));
    const onTriageComplete = vi.fn();

    render(<TicketView ticketId="T-1003" onTriageComplete={onTriageComplete} />);
    expect(await screen.findByText('first draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI Triage' }));

    expect(await screen.findByText('second draft')).toBeTruthy();
    expect(screen.queryByText('first draft')).toBeNull();
    expect(onTriageComplete).toHaveBeenCalledTimes(1);
  });

  it('ignores a regenerate that finishes after the selection changes', async () => {
    fetchTicketMock.mockImplementation(async (id) =>
      ticket({
        id,
        subject: id === 'T-1003' ? 'URGENT: Dashboard down' : 'Love the new dashboard!',
        purchaseDate: undefined,
        internalNotes: [],
      })
    );
    fetchTriageMock.mockImplementation(async (id) => triage({ ticketId: id, reply: `ready ${id}` }));
    const regen = deferred<TriageResult>();
    generateTriageMock.mockReturnValue(regen.promise);
    const onTriageComplete = vi.fn();

    const view = render(<TicketView ticketId="T-1003" onTriageComplete={onTriageComplete} />);
    expect(await screen.findByText('ready T-1003')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI Triage' }));
    view.rerender(<TicketView ticketId="T-1012" onTriageComplete={onTriageComplete} />);
    regen.resolve(triage({ ticketId: 'T-1003', reply: 'stale regenerate' }));

    expect(await screen.findByText('ready T-1012')).toBeTruthy();
    expect(screen.queryByText('stale regenerate')).toBeNull();
  });

  it('ignores a regenerate error that arrives after the selection changes', async () => {
    fetchTicketMock.mockImplementation(async (id) =>
      ticket({ id, subject: id, purchaseDate: undefined, internalNotes: [] })
    );
    fetchTriageMock.mockImplementation(async (id) => triage({ ticketId: id, reply: `ready ${id}` }));
    const regen = deferred<TriageResult>();
    generateTriageMock.mockReturnValue(regen.promise);

    const view = render(<TicketView ticketId="T-1003" onTriageComplete={vi.fn()} />);
    expect(await screen.findByText('ready T-1003')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI Triage' }));
    view.rerender(<TicketView ticketId="T-1012" onTriageComplete={vi.fn()} />);
    regen.reject(new Error('stale error'));

    expect(await screen.findByText('ready T-1012')).toBeTruthy();
    expect(screen.queryByText('stale error')).toBeNull();
  });
});
