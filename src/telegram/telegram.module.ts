import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetModule } from '../budget/budget.module';
import { TelegramMessageEntity } from './entities/telegram-message.entity';
import { TelegramUserEntity } from './entities/telegram-user.entity';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramUserEntity, TelegramMessageEntity]),
    BudgetModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
