import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionEntity } from './entities/transaction.entity';
import { ReminderSettingEntity } from './entities/reminder-setting.entity';
import { BudgetService } from './budget.service';
import { ReminderService } from './reminder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionEntity, ReminderSettingEntity]),
  ],
  providers: [BudgetService, ReminderService],
  exports: [BudgetService, ReminderService],
})
export class BudgetModule {}
