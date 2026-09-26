import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AgentStatus, values } from './enums';

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index('UQ_agents_email', { unique: true })
  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({
    type: 'enum',
    enum: values(AgentStatus),
    enumName: 'agent_status',
    default: AgentStatus.Offline,
  })
  status: AgentStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
