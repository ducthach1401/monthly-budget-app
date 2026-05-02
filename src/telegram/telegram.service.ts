import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { BudgetService } from '../budget/budget.service';
import { ReminderService } from '../budget/reminder.service';
import {
  TransactionType,
  TransactionCategory,
  TransactionEntity,
} from '../budget/entities/transaction.entity';
import {
  TelegramMessageEntity,
  TelegramMessageRole,
} from './entities/telegram-message.entity';
import { TelegramUserEntity } from './entities/telegram-user.entity';
import { TelegramUpdate } from './telegram.types';

const CONFIRM_RESET_KEYWORDS = [
  'xác nhận',
  'xac nhan',
  'đồng ý',
  'dong y',
  'yes',
  'có',
  'co',
];

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'add_transaction',
      description: 'Ghi lại một khoản thu nhập hoặc chi tiêu của người dùng',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['income', 'expense'],
            description: 'income = thu nhập, expense = chi tiêu',
          },
          amount: {
            type: 'number',
            description: 'Số tiền (VND). 50k=50000, 1tr=1000000, 1.5tr=1500000',
          },
          category: {
            type: 'string',
            enum: Object.values(TransactionCategory),
            description: 'Danh mục giao dịch',
          },
          description: { type: 'string', description: 'Mô tả ngắn gọn' },
          date: {
            type: 'string',
            description: 'Ngày YYYY-MM-DD, nếu không rõ dùng hôm nay',
          },
        },
        required: ['type', 'amount', 'category', 'description', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_transaction',
      description: 'Xóa một khoản giao dịch đã ghi (ghi nhầm)',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description:
              'ID giao dịch cần xóa. Nếu không biết ID, để trống để xóa khoản gần nhất.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_transactions',
      description: 'Xem danh sách các giao dịch gần đây (kèm ID để có thể xóa)',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Số lượng giao dịch cần xem (mặc định 10)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_monthly_report',
      description: 'Xem báo cáo tổng hợp thu chi của một tháng',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description:
              'Tháng cần xem theo format YYYY-MM, mặc định tháng hiện tại',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description:
        'Đặt nhắc nhở hàng ngày để ghi chi tiêu. Có thể đặt nhiều khung giờ.',
      parameters: {
        type: 'object',
        properties: {
          times: {
            type: 'string',
            description:
              'Các giờ nhắc nhở cách nhau bằng dấu phẩy, format HH:mm, ví dụ "08:00,12:00,21:00"',
          },
        },
        required: ['times'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disable_reminder',
      description: 'Tắt nhắc nhở hàng ngày',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reminder_status',
      description: 'Xem trạng thái nhắc nhở hiện tại (đã đặt chưa, giờ mấy)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description:
        'Sửa số tiền của một khoản giao dịch đã ghi (ghi nhầm số tiền). Sẽ hỏi xác nhận trước khi sửa.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'ID khoản cần sửa. Nếu không biết ID thì để trống.',
          },
          description_hint: {
            type: 'string',
            description:
              'Một phần mô tả khoản cần sửa để tìm kiếm (ví dụ: "tai nghe"). Dùng khi không biết ID.',
          },
          new_amount: {
            type: 'number',
            description: 'Số tiền đúng (VND). 50k=50000, 1tr=1000000',
          },
        },
        required: ['new_amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reset_account',
      description:
        'Xóa toàn bộ dữ liệu tài khoản (giao dịch, lịch sử chat). Yêu cầu xác nhận.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly client: OpenAI;
  private readonly botToken: string;
  private readonly webhookSecret: string | null;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly pendingReset = new Map<string, boolean>();
  private readonly pendingUpdate = new Map<
    string,
    { txId: number; newAmount: number; oldAmount: number; description: string }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly budgetService: BudgetService,
    private readonly reminderService: ReminderService,
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
    this.fallbackModels = this.configService
      .get<string>('GROQ_FALLBACK_MODELS', 'llama-3.1-8b-instant,gemma2-9b-it')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('GROQ_API_KEY', ''),
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  validateWebhookSecret(secretHeader?: string): boolean {
    if (!this.webhookSecret) return true;
    return secretHeader === this.webhookSecret;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.from || !message.text?.trim()) return;

    const telegramUserId = String(message.from.id);
    const chatId = String(message.chat.id);
    const content = message.text.trim();
    const lower = content.toLowerCase();

    let user = await this.userRepository.findOne({ where: { telegramUserId } });

    if (!user) {
      user = this.userRepository.create({
        telegramUserId,
        chatId,
        username: message.from.username ?? null,
        firstName: message.from.first_name ?? null,
        lastName: message.from.last_name ?? null,
      });
      user = await this.userRepository.save(user);
      await this.sendTelegramMessage(
        chatId,
        `Chào ${message.from.first_name ?? 'bạn'}! 👋\n\nTôi là trợ lý quản lý ngân sách của bạn.\n\nChỉ cần nhắn tin tự nhiên là được:\n• "Ăn trưa 50k"\n• "Lương tháng 10tr"\n• "Tháng này tôi chi bao nhiêu?"\n• "Nhắc tôi lúc 8 giờ tối"\n\nBắt đầu thôi! 💪`,
      );
      return;
    }

    user.chatId = chatId;
    user.username = message.from.username ?? null;
    user.firstName = message.from.first_name ?? null;
    user.lastName = message.from.last_name ?? null;
    user = await this.userRepository.save(user);

    // Xử lý xác nhận sửa số tiền
    if (this.pendingUpdate.has(chatId)) {
      const pending = this.pendingUpdate.get(chatId)!;
      this.pendingUpdate.delete(chatId);
      if (CONFIRM_RESET_KEYWORDS.some((k) => lower.includes(k))) {
        const updated = await (
          this.budgetService.updateTransactionAmount as (
            id: number,
            userId: number,
            newAmount: number,
          ) => Promise<TransactionEntity | null>
        )(pending.txId, user.id, pending.newAmount);
        if (!updated) {
          await this.sendTelegramMessage(
            chatId,
            '❌ Không tìm thấy khoản cần sửa.',
          );
        } else {
          await this.sendTelegramMessage(
            chatId,
            `✅ Đã sửa khoản #${pending.txId}:\n` +
              `📝 ${pending.description}\n` +
              `💰 ${pending.oldAmount.toLocaleString('vi-VN')}đ → ${pending.newAmount.toLocaleString('vi-VN')}đ`,
          );
        }
      } else {
        await this.sendTelegramMessage(chatId, '❌ Đã hủy sửa khoản.');
      }
      return;
    }

    // Xử lý xác nhận reset (vẫn giữ vì cần confirmation an toàn)
    if (this.pendingReset.get(chatId)) {
      if (CONFIRM_RESET_KEYWORDS.some((k) => lower.includes(k))) {
        this.pendingReset.delete(chatId);
        await this.budgetService.deleteAllUserData(user.id);
        await this.messageRepository.delete({ chatId });
        await this.userRepository.delete({ id: user.id });
        await this.sendTelegramMessage(
          chatId,
          '✅ Đã xóa toàn bộ dữ liệu. Nhắn tin bất kỳ để bắt đầu lại.',
        );
      } else {
        this.pendingReset.delete(chatId);
        await this.sendTelegramMessage(chatId, '❌ Đã hủy xóa tài khoản.');
      }
      return;
    }

    // Lưu tin nhắn user vào DB
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

    // Gọi AI với function calling
    const today = new Date().toISOString().substring(0, 10);
    const currentMonth = today.substring(0, 7);
    const financialContext = await this.budgetService.buildFinancialContext(
      user.id,
      currentMonth,
    );

    const history = await this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    const systemPrompt = `Bạn là trợ lý quản lý ngân sách thông minh. Hôm nay là ${today}.

Dữ liệu tài chính hiện tại của người dùng:
${financialContext}

Hãy hiểu ý định của người dùng và gọi đúng function. Ví dụ:
- "ăn trưa 50k" → add_transaction (expense, Ăn uống)
- "lương 10tr" → add_transaction (income, Lương)  
- "xóa cái vừa ghi" → delete_transaction
- "tháng này chi gì?" → get_monthly_report
- "nhắc tôi 8 sáng 12 trưa và 21h" → set_reminder (times: "08:00,12:00,21:00")
- "ghi nhầm 700k thôi" / "tai nghe thực ra 700k" → update_transaction (dùng description_hint và new_amount)
- "xóa tài khoản" → reset_account

Nếu không rõ ý định hoặc câu hỏi chung về tài chính, trả lời bằng text thông thường.
Trả lời bằng tiếng Việt, ngắn gọn.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(0, -1).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content },
    ];

    const response = await this.callWithFallback(messages);
    if (!response) {
      await this.sendTelegramMessage(
        chatId,
        '⚠️ Dịch vụ AI đang quá tải, vui lòng thử lại sau ít phút.',
      );
      return;
    }

    const choice = response.choices[0];

    // AI gọi function
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      for (const rawCall of choice.message.tool_calls) {
        const toolCall = rawCall as {
          function: { name: string; arguments: string };
        };
        const args = this.parseToolArgs(toolCall.function.arguments);
        const reply = await this.executeTool(
          toolCall.function.name,
          args,
          user,
          chatId,
          today,
          currentMonth,
        );
        if (reply) {
          await this.sendTelegramMessage(chatId, reply);
          await this.messageRepository.save(
            this.messageRepository.create({
              telegramMessageId: null,
              chatId,
              role: TelegramMessageRole.ASSISTANT,
              content: reply,
              model: this.model,
              user,
            }),
          );
        }
      }
      return;
    }

    // AI trả lời text thường
    const textReply = choice.message.content ?? '';
    if (textReply) {
      await this.sendTelegramMessage(chatId, textReply);
      await this.messageRepository.save(
        this.messageRepository.create({
          telegramMessageId: null,
          chatId,
          role: TelegramMessageRole.ASSISTANT,
          content: textReply,
          model: this.model,
          user,
        }),
      );
    }
  }

  private parseToolArgs(rawArgs?: string): Record<string, unknown> {
    if (!rawArgs?.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(rawArgs);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private isRateLimitError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('rate limit') || msg.includes('429')) return true;
    }
    if (typeof err === 'object' && err !== null && 'status' in err) {
      return (err as { status: number }).status === 429;
    }
    return false;
  }

  private async callWithFallback(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Promise<OpenAI.Chat.Completions.ChatCompletion | null> {
    const modelsToTry = [this.model, ...this.fallbackModels];
    for (const model of modelsToTry) {
      try {
        return await this.client.chat.completions.create({
          model,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
        });
      } catch (err: unknown) {
        if (this.isRateLimitError(err)) {
          this.logger.warn(`Rate limit on model ${model}, trying next...`);
          continue;
        }
        throw err;
      }
    }
    this.logger.error('All models rate-limited');
    return null;
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    user: TelegramUserEntity,
    chatId: string,
    today: string,
    currentMonth: string,
  ): Promise<string | null> {
    switch (name) {
      case 'add_transaction': {
        const extracted = {
          type: args.type as TransactionType,
          amount: Number(args.amount),
          category: args.category as TransactionCategory,
          description: String(args.description),
          date: (args.date as string | undefined) ?? today,
        };
        const saved = await this.budgetService.saveTransaction(extracted, user);
        const allTx = await this.budgetService.getMonthTransactions(
          user.id,
          currentMonth,
        );
        const income = allTx
          .filter((t) => t.type === TransactionType.INCOME)
          .reduce((s, t) => s + Number(t.amount), 0);
        const expense = allTx
          .filter((t) => t.type === TransactionType.EXPENSE)
          .reduce((s, t) => s + Number(t.amount), 0);
        return this.budgetService.buildTransactionAddedMessage(
          saved,
          income,
          expense,
        );
      }

      case 'delete_transaction': {
        const id = args.id ? Number(args.id) : null;
        if (id) {
          const deleted = await this.budgetService.deleteTransactionById(
            id,
            user.id,
          );
          if (!deleted) return `❌ Không tìm thấy khoản #${id}.`;
          return `🗑️ Đã xóa khoản #${id}: ${deleted.description} (${Number(deleted.amount).toLocaleString('vi-VN')}đ)`;
        } else {
          const last = await this.budgetService.getLastTransaction(user.id);
          if (!last) return '❌ Bạn chưa có giao dịch nào để xóa.';
          await this.budgetService.deleteTransactionById(last.id, user.id);
          return `🗑️ Đã xóa khoản vừa ghi: ${last.description} (${Number(last.amount).toLocaleString('vi-VN')}đ)`;
        }
      }

      case 'list_transactions': {
        const limit = args.limit ? Number(args.limit) : 10;
        const recent = await this.budgetService.getRecentTransactions(
          user.id,
          limit,
        );
        if (recent.length === 0) return '📋 Chưa có giao dịch nào.';
        const lines = recent.map(
          (t) =>
            `#${t.id} | ${t.type === TransactionType.INCOME ? '+' : '-'}${Number(t.amount).toLocaleString('vi-VN')}đ | ${t.category}\n  ${t.description}`,
        );
        return `📋 ${limit} giao dịch gần nhất:\n\n${lines.join('\n\n')}\n\nNói "xóa khoản #ID" để xóa khoản cụ thể.`;
      }

      case 'get_monthly_report': {
        const month = (args.month as string | undefined) ?? currentMonth;
        return await this.budgetService.buildFinancialContext(user.id, month);
      }

      case 'set_reminder': {
        const timesRaw =
          (args.times as string | null) ?? (args.time as string | null) ?? '';
        const times = timesRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        await this.reminderService.setReminder(user, times);
        const timeDisplay = times.join(', ');
        return `⏰ Đã đặt nhắc nhở hàng ngày lúc ${timeDisplay}.\nMỗi ngày tôi sẽ gửi tóm tắt chi tiêu cho bạn.\n\nNói "tắt nhắc nhở" để hủy.`;
      }

      case 'disable_reminder': {
        const disabled = await this.reminderService.disableReminder(user.id);
        return disabled
          ? '🔕 Đã tắt nhắc nhở hàng ngày.'
          : '❌ Bạn chưa đặt nhắc nhở nào.';
      }

      case 'get_reminder_status': {
        const setting = await this.reminderService.getReminder(user.id);
        if (!setting || !setting.enabled)
          return '🔕 Bạn chưa đặt nhắc nhở nào.\n\nNói "nhắc tôi lúc 20:00" để đặt.';
        return `⏰ Nhắc nhở hàng ngày lúc ${setting.reminderTimes.join(', ')}.\n\nNói "tắt nhắc nhở" để hủy.`;
      }

      case 'update_transaction': {
        const newAmount = Number(args.new_amount);
        const txId = args.id ? Number(args.id) : null;
        let tx: TransactionEntity | null = null;
        if (txId) {
          const recent = await this.budgetService.getRecentTransactions(
            user.id,
            200,
          );
          tx = recent.find((t) => t.id === txId) ?? null;
        } else if (args.description_hint) {
          tx = await (
            this.budgetService.findTransactionByDescriptionHint as (
              userId: number,
              hint: string,
            ) => Promise<TransactionEntity | null>
          )(user.id, String(args.description_hint as string));
        } else {
          tx = await this.budgetService.getLastTransaction(user.id);
        }
        if (!tx) {
          return '❌ Không tìm thấy khoản giao dịch phù hợp. Bạn có thể dùng "xem giao dịch" để lấy ID rồi thử lại.';
        }
        this.pendingUpdate.set(chatId, {
          txId: tx.id,
          newAmount,
          oldAmount: Number(tx.amount),
          description: tx.description,
        });
        return (
          `🔍 Tôi tìm thấy khoản này:\n` +
          `  #${tx.id} | ${tx.description}\n` +
          `  Số tiền hiện tại: ${Number(tx.amount).toLocaleString('vi-VN')}đ\n\n` +
          `Bạn muốn sửa thành ${newAmount.toLocaleString('vi-VN')}đ không?\n` +
          `Gõ "đồng ý" để xác nhận hoặc bất kỳ tin nhắn khác để hủy.`
        );
      }

      case 'reset_account': {
        this.pendingReset.set(chatId, true);
        return '⚠️ Bạn có chắc muốn xóa toàn bộ dữ liệu (giao dịch, lịch sử chat)?\n\nGõ "xác nhận" để tiếp tục hoặc bất kỳ tin nhắn khác để hủy.';
      }

      default:
        return null;
    }
  }

  private async sendTelegramMessage(
    chatId: string,
    text: string,
  ): Promise<void> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
    if (!response.ok) {
      const payload = await response.text();
      this.logger.error(`Telegram sendMessage failed: ${payload}`);
    }
  }
}
