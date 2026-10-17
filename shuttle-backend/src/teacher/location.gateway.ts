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

/**
 * 소켓 인증 규칙
 * - 연결할 때 io(URL, { auth: { token } }) 로 토큰을 보낸다.
 * - 토큰이 없어도 연결은 유지한다 (같은 소켓을 쓰는 채팅 등 다른 기능을 끊지 않기 위해).
 *   대신 위치 관련 이벤트는 토큰과 권한이 있어야만 처리한다.
 * - 위치 전송(driverLocationUpdate): 그 차량에 배정된 기사·지도교사만
 * - 위치 수신(joinVehicleRoom): 그 차량에 배정된 원생의 학부모·학생, 그 차량 기사·지도교사, 그 학원 원장
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class LocationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly routingService: RoutingService,
    private readonly jwtService: JwtService,
    @InjectRepository(Vehicle) private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Student) private readonly studentRepository: Repository<Student>,
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
        client.emit('authError', { message: '토큰이 올바르지 않거나 만료되었습니다.' });
      }
    }
    console.log(`Client connected: ${client.id} (${client.data.user?.email ?? 'no token'})`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  /** 이 사용자가 해당 차량 위치를 보낼 수 있는지 (기사·지도교사 본인 차량) */
  private async canSend(user: JwtPayload, vehicleId: number): Promise<boolean> {
    if (user.role !== 'DRIVER' && user.role !== 'TEACHER') return false;
    const vehicle = await this.vehicleRepository.findOne({
      where: { id: vehicleId },
      relations: { driverUser: true, teacherUser: true },
    });
    return !!vehicle && (vehicle.driverUser?.id === user.sub || vehicle.teacherUser?.id === user.sub);
  }

  /** 이 사용자가 해당 차량 위치를 받아볼 수 있는지 */
  private async canJoin(user: JwtPayload, vehicleId: number): Promise<boolean> {
    if (user.role === 'SUPER_ADMIN') return true;
    if (user.role === 'DRIVER' || user.role === 'TEACHER') return this.canSend(user, vehicleId);

    if (user.role === 'ACADEMY_ADMIN') {
      const vehicle = await this.vehicleRepository.findOne({
        where: { id: vehicleId },
        relations: { academy: true },
      });
      return !!vehicle && vehicle.academy?.id === user.academyId;
    }

    if (user.role === 'PARENT' || user.role === 'STUDENT') {
      const where =
        user.role === 'PARENT'
          ? { parentUser: { id: user.sub }, assignedVehicle: { id: vehicleId } }
          : { studentUser: { id: user.sub }, assignedVehicle: { id: vehicleId } };
      return (await this.studentRepository.count({ where })) > 0;
    }
    return false;
  }

  @SubscribeMessage('joinVehicleRoom')
  async handleJoinVehicleRoom(
    @MessageBody() data: { vehicleId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const vehicleId = Number(data?.vehicleId);
    const user: JwtPayload | undefined = client.data.user;
    if (!vehicleId) return;
    if (!user) {
      client.emit('authError', { message: '로그인 토큰이 필요합니다.' });
      return;
    }
    if (!client.data.allowedJoin.has(vehicleId)) {
      if (!(await this.canJoin(user, vehicleId))) {
        client.emit('authError', { message: `차량 ${vehicleId}의 위치를 볼 권한이 없습니다.` });
        return;
      }
      client.data.allowedJoin.add(vehicleId);
    }
    const room = `vehicle_${vehicleId}`;
    client.join(room);
    console.log(`Client ${client.id} joined room ${room}`);
  }

  @SubscribeMessage('leaveVehicleRoom')
  handleLeaveVehicleRoom(
    @MessageBody() data: { vehicleId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.vehicleId) client.leave(`vehicle_${data.vehicleId}`);
  }

  // 기사 앱이 위치를 보내면 같은 차량 방에 있는 사람들에게만 전달
  @SubscribeMessage('driverLocationUpdate')
  async handleDriverLocationUpdate(
    @MessageBody() data: { vehicleId: number; lat: number; lng: number },
    @ConnectedSocket() client: Socket,
  ) {
    const vehicleId = Number(data?.vehicleId);
    const user: JwtPayload | undefined = client.data.user;
    if (!vehicleId) return;
    if (!user) {
      client.emit('authError', { message: '로그인 토큰이 필요합니다.' });
      return;
    }
    // 위치는 몇 초마다 오므로, 권한 확인은 차량별로 처음 한 번만 DB 조회
    if (!client.data.allowedSend.has(vehicleId)) {
      if (!(await this.canSend(user, vehicleId))) {
        client.emit('authError', { message: `차량 ${vehicleId}의 위치를 보낼 권한이 없습니다.` });
        return;
      }
      client.data.allowedSend.add(vehicleId);
    }

    const room = `vehicle_${vehicleId}`;
    this.server.to(room).emit('locationUpdated', {
      vehicleId,
      lat: data.lat,
      lng: data.lng,
      timestamp: new Date().toISOString(),
    });

    // 도착 5분 전 알림 체크 로직 (기존 그대로)
    try {
      const notificationsToEmit = await this.routingService.checkArrivalAndNotify(vehicleId, data.lat, data.lng);
      for (const noti of notificationsToEmit) {
        this.server.to(room).emit('busArriving', noti);
      }
    } catch (e) {
      console.error('Error during checkArrivalAndNotify:', e);
    }
  }
}
