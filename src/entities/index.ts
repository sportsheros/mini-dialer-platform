import { Agent } from './Agent';
import { Call } from './Call';
import { CallEvent } from './CallEvent';
import { Campaign } from './Campaign';
import { DncNumber } from './DncNumber';
import { Lead } from './Lead';

export { Agent, Call, CallEvent, Campaign, DncNumber, Lead };
export * from './enums';

export const entities = [Agent, Campaign, Lead, DncNumber, Call, CallEvent];
