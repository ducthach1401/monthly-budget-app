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

  // Danh sách giờ nhắc nhở, format "HH:mm", ví dụ: ["08:00", "12:00", "21:00"]
  @Column({ type: 'simple-array' })
  reminderTimes: string[];

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
