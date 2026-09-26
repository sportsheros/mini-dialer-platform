import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CampaignStatus, values } from './enums';
import type { Lead } from './Lead';

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({
    type: 'enum',
    enum: values(CampaignStatus),
    enumName: 'campaign_status',
    default: CampaignStatus.Draft,
  })
  status: CampaignStatus;

  /** Max new calls placed per second for this campaign (enforced across all dialer workers). */
  @Column({ type: 'int', default: 2 })
  maxCps: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts: number;

  @OneToMany('Lead', (lead: Lead) => lead.campaign)
  leads?: Lead[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
