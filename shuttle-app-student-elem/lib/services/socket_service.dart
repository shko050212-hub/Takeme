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

  void onChildBoardStatusChanged(Function(Map<String, dynamic> data) callback) {
    _socket?.off('childBoardStatusChanged');
    _socket?.off('globalChildBoardStatusChanged');
    _socket?.on('childBoardStatusChanged', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
    _socket?.on('globalChildBoardStatusChanged', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void onChangeRequestDecided(Function(Map<String, dynamic> data) callback) {
    _socket?.off('changeRequestDecided');
    _socket?.on('changeRequestDecided', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void onNotificationReceived(Function(Map<String, dynamic> data) callback) {
    _socket?.off('notificationReceived');
    _socket?.on('notificationReceived', (data) {
      if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      } else {
        callback({});
      }
    });
  }

  void onRoutePathUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.off('routePathUpdated');
    _socket?.on('routePathUpdated', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void joinChatRoom(int roomId) {
    _socket?.emit('joinChatRoom', {'roomId': roomId});
  }

  void leaveChatRoom(int roomId) {
    _socket?.emit('leaveChatRoom', {'roomId': roomId});
  }

  void onReceiveMessage(Function(Map<String, dynamic> data) callback) {
    _socket?.off('receiveMessage');
    _socket?.on('receiveMessage', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void onMessagesRead(Function(Map<String, dynamic> data) callback) {
    _socket?.off('messagesRead');
    _socket?.on('messagesRead', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void onRoomUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.off('roomUpdated');
    _socket?.on('roomUpdated', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      }
    });
  }

  void offChatEvents() {
    _socket?.off('receiveMessage');
    _socket?.off('messagesRead');
    _socket?.off('roomUpdated');
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
