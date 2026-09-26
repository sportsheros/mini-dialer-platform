export type AgentStatus = 'offline' | 'available' | 'busy';
export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed';
export type LeadStatus = 'pending' | 'dialing' | 'completed' | 'failed' | 'dnc';
export type CallStatus =
  'initiated' | 'ringing' | 'answered' | 'completed' | 'failed' | 'no_answer' | 'abandoned';

export const CALL_STATUSES: CallStatus[] = [
  'initiated',
  'ringing',
  'answered',
  'completed',
  'failed',
  'no_answer',
  'abandoned',
];
export const LIVE_CALL_STATUSES: CallStatus[] = ['initiated', 'ringing', 'answered'];

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

export interface Agent {
  id: string;
  name: string;
  email: string;
  status: AgentStatus;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  maxCps: number;
  maxAttempts: number;
  createdAt: string;
}

export interface CampaignStats {
  campaignId: string;
  totalLeads: number;
  leadsByStatus: Record<LeadStatus, number>;
  totalCalls: number;
  callsByStatus: Record<CallStatus, number>;
  callsInProgress: number;
  callsAnswered: number;
  answerRate: number;
  avgDurationSec: number | null;
  avgQaScore: number | null;
  generatedAt: string;
}

export interface CallListItem {
  id: string;
  status: CallStatus;
  leadId: string;
  agentId: string | null;
  campaignId: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  qaScore: number | null;
  createdAt: string;
  lead?: { id: string; phone: string; name: string | null };
  agent?: { id: string; name: string } | null;
}

export interface CallEvent {
  id: string;
  providerEventId: string;
  type: string;
  payload: Record<string, unknown> | null;
  occurredAt: string;
  receivedAt: string;
  applied: boolean;
  note: string | null;
}

export interface CallDetail extends CallListItem {
  providerCallId: string;
  transcript: string | null;
  summary: string | null;
  qaFlags: string[] | null;
  campaign?: { id: string; name: string };
  events: CallEvent[];
}

export interface UploadResult {
  inserted: number;
  duplicates: number;
  dnc: number;
  invalid: number;
}

/** Shape pushed over Socket.IO `call:updated`. */
export interface RealtimeCall {
  id: string;
  status: CallStatus;
  campaignId: string;
  leadId: string;
  agentId: string | null;
  phone: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  qaScore?: number | null;
  createdAt: string;
}

export interface CallFilters {
  status?: CallStatus | '';
  agentId?: string;
  campaignId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}
