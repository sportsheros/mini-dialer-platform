import { CallEventType, CallStatus, values } from '../../src/entities';
import {
  canTransition,
  isTerminal,
  statusForEvent,
  TERMINAL_STATUSES,
} from '../../src/modules/calls/callStateMachine';

describe('call state machine', () => {
  it.each([
    [CallStatus.Initiated, CallStatus.Ringing],
    [CallStatus.Ringing, CallStatus.Answered],
    [CallStatus.Answered, CallStatus.Completed],
    [CallStatus.Ringing, CallStatus.NoAnswer],
    [CallStatus.Initiated, CallStatus.Failed],
    [CallStatus.Ringing, CallStatus.Failed],
    [CallStatus.Answered, CallStatus.Failed],
    // tolerated: provider dropped/reordered the ringing webhook
    [CallStatus.Initiated, CallStatus.Answered],
    [CallStatus.Initiated, CallStatus.NoAnswer],
    // internal: no agent free
    [CallStatus.Answered, CallStatus.Abandoned],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [CallStatus.Answered, CallStatus.Ringing], // late ringing (out of order)
    [CallStatus.Answered, CallStatus.NoAnswer],
    [CallStatus.Ringing, CallStatus.Completed], // must be answered first
    [CallStatus.Initiated, CallStatus.Completed],
    [CallStatus.Ringing, CallStatus.Ringing], // same-state repeat
    [CallStatus.Initiated, CallStatus.Abandoned],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('allows nothing out of a terminal state', () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of values(CallStatus)) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('classifies terminal states', () => {
    expect(isTerminal(CallStatus.Completed)).toBe(true);
    expect(isTerminal(CallStatus.Abandoned)).toBe(true);
    expect(isTerminal(CallStatus.Answered)).toBe(false);
    expect(isTerminal(CallStatus.Initiated)).toBe(false);
  });

  it('maps every provider event type to a call status', () => {
    for (const type of values(CallEventType)) {
      expect(values(CallStatus)).toContain(statusForEvent(type));
    }
  });
});
