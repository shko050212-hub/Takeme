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
    _socket?.emit('updateLocation', {
      'vehicleId': vehicleId,
      'lat': lat,
      'lng': lng,
      'timestamp': DateTime.now().toIso8601String(),
    });
  }

  void onLocationUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.on('locationUpdated', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
