import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io_client;
import '../config.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  io_client.Socket? _socket;
  bool get isConnected => _socket?.connected ?? false;

  void connect(String? token) {
    if (_socket != null && _socket!.connected) return;

    final options = io_client.OptionBuilder()
        .setTransports(['websocket'])
        .disableAutoConnect();

    if (token != null && token.isNotEmpty) {
      options.setAuth({'token': token});
    }

    _socket = io_client.io(AppConfig.apiHost, options.build());

    _socket!.onConnect((_) {
      debugPrint('Socket connected: ${_socket!.id}');
    });

    _socket!.onDisconnect((_) {
      debugPrint('Socket disconnected');
    });

    _socket!.connect();
  }

  void joinVehicleRoom(int vehicleId) {
    _socket?.emit('joinVehicleRoom', {'vehicleId': vehicleId});
  }

  void leaveVehicleRoom(int vehicleId) {
    _socket?.emit('leaveVehicleRoom', {'vehicleId': vehicleId});
  }

  void sendLocationUpdate({
    required int vehicleId,
    required double lat,
    required double lng,
  }) {
    _socket?.emit('driverLocationUpdate', {
      'vehicleId': vehicleId,
      'lat': lat,
      'lng': lng,
    });
  }

  /// 지도교사가 정류장 탑승 완료 후 기사 앱에 출발 신호 전송
  void sendReadyToDepart({required int vehicleId, String? stopName}) {
    final payload = <String, dynamic>{'vehicleId': vehicleId};
    if (stopName != null && stopName.isNotEmpty) {
      payload['stopName'] = stopName;
    }
    _socket?.emit('teacherReadyToDepart', payload);
  }

  /// 운행 시작·종료를 서버에 알림 → 관리자 웹·학부모 앱에 '운행 중' 표시
  void sendOperationStatus({required int vehicleId, required bool isOperating}) {
    _socket?.emit('driverOperationStatus', {
      'vehicleId': vehicleId,
      'isOperating': isOperating,
    });
  }

  void onLocationUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.on('locationUpdated', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  /// 지도교사 원아 상태(탑승/하차/인계/인계실패) 변경 이벤트 수신
  void onStudentStatusUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.on('studentStatusUpdated', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  /// 원장 웹/학부모 결석·변경 시 푸시 알림 수신
  void onTeacherPush(Function(Map<String, dynamic> data) callback) {
    _socket?.on('teacherPush', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  /// 노선 또는 결석 일정 변경 알림 수신
  void onRouteUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.on('routeUpdated', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  /// 기사 앱에 전달되는 출발 신호 수신
  void onDriverDepartSignal(Function(Map<String, dynamic> data) callback) {
    _socket?.on('driverDepartSignal', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
