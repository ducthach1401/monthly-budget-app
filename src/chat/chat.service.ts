import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatDto } from './dto/chat.dto';
import type { Response } from 'express';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY', '');
    this.defaultModel = this.configService.get<string>(
      'GROQ_MODEL',
      'llama-3.3-70b-versatile',
    );
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.logger.log(`Groq configured with default model: ${this.defaultModel}`);
  }

  async chat(chatDto: ChatDto): Promise<{ role: string; content: string }> {
    const model = chatDto.model || this.defaultModel;
    const messages = [
      ...(chatDto.history || []),
      { role: 'user' as const, content: chatDto.message },
    ];

    this.logger.log(`Sending chat request to model: ${model}`);

    const response = await this.client.chat.completions.create({
      model,
      messages,
    });

    const choice = response.choices[0].message;
    return {
      role: choice.role,
      content: choice.content ?? '',
    };
  }

  async chatStream(chatDto: ChatDto, res: Response): Promise<void> {
    const model = chatDto.model || this.defaultModel;
    const messages = [
      ...(chatDto.history || []),
      { role: 'user' as const, content: chatDto.message },
    ];

    this.logger.log(`Sending streaming chat request to model: ${model}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const done = chunk.choices[0]?.finish_reason != null;
      const data = JSON.stringify({
        role: delta?.role ?? 'assistant',
        content: delta?.content ?? '',
        done,
      });
      res.write(`data: ${data}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  async listModels() {
    return this.client.models.list();
  }
}
