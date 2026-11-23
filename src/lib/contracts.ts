export type Role = 'cliente' | 'organizador' | 'portero';

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  name: string;
}

export interface EventInput {
  name: string;
  date: string;
  venue: string;
  imageUrl: string;
  description: string;
}

export interface SectorInput {
  name: string;
  unitPriceMinor: number;
  capacity: number;
}

export interface Selection {
  eventId: string;
  sectorId: string;
  quantity: number;
}

export interface Purchase extends Selection {
  recipientEmail: string;
  paymentCode: string;
}

export interface EventSnapshot {
  eventId: string;
  eventName: string;
  eventDate: string;
  eventVenue: string;
  sectorName: string;
}

export interface Reservation extends EventSnapshot, Selection {
  orderId: string;
  organizerId: string;
  unitPriceMinor: number;
  currency: 'BOB';
}

export interface PaymentInput {
  amountMinor: number;
  currency: 'BOB';
  paymentCode: string;
}

export interface IssueTickets extends EventSnapshot, Selection {
  customerId: string;
}

export interface CheckinInput {
  eventId: string;
  code: string;
}
