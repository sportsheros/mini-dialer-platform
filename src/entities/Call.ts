import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { CallStatus, values } from './enums';
import type { Agent } from './Agent';
import type { Campaign } from './Campaign';
import type { CallEvent } from './CallEvent';
import type { Lead } from './Lead';

@Entity('calls')
@Index('IDX_calls_agent', ['agentId'])
@Index('IDX_calls_status_created', ['status', 'createdAt'])
@Index('IDX_calls_campaign_created', ['campaignId', 'createdAt'])
@Index('IDX_calls_lead', ['leadId'])
export class Call {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  leadId: string;

  @ManyToOne('Lead', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leadId' })
  lead?: Lead;

  @Column({ type: 'uuid', nullable: true })
  agentId: string | null;

  @ManyToOne('Agent', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agentId' })
  agent?: Agent | null;

  @Column({ type: 'uuid' })
  campaignId: string;

  @ManyToOne('Campaign', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaignId' })
  campaign?: Campaign;

  @Column({
    type: 'enum',
    enum: values(CallStatus),
    enumName: 'call_status',
    default: CallStatus.Initiated,
  })
  status: CallStatus;

  /**
   * Correlation id shared with the telephony provider. We generate it *before* dialing and pass it
   * as the origination id (FreeSWITCH `origination_uuid` style), so a webhook can never arrive for
   * a call row that does not exist yet.
   */
  @Index('UQ_calls_provider_call_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  providerCallId: string;

  @Column({ type: 'timestamptz', nullable: true })
  answeredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  durationSec: number | null;

  @Column({ type: 'text', nullable: true })
  transcript: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'int', nullable: true })
  qaScore: number | null;

  /** QA findings from the LLM audit, e.g. ["greeting_missed"]. */
  @Column({ type: 'jsonb', nullable: true })
  qaFlags: string[] | null;

  @OneToMany('CallEvent', (e: CallEvent) => e.call)
  events?: CallEvent[];

  @VersionColumn()
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
