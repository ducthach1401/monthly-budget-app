import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import { ChatDto } from './dto/chat.dto';
import type { Response } from 'express';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly ollama: Ollama;
  private readonly defaultModel: string;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>(
      'OLLAMA_HOST',
      'http://localhost:11434',
    );
    this.defaultModel = this.configService.get<string>(
      'OLLAMA_MODEL',
      'llama3.2',
    );
    this.ollama = new Ollama({ host });
    this.logger.log(
      `Ollama configured at ${host} with default model: ${this.defaultModel}`,
    );
  }

  async chat(chatDto: ChatDto): Promise<{ role: string; content: string }> {
    const model = chatDto.model || this.defaultModel;
    const messages = [
      ...(chatDto.history || []),
      { role: 'user' as const, content: chatDto.message },
    ];

    this.logger.log(`Sending chat request to model: ${model}`);

    const response = await this.ollama.chat({
      model,
      messages,
    });

    return {
      role: response.message.role,
      content: response.message.content,
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

    const stream = await this.ollama.chat({
      model,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const data = JSON.stringify({
        role: chunk.message.role,
        content: chunk.message.content,
        done: chunk.done,
      });
      res.write(`data: ${data}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  async listModels() {
    return this.ollama.list();
  }

  async pullModel(modelName: string) {
    this.logger.log(`Pulling model: ${modelName}`);
    return this.ollama.pull({ model: modelName });
  }
}
