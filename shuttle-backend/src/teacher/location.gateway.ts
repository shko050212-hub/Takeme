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
  ) {
    this.routingService.registerRouteUpdateNotifier((academyId, message) => {
      if (message) {
        this.broadcastTeacherPushByAcademy(message, academyId);
      }
      this.broadcastRouteUpdatedByAcademy(academyId);
    });
  }

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

  /** Broadcast operation status to vehicle room */
  broadcastOperationStatus(vehicleId: number, isOperating: boolean, busNumber?: string) {
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
    }
  }

  /** 지도교사가 탑승 완료 후 기사 앱에 "출발하셔도 됩니다" 신호 전송 (해당 차량 방에만 발송) */
  broadcastDepartSignal(vehicleId: number, stopName?: string) {
    const room = `vehicle_${vehicleId}`;
    const payload = {
      vehicleId,
      stopName: stopName ?? null,
      message: '출발하셔도 됩니다',
      timestamp: new Date().toISOString(),
    };
    if (this.server) {
      this.server.to(room).emit('driverDepartSignal', payload);
    }
  }

  /** 원아 탑승/하차/인계 상태 변경 시 해당 차량 방에 실시간 전송 */
  broadcastStudentStatusUpdated(vehicleId: number, payload: { studentId: number; boardStatus: string; studentName?: string; time?: string }) {
    const room = `vehicle_${vehicleId}`;
    if (this.server) {
      this.server.to(room).emit('studentStatusUpdated', {
        ...payload,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** 노선 또는 일정 변경 시 해당 차량 방 또는 유치원 방에 알림 */
  broadcastRouteUpdated(vehicleId?: number) {
    if (!this.server) return;
    if (vehicleId) {
      this.server.to(`vehicle_${vehicleId}`).emit('routeUpdated', {
        vehicleId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.server.emit('routeUpdated', { timestamp: new Date().toISOString() });
    }
  }

  /** 유치원 단위 노선 변경 알림 */
  broadcastRouteUpdatedByAcademy(academyId?: number) {
    if (!this.server) return;
    if (academyId) {
      this.server.to(`academy_${academyId}`).emit('routeUpdated', {
        academyId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.server.emit('routeUpdated', { timestamp: new Date().toISOString() });
    }
  }

  /** 학부모 결석/변경 등으로 교사에게 푸시 전송 (차량 방에만 전송) */
  broadcastTeacherPush(vehicleId: number, message: string) {
    if (this.server) {
      this.server.to(`vehicle_${vehicleId}`).emit('teacherPush', {
        message,
        vehicleId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** 유치원 단위 교사 푸시 전송 */
  broadcastTeacherPushByAcademy(message: string, academyId?: number) {
    if (!this.server) return;
    if (academyId) {
      this.server.to(`academy_${academyId}`).emit('teacherPush', {
        message,
        academyId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.server.emit('teacherPush', {
        message,
        timestamp: new Date().toISOString(),
      });
    }
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
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('leaveVehicleRoom')
  handleLeaveVehicleRoom(
    @MessageBody() data: { vehicleId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.vehicleId) client.leave(`vehicle_${data.vehicleId}`);
  }

  @SubscribeMessage('driverOperationStatus')
  handleDriverOperationStatus(
    @MessageBody() data: { vehicleId: number; isOperating: boolean },
  ) {
    const vehicleId = Number(data?.vehicleId);
    if (!vehicleId) return;
    this.broadcastOperationStatus(vehicleId, !!data.isOperating);
  }

  @SubscribeMessage('teacherReadyToDepart')
  handleTeacherReadyToDepart(
    @MessageBody() data: { vehicleId: number; stopName?: string },
  ) {
    const vehicleId = Number(data?.vehicleId);
    if (!vehicleId) return;
    this.broadcastDepartSignal(vehicleId, data?.stopName);
  }

  // 기사 앱이 위치 + 실제 도로 기준 남은 시간(ETA)을 보내면 차량 방에 실시간 전송
  @SubscribeMessage('driverLocationUpdate')
  async handleDriverLocationUpdate(
    @MessageBody()
    data: {
      vehicleId: number;
      lat: number;
      lng: number;
      remainingSeconds?: number;
      remainingMeters?: number;
      nextStopName?: string;
      nextStopEtaSeconds?: number;
      speedKmh?: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const vehicleId = Number(data?.vehicleId);
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (!vehicleId || isNaN(lat) || isNaN(lng)) return;

    // Mark vehicle as operating
    this.operatingVehicles.set(vehicleId, true);

    const room = `vehicle_${vehicleId}`;
    const payload = {
      vehicleId,
      lat,
      lng,
      remainingSeconds: data?.remainingSeconds ?? null,
      remainingMeters: data?.remainingMeters ?? null,
      nextStopName: data?.nextStopName ?? null,
      nextStopEtaSeconds: data?.nextStopEtaSeconds ?? null,
      speedKmh: data?.speedKmh ?? null,
      timestamp: new Date().toISOString(),
    };

    // Emit to vehicle room only
    this.server.to(room).emit('locationUpdated', payload);

    // Also emit operation status to vehicle room
    this.server.to(room).emit('vehicleOperatingStatus', {
      vehicleId,
      isOperating: true,
      timestamp: new Date().toISOString(),
    });

    // 도착 5분 전 알림 체크 로직
    try {
      const notificationsToEmit = await this.routingService.checkArrivalAndNotify(vehicleId, lat, lng);
      for (const noti of notificationsToEmit) {
        this.server.to(room).emit('busArriving', noti);
      }
    } catch (e) {
      console.error('Error during checkArrivalAndNotify:', e);
    }
  }
}
