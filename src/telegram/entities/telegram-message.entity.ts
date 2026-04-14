import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TelegramUserEntity } from './telegram-user.entity';

export enum TelegramMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

@Entity({ name: 'telegram_messages' })
export class TelegramMessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  telegramMessageId: string | null;

  @Column({ type: 'varchar', length: 50 })
  chatId: string;

  @Column({
    type: 'enum',
    enum: TelegramMessageRole,
  })
  role: TelegramMessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  model: string | null;

  @ManyToOne(() => TelegramUserEntity, (user) => user.messages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: TelegramUserEntity;

  @CreateDateColumn()
  createdAt: Date;
}
