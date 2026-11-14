import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../chat/chat_conversation_screen.dart';

/// 기사 알림 화면:
/// 기존 개별 알림 목록 대신 메신저 "TakeMe 알림" 전용 대화방으로 연결
class DriverNotificationScreen extends StatefulWidget {
  const DriverNotificationScreen({super.key});

  @override
  State<DriverNotificationScreen> createState() => _DriverNotificationScreenState();
}

class _DriverNotificationScreenState extends State<DriverNotificationScreen> {
  int? _systemRoomId;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadSystemRoom();
  }

  Future<void> _loadSystemRoom() async {
    try {
      final rooms = await ApiService().getChatRooms();
      final sysRoom = rooms.firstWhere(
        (r) => r['type'] == 'SYSTEM' || r['name'] == 'TakeMe 알림' || r['isSystem'] == true,
        orElse: () => rooms.isNotEmpty ? rooms.first : <String, dynamic>{},
      );

      if (sysRoom.isNotEmpty && sysRoom['id'] != null) {
        if (mounted) {
          setState(() {
            _systemRoomId = sysRoom['id'] as int;
            _isLoading = false;
          });
        }
      } else {
        if (mounted) {
          setState(() {
            _isLoading = false;
            _errorMessage = '알림 대화방을 찾을 수 없습니다.';
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = '알림을 불러오는 중 오류가 발생했습니다.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('TakeMe 알림', style: TextStyle(color: Color(0xFF0F172A), fontWeight: FontWeight.bold)),
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new, color: Color(0xFF0F172A), size: 20),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_errorMessage != null || _systemRoomId == null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('TakeMe 알림', style: TextStyle(color: Color(0xFF0F172A), fontWeight: FontWeight.bold)),
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new, color: Color(0xFF0F172A), size: 20),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.notifications_off_outlined, size: 48, color: Color(0xFF94A3B8)),
              const SizedBox(height: 12),
              Text(_errorMessage ?? '알림 대화방을 찾을 수 없습니다.', style: const TextStyle(color: Color(0xFF64748B), fontSize: 14)),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  setState(() => _isLoading = true);
                  _loadSystemRoom();
                },
                child: const Text('다시 시도'),
              ),
            ],
          ),
        ),
      );
    }

    return ChatConversationScreen(
      roomId: _systemRoomId!,
      title: 'TakeMe 알림',
    );
  }
}
