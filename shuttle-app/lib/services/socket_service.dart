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
    // 서버(location.gateway.ts)가 받는 이벤트 이름은 'driverLocationUpdate'
    // (예전 'updateLocation'은 서버에 없는 이름이라 위치가 전달되지 않았음)
    _socket?.emit('driverLocationUpdate', {
      'vehicleId': vehicleId,
      'lat': lat,
      'lng': lng,
    });
  }

  /// 운행 시작·종료를 서버에 알림 → 관리자 웹·학부모 앱에 '운행 중' 표시
  void sendOperationStatus({required int vehicleId, required bool isOperating}) {
    _socket?.emit('driverOperationStatus', {
      'vehicleId': vehicleId,
      'isOperating': isOperating,
    });
  }

  void onLocationUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.off('locationUpdated');
    _socket?.on('locationUpdated', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  /// 원장 웹에서 탑승지 추가/삭제 시 지도교사 앱으로 푸시 알림 수신
  void onTeacherPush(Function(Map<String, dynamic> data) callback) {
    _socket?.off('teacherPush');
    _socket?.on('teacherPush', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      } else {
        callback(<String, dynamic>{});
      }
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
