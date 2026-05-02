import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ReminderSettingEntity } from './entities/reminder-setting.entity';
import { TelegramUserEntity } from '../telegram/entities/telegram-user.entity';
import { BudgetService } from './budget.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    @InjectRepository(ReminderSettingEntity)
    private readonly reminderRepository: Repository<ReminderSettingEntity>,
    private readonly budgetService: BudgetService,
  ) {}

  async setReminder(user: TelegramUserEntity, time: string): Promise<void> {
    let setting = await this.reminderRepository.findOne({
      where: { user: { id: user.id } },
    });
    if (setting) {
      setting.reminderTime = time;
      setting.enabled = true;
    } else {
      setting = this.reminderRepository.create({
        user,
        reminderTime: time,
        enabled: true,
      });
    }
    await this.reminderRepository.save(setting);
  }

  async disableReminder(userId: number): Promise<boolean> {
    const setting = await this.reminderRepository.findOne({
      where: { user: { id: userId } },
    });
    if (!setting) return false;
    setting.enabled = false;
    await this.reminderRepository.save(setting);
    return true;
  }

  async getReminder(userId: number): Promise<ReminderSettingEntity | null> {
    return this.reminderRepository.findOne({ where: { user: { id: userId } } });
  }

  // Chạy mỗi phút, kiểm tra ai cần nhận nhắc nhở
  @Cron('* * * * *')
  async sendReminders(): Promise<void> {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    const settings = await this.reminderRepository.find({
      where: { reminderTime: currentTime, enabled: true },
      relations: ['user'],
    });

    for (const setting of settings) {
      const user = setting.user;
      const currentMonth = now.toISOString().substring(0, 7);
      const financialContext = await this.budgetService.buildFinancialContext(
        user.id,
        currentMonth,
      );

      const message =
        `⏰ Nhắc nhở hàng ngày!\n\n` +
        `${financialContext}\n\n` +
        `Hôm nay bạn đã ghi đủ chi tiêu chưa? 💰`;

      await this.sendTelegramMessage(user.chatId, message);
      this.logger.log(`Sent reminder to user ${user.telegramUserId}`);
    }
  }

  private async sendTelegramMessage(
    chatId: string,
    text: string,
  ): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
    if (!response.ok) {
      const payload = await response.text();
      this.logger.error(`Reminder sendMessage failed: ${payload}`);
    }
  }
}
