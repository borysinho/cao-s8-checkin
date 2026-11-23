import type { Pool } from 'pg';
import type { Api, Log } from './lib/api.ts';
import type { CheckinInput } from './lib/contracts.ts';
import { unavailable } from './lib/api.ts';
import { internalRequest } from './lib/http.ts';

const gatekeeper = { role: 'portero' } as const;

export function mount(api: Api, { pool, log }: { pool: Pool; log: Log }) {
  api.route<CheckinInput>('registerCheckin', gatekeeper, async (req, res) => {
    const { code } = req.body;
    const eventId = req.body.eventId.toLowerCase();
    const result = await internalRequest<{ ticketId: string; eventId: string }>('TICKETS_URL', 'TICKETS_CHECKIN_TOKEN', '/internal/tickets/lookup', {
      method: 'POST', operationId: 'lookupTicket', body: { code },
    });
    if (result.status === 404 && result.body?.code === 'NOT_FOUND') {
      return res.json({ allowed: false, reason: 'INVALID_CODE' });
    }
    if (result.status !== 200 || !result.body) {
      log('warn', 'Consulta a tickets indisponible.', { eventId });
      throw unavailable();
    }
    const { ticketId } = result.body;
    if (result.body.eventId.toLowerCase() !== eventId) return res.json({ allowed: false, reason: 'WRONG_EVENT' });
    const { rows: [admission] } = await pool.query<{ admitted_at: Date }>(
      `INSERT INTO admissions (ticket_id, event_id, gatekeeper_id) VALUES ($1,$2,$3)
       ON CONFLICT (ticket_id) DO NOTHING RETURNING admitted_at`,
      [ticketId, eventId, req.actor.sub],
    );
    if (admission) {
      log('info', 'Ingreso registrado.', { eventId, ticketId });
      return res.json({ allowed: true, admittedAt: admission.admitted_at.toISOString() });
    }
    const { rows: [previous] } = await pool.query<{ admitted_at: Date }>(
      'SELECT admitted_at FROM admissions WHERE ticket_id=$1', [ticketId],
    );
    return res.json({ allowed: false, reason: 'ALREADY_USED', firstAdmittedAt: previous.admitted_at.toISOString() });
  });

  api.route('getAttendance', gatekeeper, async (req, res) => {
    const { eventId } = req.params;
    const { rows: [count] } = await pool.query('SELECT COUNT(*) FROM admissions WHERE event_id=$1', [eventId]);
    res.json({ eventId, admittedCount: Number(count.count) });
  });
}
