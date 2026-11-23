CREATE TABLE admissions (
  ticket_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  gatekeeper_id uuid NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admissions_event ON admissions (event_id);
