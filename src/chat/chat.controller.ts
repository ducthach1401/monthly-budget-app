import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatDto } from './dto/chat.dto';

@Controller('api/v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(@Body() chatDto: ChatDto) {
    try {
      const response = await this.chatService.chat(chatDto);
      return {
        success: true,
        data: response,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('stream')
  async chatStream(@Body() chatDto: ChatDto, @Res() res: Response) {
    try {
      await this.chatService.chatStream(chatDto, res);
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @Get('models')
  async listModels() {
    try {
      const models = await this.chatService.listModels();
      return {
        success: true,
        data: models,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
