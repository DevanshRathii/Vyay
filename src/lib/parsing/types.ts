/** A Gmail message reduced to what the parser needs. */
export interface EmailMessage {
  id: string;
  threadId?: string;
  /** Gmail internalDate, ms epoch — when the mail arrived. */
  internalDate: number;
  from: string;
  subject: string;
  /** Plain-text body (HTML already stripped). */
  body: string;
  snippet?: string;
}

export type Direction = "debit" | "credit";

export interface ParsedTransaction {
  amountPaise: number;
  currency: string;
  direction: Direction;
  merchant?: string;
  channel?: string;
  bank?: string;
  referenceNumber?: string;
  upiId?: string;
  cardLast4?: string;
  /** ms epoch — parsed from the email body when possible, else internalDate. */
  occurredAt: number;
  /** 0–1, how confident the parser is in this extraction. */
  confidence: number;
  /** Provider id that matched, or "generic". */
  provider: string;
}

/**
 * A provider describes one bank / payment app: how to recognise its emails
 * and any hints that improve extraction. The generic extraction engine does
 * the heavy lifting; providers mostly supply sender patterns and defaults.
 *
 * To add a new provider: append an entry to PROVIDERS in providers.ts and
 * (optionally) a Gmail sender domain to its `queryDomains`. That's it.
 */
export interface Provider {
  id: string;
  name: string;
  /** Matched against the From header. */
  senders: RegExp[];
  /** Domains/addresses added to the Gmail sync search query. */
  queryDomains: string[];
  /** Bank name recorded on transactions from this sender. */
  bank?: string;
  /** Default payment channel when the body doesn't reveal one. */
  channelHint?: string;
}

export interface DetectionResult {
  isTransaction: boolean;
  reason: string;
}
