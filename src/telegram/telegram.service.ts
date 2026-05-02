import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatService } from '../chat/chat.service';
import {
  TelegramMessageEntity,
  TelegramMessageRole,
} from './entities/telegram-message.entity';
import { TelegramUserEntity } from './entities/telegram-user.entity';
import { TelegramUpdate } from './telegram.types';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly webhookSecret: string | null;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    @InjectRepository(TelegramUserEntity)
    private readonly userRepository: Repository<TelegramUserEntity>,
    @InjectRepository(TelegramMessageEntity)
    private readonly messageRepository: Repository<TelegramMessageEntity>,
  ) {
    this.botToken = this.configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    this.webhookSecret =
      this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? null;
    this.model = this.configService.get<string>(
      'GROQ_MODEL',
      'llama-3.3-70b-versatile',
    );
  }

  validateWebhookSecret(secretHeader?: string): boolean {
    if (!this.webhookSecret) {
      return true;
    }
    return secretHeader === this.webhookSecret;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.from || !message.text?.trim()) {
      return;
    }

    const telegramUserId = String(message.from.id);
    const chatId = String(message.chat.id);
    const content = message.text.trim();

    let user = await this.userRepository.findOne({
      where: { telegramUserId },
    });

    if (!user) {
      user = this.userRepository.create({
        telegramUserId,
        chatId,
        username: message.from.username ?? null,
        firstName: message.from.first_name ?? null,
        lastName: message.from.last_name ?? null,
      });
      user = await this.userRepository.save(user);
      this.logger.log(`Created telegram user ${telegramUserId}`);
    } else {
      user.chatId = chatId;
      user.username = message.from.username ?? null;
      user.firstName = message.from.first_name ?? null;
      user.lastName = message.from.last_name ?? null;
      user = await this.userRepository.save(user);
    }

    await this.messageRepository.save(
      this.messageRepository.create({
        telegramMessageId: String(message.message_id),
        chatId,
        role: TelegramMessageRole.USER,
        content,
        model: this.model,
        user,
      }),
    );

    const botReply = await this.chatService.chat({
      message: content,
      model: this.model,
    });

    await this.sendTelegramMessage(chatId, botReply.content);

    await this.messageRepository.save(
      this.messageRepository.create({
        telegramMessageId: null,
        chatId,
        role: TelegramMessageRole.ASSISTANT,
        content: botReply.content,
        model: this.model,
        user,
      }),
    );
  }

  private async sendTelegramMessage(
    chatId: string,
    text: string,
  ): Promise<void> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      },
    );

    if (!response.ok) {
      const payload = await response.text();
      this.logger.error(`Telegram sendMessage failed: ${payload}`);
    }
  }
}
