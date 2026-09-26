import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Call } from './Call';

/**
 * Append-only log of every provider event we accepted, including ones the state machine ignored.
 * The UNIQUE providerEventId is the idempotency guard for webhook retries.
 */
@Entity('call_events')
@Index('IDX_call_events_call_occurred', ['callId', 'occurredAt'])
export class CallEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  callId: string;

  @ManyToOne('Call', (c: Call) => c.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call?: Call;

  @Index('UQ_call_events_provider_event_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  providerEventId: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  /** When the provider says it happened (the event `timestamp`). */
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  /** When we received it. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  /** false = stored for audit but ignored by the state machine (out-of-order / invalid). */
  @Column({ type: 'boolean', default: true })
  applied: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
