export const AgentStatus = {
  Offline: 'offline',
  Available: 'available',
  Busy: 'busy',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const CampaignStatus = {
  Draft: 'draft',
  Running: 'running',
  Paused: 'paused',
  Completed: 'completed',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const LeadStatus = {
  Pending: 'pending',
  Dialing: 'dialing',
  Completed: 'completed',
  Failed: 'failed',
  Dnc: 'dnc',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const CallStatus = {
  Initiated: 'initiated',
  Ringing: 'ringing',
  Answered: 'answered',
  Completed: 'completed',
  Failed: 'failed',
  NoAnswer: 'no_answer',
  Abandoned: 'abandoned',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

/** Event types a telephony provider can send us. */
export const CallEventType = {
  Ringing: 'ringing',
  Answered: 'answered',
  Completed: 'completed',
  NoAnswer: 'no_answer',
  Failed: 'failed',
} as const;
export type CallEventType = (typeof CallEventType)[keyof typeof CallEventType];

export function values<T extends Record<string, string>>(o: T): T[keyof T][] {
  return Object.values(o) as T[keyof T][];
}
