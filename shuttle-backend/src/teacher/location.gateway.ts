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
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoutingService } from '../routing/routing.service';
import { Vehicle } from '../entities/vehicle.entity';
import { Student } from '../entities/student.entity';
import { User } from '../entities/user.entity';
import { JwtPayload } from '../auth/auth-user.decorator';

@WebSocketGateway({ cors: { origin: '*' } })
export class LocationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Track active operating vehicles in memory: vehicleId -> isOperating
  public operatingVehicles: Map<number, boolean> = new Map();

  constructor(
    private readonly routingService: RoutingService,
    private readonly jwtService: JwtService,
    @InjectRepository(Vehicle) private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Student) private readonly studentRepository: Repository<Student>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.query?.token as string | undefined);
    client.data.allowedSend = new Set<number>();
    client.data.allowedJoin = new Set<number>();
    if (token) {
      try {
        client.data.user = await this.jwtService.verifyAsync<JwtPayload>(token);
      } catch {
        // Allow unauthenticated connection fallback so telemetry is not blocked
      }
    }
    console.log(`Client connected: ${client.id} (${client.data.user?.email ?? 'anonymous/manager'})`);

    // Send current operation status to the newly connected client
    const statusObj: Record<number, boolean> = {};
    this.operatingVehicles.forEach((val, key) => {
      statusObj[key] = val;
    });
    client.emit('allVehicleOperatingStatus', statusObj);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Broadcast operation status to vehicle room and academy room
   * (server.emit 전체 전송 금지 - 유치원 방 또는 차량 방에만 전송)
   */
  async broadcastOperationStatus(vehicleId: number, isOperating: boolean, busNumber?: string, targetAcademyId?: number) {
    this.operatingVehicles.set(vehicleId, isOperating);
    const room = `vehicle_${vehicleId}`;
    const payload = {
      vehicleId,
      busNumber,
      isOperating,
      timestamp: new Date().toISOString()
    };
    if (this.server) {
      this.server.to(room).emit('vehicleOperatingStatus', payload);

      let academyId = targetAcademyId;
      if (!academyId) {
        const v = await this.vehicleRepository.findOne({ where: { id: vehicleId }, relations: { academy: true } });
        academyId = v?.academy?.id;
      }
      if (academyId) {
        this.server.to(`academy_${academyId}`).emit('vehicleOperatingStatus', payload);
      }
    }
  }

  /**
   * Broadcast attendance submission ONLY to academy room: academy_{id}
   * (server.emit 전체 전송 금지)
   */
  broadcastAttendanceSubmitted(academyId: number, data: any) {
    if (!this.server || !academyId) return;
    this.server.to(`academy_${academyId}`).emit('attendanceSubmitted', data);
  }

  @SubscribeMessage('joinVehicleRoom')
  async handleJoinVehicleRoom(
    @MessageBody() data: { vehicleId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const vehicleId = Number(data?.vehicleId);
    if (!vehicleId) return;

    const room = `vehicle_${vehicleId}`;
    client.join(room);
    console.log(`Client ${client.id} joined room ${room}`);

    // If vehicle is currently operating, inform client immediately
    const isOp = this.operatingVehicles.get(vehicleId) || false;
    client.emit('vehicleOperatingStatus', {
      vehicleId,
      isOperating: isOp,
      timestamp: new Date().toISOString()
    });
  }

  @SubscribeMessage('leaveVehicleRoom')
  handleLeaveVehicleRoom(
    @MessageBody() data: { vehicleId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.vehicleId) client.leave(`vehicle_${data.vehicleId}`);
  }

  @SubscribeMessage('joinAcademyRoom')
  async handleJoinAcademyRoom(
    @MessageBody() data: { academyId?: number; token?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const token =
      data?.token ||
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.query?.token as string | undefined);

    let user = client.data.user;
    if (!user && token) {
      try {
        user = await this.jwtService.verifyAsync<JwtPayload>(token);
        client.data.user = user;
      } catch (_) {}
    }

    if (!user) {
      console.warn(`[joinAcademyRoom] Unauthorized join attempt: ${client.id}`);
      return { success: false, message: '인증 토큰이 필요합니다.' };
    }

    let academyId: number | undefined;
    if (user.academyId) {
      academyId = Number(user.academyId);
    } else if (user.email) {
      const dbUser = await this.userRepository.findOne({
        where: { email: user.email },
        relations: { academy: true }
      });
      if (dbUser?.academyId || dbUser?.academy?.id) {
        academyId = Number(dbUser.academyId || dbUser.academy.id);
      }
    }

    if (!academyId) {
      console.warn(`[joinAcademyRoom] Academy not found for client: ${client.id}`);
      return { success: false, message: '유효한 유치원 정보가 없습니다.' };
    }

    const room = `academy_${academyId}`;
    client.join(room);
    console.log(`Client ${client.id} joined academy room: ${room}`);
    return { success: true, room, academyId };
  }

  @SubscribeMessage('leaveAcademyRoom')
  handleLeaveAcademyRoom(
    @MessageBody() data: { academyId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.academyId) client.leave(`academy_${data.academyId}`);
  }

  @SubscribeMessage('driverOperationStatus')
  handleDriverOperationStatus(
    @MessageBody() data: { vehicleId: number; isOperating: boolean },
  ) {
    const vehicleId = Number(data?.vehicleId);
    if (!vehicleId) return;
    this.broadcastOperationStatus(vehicleId, !!data.isOperating);
  }

  // 기사 앱이 위치를 보내면 같은 차량 방 및 해당 유치원 방에만 전송 (전체 브로드캐스트 금지)
  @SubscribeMessage('driverLocationUpdate')
  async handleDriverLocationUpdate(
    @MessageBody() data: { vehicleId: number; lat: number; lng: number },
    @ConnectedSocket() client: Socket,
  ) {
    const vehicleId = Number(data?.vehicleId);
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (!vehicleId || isNaN(lat) || isNaN(lng)) return;

    // Mark vehicle as operating
    this.operatingVehicles.set(vehicleId, true);

    const vehicle = await this.vehicleRepository.findOne({
      where: { id: vehicleId },
      relations: { academy: true }
    });
    const academyId = vehicle?.academy?.id;

    const room = `vehicle_${vehicleId}`;
    const payload = {
      vehicleId,
      lat,
      lng,
      timestamp: new Date().toISOString(),
    };

    // Emit ONLY to vehicle room and academy room
    this.server.to(room).emit('locationUpdated', payload);
    if (academyId) {
      this.server.to(`academy_${academyId}`).emit('locationUpdated', payload);
      this.server.to(`academy_${academyId}`).emit('vehicleOperatingStatus', {
        vehicleId,
        isOperating: true,
        timestamp: new Date().toISOString(),
      });
    }

    // 도착 5분 전 알림 체크 로직
    try {
      const notificationsToEmit = await this.routingService.checkArrivalAndNotify(vehicleId, lat, lng);
      for (const noti of notificationsToEmit) {
        this.server.to(room).emit('busArriving', noti);
        if (academyId) {
          this.server.to(`academy_${academyId}`).emit('busArriving', noti);
        }
      }
    } catch (e) {
      console.error('Error during checkArrivalAndNotify:', e);
    }
  }
}
