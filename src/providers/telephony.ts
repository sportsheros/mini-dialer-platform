export interface DialRequest {
  callId: string;
  /**
   * Our pre-generated correlation id, passed to the provider as the channel/origination id.
   * Every webhook the provider sends back carries it.
   */
  providerCallId: string;
  phone: string;
  campaignId: string;
}

/**
 * Boundary to the telephony platform (FreeSWITCH/Asterisk/Twilio...). `dial()` only needs to
 * *originate* the call; progress (ringing/answered/completed/...) arrives asynchronously via
 * signed webhooks to POST /api/webhooks/call-events.
 */
export interface TelephonyProvider {
  dial(request: DialRequest): Promise<void>;
  /** Stop any background work (timers, sockets). */
  close(): Promise<void>;
}

export interface TelephonyEvent {
  eventId: string;
  providerCallId: string;
  type: 'ringing' | 'answered' | 'completed' | 'no_answer' | 'failed';
  timestamp: string;
  payload?: Record<string, unknown>;
}
