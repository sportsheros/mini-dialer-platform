import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Global Do-Not-Call list. The phone itself is the key: lookups are always "is X on the list?". */
@Entity('dnc_numbers')
export class DncNumber {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
