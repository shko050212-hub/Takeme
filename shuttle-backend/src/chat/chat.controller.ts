import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRoomType } from '../entities/chat-room.entity';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('rooms')
  async getRooms(@Query('email') email: string, @Query('type') type?: string) {
    return this.chatService.getRoomsByEmail(email, type);
  }

  @Get('messages')
  async getMessages(@Query('roomId') roomId: string) {
    return this.chatService.getMessages(parseInt(roomId, 10));
  }

  @Post('rooms')
  async createRoom(
    @Body('name') name: string,
    @Body('type') type: ChatRoomType,
    @Body('userIds') userIds: number[],
    @Body('creatorEmail') creatorEmail: string
  ) {
    return this.chatService.createRoomByEmail(name, type, userIds, creatorEmail);
  }
}
