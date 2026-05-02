import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TelegramUserEntity } from '../../telegram/entities/telegram-user.entity';

@Entity({ name: 'reminder_settings' })
export class ReminderSettingEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => TelegramUserEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: TelegramUserEntity;

  // Format "HH:mm", ví dụ: "20:00"
  @Column({ type: 'varchar', length: 5 })
  reminderTime: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
