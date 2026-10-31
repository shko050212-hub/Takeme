import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io_client;
import 'api_service.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  io_client.Socket? _socket;
  bool get isConnected => _socket?.connected ?? false;

  void connect(String? token) {
    if (_socket != null && _socket!.connected) return;
    if (token == null || token.isEmpty || token == 'demo_token') return;

    try {
      final baseUrl = ApiService().baseUrl;
      final options = io_client.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .enableReconnection()
          .disableAutoConnect();

      if (token != null && token.isNotEmpty) {
        options.setAuth({'token': token});
      }

      _socket = io_client.io(baseUrl, options.build());

      _socket!.onConnect((_) {
        debugPrint('[Socket] Connected to server: ${_socket!.id}');
      });

      _socket!.onDisconnect((_) {
        debugPrint('[Socket] Disconnected from server');
      });

      _socket!.onError((err) {
        debugPrint('[Socket] Error: $err');
      });

      _socket!.onConnectError((err) {
        debugPrint('[Socket] Connect Error: $err');
      });

      _socket!.connect();
    } catch (e) {
      debugPrint('[Socket] Exception during connect: $e');
    }
  }

  void joinVehicleRoom(int vehicleId) {
    try {
      _socket?.emit('joinVehicleRoom', {'vehicleId': vehicleId});
    } catch (_) {}
  }

  void leaveVehicleRoom(int vehicleId) {
    try {
      _socket?.emit('leaveVehicleRoom', {'vehicleId': vehicleId});
    } catch (_) {}
  }

  void sendLocationUpdate({
    required int vehicleId,
    required double lat,
    required double lng,
  }) {
    try {
      _socket?.emit('driverLocationUpdate', {
        'vehicleId': vehicleId,
        'lat': lat,
        'lng': lng,
      });
    } catch (_) {}
  }

  void sendOperationStatus({required int vehicleId, required bool isOperating}) {
    try {
      _socket?.emit('driverOperationStatus', {
        'vehicleId': vehicleId,
        'isOperating': isOperating,
      });
    } catch (_) {}
  }

  void disconnect() {
    try {
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;
  }
}
