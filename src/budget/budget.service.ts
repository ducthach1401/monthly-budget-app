import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import {
  TransactionCategory,
  TransactionEntity,
  TransactionType,
} from './entities/transaction.entity';
import { TelegramUserEntity } from '../telegram/entities/telegram-user.entity';

interface ExtractedTransaction {
  type: TransactionType;
  amount: number;
  category: TransactionCategory;
  description: string;
  date: string; // YYYY-MM-DD
}

export type { ExtractedTransaction };

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('GROQ_API_KEY', ''),
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.model = this.configService.get<string>(
      'GROQ_MODEL',
      'llama-3.3-70b-versatile',
    );
  }

  async extractTransaction(
    message: string,
    today: string,
  ): Promise<ExtractedTransaction | null> {
    const categories = Object.values(TransactionCategory).join(', ');
    const prompt = `Hôm nay là ${today}. Phân tích tin nhắn sau và trích xuất thông tin giao dịch tài chính nếu có.

Tin nhắn: "${message}"

Trả về JSON theo format sau nếu tin nhắn có giao dịch (thu/chi tiền):
{
  "type": "income" hoặc "expense",
  "amount": số tiền (số nguyên, đơn vị VND. Ví dụ: 50k = 50000, 1tr = 1000000, 1.5tr = 1500000),
  "category": một trong [${categories}],
  "description": mô tả ngắn gọn,
  "date": "YYYY-MM-DD" (nếu không rõ ngày thì dùng hôm nay)
}

Nếu tin nhắn KHÔNG phải ghi chép giao dịch (ví dụ: hỏi báo cáo, hỏi tổng chi, trò chuyện thông thường), trả về: null

Chỉ trả về JSON hoặc null, không giải thích thêm.`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });

      const raw = response.choices[0].message.content?.trim() ?? '';
      if (raw === 'null' || raw === '') return null;

      const parsed = JSON.parse(raw) as ExtractedTransaction;
      if (!parsed.amount || parsed.amount <= 0) return null;
      return parsed;
    } catch (e) {
      this.logger.warn(`Could not extract transaction: ${String(e)}`);
      return null;
    }
  }

  async saveTransaction(
    extracted: ExtractedTransaction,
    user: TelegramUserEntity,
  ): Promise<TransactionEntity> {
    const month = extracted.date.substring(0, 7); // YYYY-MM
    const tx = this.transactionRepository.create({
      type: extracted.type,
      amount: extracted.amount,
      category: extracted.category,
      description: extracted.description,
      month,
      user,
    });
    // store date in description for reference
    tx.description = `[${extracted.date}] ${extracted.description}`;
    return this.transactionRepository.save(tx);
  }

  async getMonthTransactions(
    userId: number,
    month: string,
  ): Promise<TransactionEntity[]> {
    return this.transactionRepository.find({
      where: { user: { id: userId }, month },
      order: { createdAt: 'ASC' },
    });
  }

  async getDayTransactions(
    userId: number,
    date: string,
  ): Promise<TransactionEntity[]> {
    // date format: YYYY-MM-DD — stored in description as [YYYY-MM-DD]
    const month = date.substring(0, 7);
    const all = await this.getMonthTransactions(userId, month);
    return all.filter((tx) => tx.description.startsWith(`[${date}]`));
  }

  async buildFinancialContext(
    userId: number,
    currentMonth: string,
  ): Promise<string> {
    const transactions = await this.getMonthTransactions(userId, currentMonth);
    if (transactions.length === 0) {
      return `Tháng ${currentMonth}: Chưa có giao dịch nào được ghi lại.`;
    }

    const income = transactions
      .filter((t) => t.type === TransactionType.INCOME)
      .reduce((s, t) => s + Number(t.amount), 0);
    const expense = transactions
      .filter((t) => t.type === TransactionType.EXPENSE)
      .reduce((s, t) => s + Number(t.amount), 0);

    const lines = transactions.map(
      (t) =>
        `- ${t.description} | ${t.type === TransactionType.INCOME ? '+' : '-'}${Number(t.amount).toLocaleString('vi-VN')}đ | ${t.category}`,
    );

    return `Dữ liệu tháng ${currentMonth}:
Tổng thu: ${income.toLocaleString('vi-VN')}đ
Tổng chi: ${expense.toLocaleString('vi-VN')}đ
Còn lại: ${(income - expense).toLocaleString('vi-VN')}đ

Chi tiết:
${lines.join('\n')}`;
  }

  async deleteAllUserData(userId: number): Promise<void> {
    await this.transactionRepository.delete({ user: { id: userId } });
  }

  async deleteTransactionById(
    id: number,
    userId: number,
  ): Promise<TransactionEntity | null> {
    const tx = await this.transactionRepository.findOne({
      where: { id, user: { id: userId } },
    });
    if (!tx) return null;
    await this.transactionRepository.delete({ id });
    return tx;
  }

  async getLastTransaction(userId: number): Promise<TransactionEntity | null> {
    const results = await this.transactionRepository.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    return results[0] ?? null;
  }

  async getRecentTransactions(
    userId: number,
    limit = 5,
  ): Promise<TransactionEntity[]> {
    return this.transactionRepository.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async updateTransactionAmount(
    id: number,
    userId: number,
    newAmount: number,
  ): Promise<TransactionEntity | null> {
    const tx = await this.transactionRepository.findOne({
      where: { id, user: { id: userId } },
    });
    if (!tx) return null;
    tx.amount = newAmount;
    return this.transactionRepository.save(tx);
  }

  async findTransactionByDescriptionHint(
    userId: number,
    hint: string,
  ): Promise<TransactionEntity | null> {
    const all = await this.transactionRepository.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const lowerHint = hint.toLowerCase();
    return (
      all.find((tx) => tx.description.toLowerCase().includes(lowerHint)) ?? null
    );
  }

  buildTransactionAddedMessage(
    tx: TransactionEntity,
    income: number,
    expense: number,
  ): string {
    const sign = tx.type === TransactionType.INCOME ? '+' : '-';
    const typeLabel =
      tx.type === TransactionType.INCOME ? '💰 Thu nhập' : '💸 Chi tiêu';
    return (
      `✅ Đã ghi lại:\n` +
      `${typeLabel}: ${sign}${Number(tx.amount).toLocaleString('vi-VN')}đ\n` +
      `📂 Danh mục: ${tx.category}\n` +
      `📝 ${tx.description}\n\n` +
      `📊 Tháng này:\n` +
      `  Thu: +${income.toLocaleString('vi-VN')}đ\n` +
      `  Chi: -${expense.toLocaleString('vi-VN')}đ\n` +
      `  Còn lại: ${(income - expense).toLocaleString('vi-VN')}đ\n\n` +
      `Ghi nhầm? Gõ "xóa khoản vừa ghi" để hủy hoặc "xóa khoản #${tx.id}" nếu muốn xóa khoản cụ thể.`
    );
  }
}
