import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  @SubscribeMessage('joinChatRoom')
  handleJoinRoom(
    @MessageBody() data: { roomId: number },
    @ConnectedSocket() client: Socket
  ) {
    if (data.roomId) {
      const room = `chat_${data.roomId}`;
      client.join(room);
      console.log(`Client ${client.id} joined chat room ${room}`);
    }
  }

  @SubscribeMessage('leaveChatRoom')
  handleLeaveRoom(
    @MessageBody() data: { roomId: number },
    @ConnectedSocket() client: Socket
  ) {
    if (data.roomId) {
      const room = `chat_${data.roomId}`;
      client.leave(room);
      console.log(`Client ${client.id} left chat room ${room}`);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: { roomId: number; senderEmail: string; text: string }
  ) {
    if (data.roomId && data.senderEmail && data.text) {
      // Save message to DB
      const message = await this.chatService.sendMessageByEmail(data.roomId, data.senderEmail, data.text);

      if (message) {
        // Fetch the full message with sender details
        const fullMessage = (await this.chatService.getMessages(data.roomId)).find(m => m.id === message.id);

        if (fullMessage) {
          // Broadcast to room
          const room = `chat_${data.roomId}`;
          this.server.to(room).emit('receiveMessage', fullMessage);
        }
      }
    }
  }
}
