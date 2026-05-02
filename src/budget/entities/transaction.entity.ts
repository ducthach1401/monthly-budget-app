import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TelegramUserEntity } from '../../telegram/entities/telegram-user.entity';

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
}

export enum TransactionCategory {
  // Thu nhập
  SALARY = 'Lương',
  FREELANCE = 'Thu nhập phụ',
  OTHER_INCOME = 'Thu nhập khác',

  // Chi tiêu
  FOOD = 'Ăn uống',
  TRANSPORT = 'Đi lại',
  ENTERTAINMENT = 'Giải trí',
  BILLS = 'Hóa đơn/Tiện ích',
  SHOPPING = 'Mua sắm',
  HEALTH = 'Sức khỏe',
  EDUCATION = 'Giáo dục',
  SAVING = 'Tiết kiệm',
  OTHER = 'Khác',
}

@Entity({ name: 'budget_transactions' })
export class TransactionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'decimal', precision: 15, scale: 0 })
  amount: number;

  @Column({ type: 'enum', enum: TransactionCategory })
  category: TransactionCategory;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'varchar', length: 7 })
  month: string; // format: YYYY-MM

  @ManyToOne(() => TelegramUserEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: TelegramUserEntity;

  @CreateDateColumn()
  createdAt: Date;
}
