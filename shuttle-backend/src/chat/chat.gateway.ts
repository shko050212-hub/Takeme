import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { forwardRef, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import type { JwtPayload } from '../auth/auth-user.decorator';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.query?.token as string | undefined);

    if (token) {
      try {
        const user = await this.jwtService.verifyAsync<JwtPayload>(token);
        client.data.user = user;
        if (user?.sub) {
          client.join(`user_${user.sub}`);
        }
      } catch {
        // invalid token fallback
      }
    }
  }

  handleDisconnect(client: Socket) {
    // client disconnected
  }

  /**
   * 채팅방 메시지 전송 및 참여자별 개인방(user_{id}) 알림
   * (server.emit 전체 전송 금지)
   */
  broadcastMessageToRoom(roomId: number, message: any, memberUserIds: number[]) {
    if (!this.server) return;
    const room = `chat_${roomId}`;
    this.server.to(room).emit('receiveMessage', message);

    for (const uid of memberUserIds) {
      this.server.to(`user_${uid}`).emit('roomUpdated', { roomId });

      if (uid !== message.sender?.id) {
        this.server.to(`user_${uid}`).emit('notificationReceived', {
          type: 'MESSAGE',
          roomId,
          title: message.sender?.name ? `${message.sender.name}님의 메시지` : '새 메시지',
          message: message.text,
          senderId: message.sender?.id,
          senderName: message.sender?.name,
          createdAt: message.createdAt,
        });
      }
    }
  }

  /**
   * 메시지 읽음 처리 브로드캐스트
   */
  broadcastReadStatus(roomId: number, readerUserId: number) {
    if (!this.server) return;
    const room = `chat_${roomId}`;
    this.server.to(room).emit('messagesRead', { roomId, readerUserId });
    this.server.to(`user_${readerUserId}`).emit('roomUpdated', { roomId });
  }

  @SubscribeMessage('joinChatRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = Number(data?.roomId);
    if (!roomId) return;

    const user = client.data?.user as JwtPayload | undefined;
    if (user?.sub) {
      const isMember = await this.chatService.isUserRoomMember(roomId, user.sub);
      if (isMember) {
        client.join(`chat_${roomId}`);
      }
    }
  }

  @SubscribeMessage('leaveChatRoom')
  handleLeaveRoom(
    @MessageBody() data: { roomId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = Number(data?.roomId);
    if (roomId) {
      client.leave(`chat_${roomId}`);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: { roomId: number; text: string; senderEmail?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data?.user as JwtPayload | undefined;
    if (!data?.roomId || !data?.text) return;

    if (user?.sub) {
      return this.chatService.sendMessage(Number(data.roomId), user.sub, data.text);
    } else if (data.senderEmail) {
      return this.chatService.sendMessageAndBroadcast(Number(data.roomId), data.senderEmail, data.text);
    }
  }

  @SubscribeMessage('readMessages')
  async handleReadMessages(
    @MessageBody() data: { roomId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data?.user as JwtPayload | undefined;
    if (data?.roomId && user?.sub) {
      return this.chatService.markRoomAsRead(Number(data.roomId), user.sub);
    }
  }
}
