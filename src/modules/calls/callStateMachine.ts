import { CallEventType, CallStatus } from '../../entities';

/**
 * Allowed call status transitions. Anything not listed is rejected.
 *
 *   initiated ─► ringing ─► answered ─► completed
 *       │           │           │
 *       │           ├─► no_answer
 *       └───────────┴───────────┴─► failed          (any non-terminal state can fail)
 *
 * Two pragmatic extras:
 *  - initiated → answered / no_answer: providers can drop or reorder the `ringing` webhook; we must
 *    not strand a live call just because an intermediate event is missing. A late `ringing` is then
 *    simply ignored (answered → ringing is not allowed).
 *  - answered → abandoned is internal: set by routing when no agent is free.
 */
const TRANSITIONS: Record<CallStatus, readonly CallStatus[]> = {
  [CallStatus.Initiated]: [
    CallStatus.Ringing,
    CallStatus.Answered,
    CallStatus.NoAnswer,
    CallStatus.Failed,
  ],
  [CallStatus.Ringing]: [CallStatus.Answered, CallStatus.NoAnswer, CallStatus.Failed],
  [CallStatus.Answered]: [CallStatus.Completed, CallStatus.Failed, CallStatus.Abandoned],
  [CallStatus.Completed]: [],
  [CallStatus.Failed]: [],
  [CallStatus.NoAnswer]: [],
  [CallStatus.Abandoned]: [],
};

const EVENT_TO_STATUS: Record<CallEventType, CallStatus> = {
  [CallEventType.Ringing]: CallStatus.Ringing,
  [CallEventType.Answered]: CallStatus.Answered,
  [CallEventType.Completed]: CallStatus.Completed,
  [CallEventType.NoAnswer]: CallStatus.NoAnswer,
  [CallEventType.Failed]: CallStatus.Failed,
};

export const TERMINAL_STATUSES: readonly CallStatus[] = [
  CallStatus.Completed,
  CallStatus.Failed,
  CallStatus.NoAnswer,
  CallStatus.Abandoned,
];

export const ACTIVE_STATUSES: readonly CallStatus[] = [
  CallStatus.Initiated,
  CallStatus.Ringing,
  CallStatus.Answered,
];

export function statusForEvent(type: CallEventType): CallStatus {
  return EVENT_TO_STATUS[type];
}

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
