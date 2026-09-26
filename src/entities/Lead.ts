import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { LeadStatus, values } from './enums';
import type { Campaign } from './Campaign';

@Entity('leads')
@Unique('UQ_leads_campaign_phone', ['campaignId', 'phone'])
@Index('IDX_leads_campaign_status', ['campaignId', 'status'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  campaignId: string;

  @ManyToOne('Campaign', (c: Campaign) => c.leads, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaignId' })
  campaign?: Campaign;

  /** E.164, e.g. +14155550123 */
  @Column({ type: 'varchar', length: 16 })
  phone: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  @Column({
    type: 'enum',
    enum: values(LeadStatus),
    enumName: 'lead_status',
    default: LeadStatus.Pending,
  })
  status: LeadStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
