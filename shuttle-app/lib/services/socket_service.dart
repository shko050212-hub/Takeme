import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io_client;
import '../config.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  io_client.Socket? _socket;
  int? _joinedVehicleId;

  /// 통신 끊김 시 위치를 모아두었다가 재연결 시 일괄 전송하는 오프라인 큐
  final List<Map<String, dynamic>> _offlineLocationQueue = [];

  bool get isConnected => _socket?.connected ?? false;
  int get queuedLocationCount => _offlineLocationQueue.length;

  void connect(String? token) {
    if (_socket != null && _socket!.connected) return;

    final options = io_client.OptionBuilder()
        .setTransports(['websocket'])
        .enableReconnection()
        .setReconnectionDelay(2000)
        .disableAutoConnect();

    if (token != null && token.isNotEmpty) {
      options.setAuth({'token': token});
    }

    _socket ??= io_client.io(AppConfig.apiHost, options.build());

    _socket!.off('connect');
    _socket!.onConnect((_) {
      debugPrint('Socket connected: ${_socket!.id}');
      if (_joinedVehicleId != null) {
        _socket?.emit('joinVehicleRoom', {'vehicleId': _joinedVehicleId});
      }
      _flushOfflineLocations();
    });

    _socket!.off('disconnect');
    _socket!.onDisconnect((_) {
      debugPrint('Socket disconnected');
    });

    if (!_socket!.connected) {
      _socket!.connect();
    }
  }

  void _flushOfflineLocations() {
    if (!isConnected || _offlineLocationQueue.isEmpty) return;
    final batch = List<Map<String, dynamic>>.from(_offlineLocationQueue);
    _offlineLocationQueue.clear();
    for (final payload in batch) {
      _socket?.emit('driverLocationUpdate', payload);
    }
    debugPrint('[socket] flushed ${batch.length} queued offline locations');
  }

  void joinVehicleRoom(int vehicleId) {
    _joinedVehicleId = vehicleId;
    _socket?.emit('joinVehicleRoom', {'vehicleId': vehicleId});
  }

  void leaveVehicleRoom(int vehicleId) {
    if (_joinedVehicleId == vehicleId) _joinedVehicleId = null;
    _socket?.emit('leaveVehicleRoom', {'vehicleId': vehicleId});
  }

  /// 위치 + 실제 도로 기준 남은 시간(ETA)·속도를 서버로 전송 (연결 끊김 시 큐에 저장 후 재연결 시 전송)
  void sendLocationUpdate({
    required int vehicleId,
    required double lat,
    required double lng,
    int? remainingSeconds,
    int? remainingMeters,
    String? nextStopName,
    int? nextStopEtaSeconds,
    int? speedKmh,
  }) {
    final payload = <String, dynamic>{
      'vehicleId': vehicleId,
      'lat': lat,
      'lng': lng,
      if (remainingSeconds != null) 'remainingSeconds': remainingSeconds,
      if (remainingMeters != null) 'remainingMeters': remainingMeters,
      if (nextStopName != null) 'nextStopName': nextStopName,
      if (nextStopEtaSeconds != null) 'nextStopEtaSeconds': nextStopEtaSeconds,
      if (speedKmh != null) 'speedKmh': speedKmh,
      'clientTimestamp': DateTime.now().toIso8601String(),
    };

    if (isConnected) {
      _flushOfflineLocations();
      _socket?.emit('driverLocationUpdate', payload);
    } else {
      if (_offlineLocationQueue.length >= 200) {
        _offlineLocationQueue.removeAt(0);
      }
      _offlineLocationQueue.add(payload);
    }
  }

  /// 운행 시작·종료를 서버에 알림 → 관리자 웹·학부모 앱에 '운행 중' 표시
  void sendOperationStatus({required int vehicleId, required bool isOperating}) {
    _socket?.emit('driverOperationStatus', {
      'vehicleId': vehicleId,
      'isOperating': isOperating,
    });
  }

  /// 지도교사가 정류장에서 원아 탑승 완료 후 기사에게 "출발하셔도 됩니다" 신호 발송
  void sendReadyToDepart({required int vehicleId, String? stopName}) {
    _socket?.emit('teacherReadyToDepart', {
      'vehicleId': vehicleId,
      if (stopName != null) 'stopName': stopName,
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

  /// 학부모 결석 신청 / 원장 탑승지 변경 / 지도교사 탑승·결석 처리 시 경로 자동 갱신 신호 수신
  void onRouteUpdated(Function(Map<String, dynamic> data) callback) {
    _socket?.off('routeUpdated');
    _socket?.on('routeUpdated', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      } else {
        callback(<String, dynamic>{});
      }
    });
  }

  /// 지도교사의 "출발하셔도 됩니다" 신호 수신 (기사 앱)
  void onDriverDepartSignal(Function(Map<String, dynamic> data) callback) {
    _socket?.off('driverDepartSignal');
    _socket?.on('driverDepartSignal', (data) {
      if (data is Map<String, dynamic>) {
        callback(data);
      } else if (data is Map) {
        callback(Map<String, dynamic>.from(data));
      } else {
        callback(<String, dynamic>{});
      }
    });
  }

  /// 지도교사 학부모 메시지 응답 등에 따른 기사 음성 안내 수신
  void onDriverTts(Function(Map<String, dynamic> data) callback) {
    _socket?.off('driverTTS');
    _socket?.on('driverTTS', (data) {
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
