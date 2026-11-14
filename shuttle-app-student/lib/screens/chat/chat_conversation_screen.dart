import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../parent/class_board_screen.dart';
import '../parent/my_requests_screen.dart';

class ChatConversationScreen extends StatefulWidget {
  final int roomId;
  final String title;
  final Map<String, dynamic>? targetUser;
  final bool isSystem;
  final Map<String, dynamic>? room;

  const ChatConversationScreen({
    super.key,
    required this.roomId,
    required this.title,
    this.targetUser,
    this.isSystem = false,
    this.room,
  });

  @override
  State<ChatConversationScreen> createState() => _ChatConversationScreenState();
}

class _ChatConversationScreenState extends State<ChatConversationScreen> {
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  bool _isLoading = true;
  bool _isSending = false;
  int? _currentUserId;

  @override
  void initState() {
    super.initState();
    _currentUserId = ApiService().currentUser?.id;
    _initChat();
  }

  @override
  void dispose() {
    SocketService().leaveChatRoom(widget.roomId);
    SocketService().offChatEvents();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initChat() async {
    // 1. Join Socket Room
    SocketService().joinChatRoom(widget.roomId);

    // 2. Load Messages & Mark Read
    await _loadMessages();

    // 3. Listen to real-time socket events
    SocketService().onReceiveMessage((data) {
      if (!mounted) return;
      final msgRoomId = data['room']?['id'] ?? data['roomId'];
      if (msgRoomId != null && _toNumber(msgRoomId) == widget.roomId) {
        setState(() {
          final exists = _messages.any((m) => m['id'] == data['id']);
          if (!exists) {
            _messages.add(data);
          }
        });
        _scrollToBottom();
        // 화면을 보고 있는 중이므로 즉시 읽음 처리
        ApiService().markChatRoomAsRead(widget.roomId);
      }
    });

    SocketService().onMessagesRead((data) {
      if (!mounted) return;
      final msgRoomId = data['roomId'];
      if (msgRoomId != null && _toNumber(msgRoomId) == widget.roomId) {
        // 상대방이 읽었으므로 내 메시지의 unreadCount 를 0으로 업데이트
        setState(() {
          for (final m in _messages) {
            m['unreadCount'] = 0;
          }
        });
      }
    });
  }

  int _toNumber(dynamic v) {
    if (v is int) return v;
    return int.tryParse(v.toString()) ?? 0;
  }

  Future<void> _loadMessages() async {
    final list = await ApiService().getChatMessages(widget.roomId);
    if (mounted) {
      setState(() {
        _messages = list;
        _isLoading = false;
      });
      _scrollToBottom();
      ApiService().markChatRoomAsRead(widget.roomId);
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _handleSendMessage() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _isSending) return;

    setState(() => _isSending = true);
    _textController.clear();

    final result = await ApiService().sendChatMessage(widget.roomId, text);
    if (!mounted) return;

    setState(() => _isSending = false);

    if (result != null) {
      setState(() {
        final exists = _messages.any((m) => m['id'] == result['id']);
        if (!exists) {
          _messages.add(result);
        }
      });
      _scrollToBottom();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('메시지 전송에 실패했습니다. 다시 시도해주세요.'),
          action: SnackBarAction(
            label: '재시도',
            textColor: Colors.amber,
            onPressed: () {
              _textController.text = text;
              _handleSendMessage();
            },
          ),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  String _formatMessageTime(dynamic createdAt) {
    if (createdAt == null) return '';
    try {
      final dt = DateTime.parse(createdAt.toString()).toLocal();
      return DateFormat('a h:mm', 'ko_KR').format(dt);
    } catch (_) {
      return '';
    }
  }

  String _formatDateHeader(dynamic createdAt) {
    if (createdAt == null) return '';
    try {
      final dt = DateTime.parse(createdAt.toString()).toLocal();
      return DateFormat('yyyy년 M월 d일 EEEE', 'ko_KR').format(dt);
    } catch (_) {
      return '';
    }
  }

  bool _isSameDay(dynamic dateA, dynamic dateB) {
    if (dateA == null || dateB == null) return false;
    try {
      final dtA = DateTime.parse(dateA.toString()).toLocal();
      final dtB = DateTime.parse(dateB.toString()).toLocal();
      return dtA.year == dtB.year && dtA.month == dtB.month && dtA.day == dtB.day;
    } catch (_) {
      return false;
    }
  }

  Widget _buildDateSeparator(String text) {
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 14),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFFE2E8F0),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 11,
            color: Color(0xFF475569),
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  Widget _buildMessageItem(Map<String, dynamic> msg, bool showDate, String dateText) {
    final senderId = msg['sender']?['id'];
    final isMe = (_currentUserId != null && senderId == _currentUserId);
    final text = msg['text']?.toString() ?? '';
    final timeStr = _formatMessageTime(msg['createdAt']);
    final unreadCount = _toNumber(msg['unreadCount']);
    final senderName = msg['sender']?['name'] ?? '상대방';
    final isSystemMessage = msg['sender'] == null ||
        msg['messageType'] == 'SYSTEM' ||
        widget.isSystem ||
        widget.title == 'TakeMe 알림' ||
        widget.room?['type'] == 'SYSTEM' ||
        widget.room?['name'] == 'TakeMe 알림';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showDate) _buildDateSeparator(dateText),
        if (isSystemMessage && !isMe)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.notifications_active, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: InkWell(
                    onTap: () {
                      if (text.contains('알림장')) {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ClassBoardScreen(initialCategory: 'NOTICE'),
                          ),
                        );
                      } else if (text.contains('게시물') || text.contains('게시글') || text.contains('활동 사진')) {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ClassBoardScreen(initialCategory: 'POST'),
                          ),
                        );
                      } else if (text.contains('통학') || text.contains('변동') || text.contains('결석') || text.contains('신청')) {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const MyRequestsScreen(),
                          ),
                        );
                      }
                    },
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.04),
                            blurRadius: 6,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                text.contains('알림장')
                                    ? 'TakeMe 알림장 알림'
                                    : text.contains('게시물') || text.contains('게시글')
                                        ? 'TakeMe 게시물 알림'
                                        : text.contains('통학') || text.contains('변동') || text.contains('신청')
                                            ? 'TakeMe 통학 변동 알림'
                                            : 'TakeMe 시스템 알림',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: text.contains('알림장')
                                      ? const Color(0xFFEA580C)
                                      : text.contains('통학') || text.contains('변동')
                                          ? const Color(0xFF0D9488)
                                          : const Color(0xFF2563EB),
                                ),
                              ),
                              Text(
                                timeStr,
                                style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            text,
                            style: const TextStyle(
                              fontSize: 13.5,
                              color: Color(0xFF1E293B),
                              height: 1.45,
                            ),
                          ),
                          if (text.contains('알림장')) ...[
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFFF7ED),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: const Color(0xFFFDBA74)),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.campaign, size: 14, color: Color(0xFFEA580C)),
                                  SizedBox(width: 4),
                                  Text(
                                    '알림장 보기 >',
                                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFEA580C)),
                                  ),
                                ],
                              ),
                            ),
                          ] else if (text.contains('게시물') || text.contains('게시글') || text.contains('활동 사진')) ...[
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEFF6FF),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: const Color(0xFFBFDBFE)),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.article, size: 14, color: Color(0xFF2563EB)),
                                  SizedBox(width: 4),
                                  Text(
                                    '게시물 보기 >',
                                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                                  ),
                                ],
                              ),
                            ),
                          ] else if (text.contains('통학') || text.contains('변동') || text.contains('결석') || text.contains('신청')) ...[
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF0FDFA),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: const Color(0xFF99F6E4)),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.edit_calendar, size: 14, color: Color(0xFF0D9488)),
                                  SizedBox(width: 4),
                                  Text(
                                    '통학 변동 내역 보기 >',
                                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF0D9488)),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: isMe
                ? Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    // Time and Unread count (Kakao-style left of my bubble)
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (unreadCount > 0)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Text(
                              '$unreadCount',
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFFF59E0B),
                              ),
                            ),
                          ),
                        Text(
                          timeStr,
                          style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8)),
                        ),
                      ],
                    ),
                    const SizedBox(width: 6),
                    // My Bubble
                    Flexible(
                      child: Container(
                        constraints: BoxConstraints(
                          maxWidth: MediaQuery.of(context).size.width * 0.68,
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: const BoxDecoration(
                          color: Color(0xFF2563EB),
                          borderRadius: BorderRadius.only(
                            topLeft: Radius.circular(16),
                            topRight: Radius.circular(4),
                            bottomLeft: Radius.circular(16),
                            bottomRight: Radius.circular(16),
                          ),
                        ),
                        child: Text(
                          text,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ),
                  ],
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.start,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Profile Avatar
                    CircleAvatar(
                      radius: 18,
                      backgroundColor: const Color(0xFFDBEAFE),
                      child: Text(
                        senderName.isNotEmpty ? senderName.substring(0, 1) : '?',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF1D4ED8),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Counterpart Bubble with Name
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            senderName,
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF64748B),
                            ),
                          ),
                          const SizedBox(height: 3),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Flexible(
                                child: Container(
                                  constraints: BoxConstraints(
                                    maxWidth: MediaQuery.of(context).size.width * 0.68,
                                  ),
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                  decoration: const BoxDecoration(
                                    color: Color(0xFFF1F5F9),
                                    borderRadius: BorderRadius.only(
                                      topLeft: Radius.circular(4),
                                      topRight: Radius.circular(16),
                                      bottomLeft: Radius.circular(16),
                                      bottomRight: Radius.circular(16),
                                    ),
                                  ),
                                  child: Text(
                                    text,
                                    style: const TextStyle(
                                      color: Color(0xFF1E293B),
                                      fontSize: 14,
                                      height: 1.4,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (unreadCount > 0)
                                    Padding(
                                      padding: const EdgeInsets.only(bottom: 2),
                                      child: Text(
                                        '$unreadCount',
                                        style: const TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFFF59E0B),
                                        ),
                                      ),
                                    ),
                                  Text(
                                    timeStr,
                                    style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8)),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final subText = widget.targetUser?['subText'] ?? '';

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Color(0xFF1E293B), size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: Color(0xFF0F172A),
              ),
            ),
            if (subText.isNotEmpty)
              Text(
                subText,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFF64748B),
                ),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF64748B)),
            onPressed: _loadMessages,
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: SafeArea(
        maintainBottomViewPadding: true,
        child: Column(
          children: [
            // Message List
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
                  : _messages.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 56,
                                height: 56,
                                decoration: const BoxDecoration(
                                  color: Color(0xFFF1F5F9),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.chat_bubble_outline, color: Color(0xFF94A3B8), size: 28),
                              ),
                              const SizedBox(height: 12),
                              const Text(
                                '대화 내용이 없습니다.\n첫 메시지를 보내보세요!',
                                style: TextStyle(color: Color(0xFF64748B), fontSize: 13, height: 1.5),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        )
                      : ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          itemCount: _messages.length,
                          itemBuilder: (ctx, idx) {
                            final msg = _messages[idx];
                            final prevMsg = idx > 0 ? _messages[idx - 1] : null;
                            final showDate = (idx == 0) || !_isSameDay(prevMsg?['createdAt'], msg['createdAt']);
                            final dateText = _formatDateHeader(msg['createdAt']);
                            return _buildMessageItem(msg, showDate, dateText);
                          },
                        ),
            ),
            // Bottom Input Bar or System Room Notice
            if (widget.isSystem || widget.title == 'TakeMe 알림' || widget.room?['type'] == 'SYSTEM' || widget.room?['name'] == 'TakeMe 알림' || widget.room?['isSystem'] == true)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: const BoxDecoration(
                  color: Color(0xFFF8FAFC),
                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.lock_outline, size: 16, color: Color(0xFF64748B)),
                    SizedBox(width: 8),
                    Text(
                      '시스템 알림 전용 대화방입니다. 답장을 보낼 수 없습니다.',
                      style: TextStyle(fontSize: 12.5, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              )
            else
              Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                ),
                padding: EdgeInsets.fromLTRB(
                  12,
                  8,
                  12,
                  8 + MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: TextField(
                          controller: _textController,
                          maxLines: 4,
                          minLines: 1,
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _handleSendMessage(),
                          decoration: const InputDecoration(
                            hintText: '메시지를 입력하세요...',
                            hintStyle: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                            border: InputBorder.none,
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(vertical: 10),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: _isSending ? const Color(0xFF94A3B8) : const Color(0xFF2563EB),
                        shape: BoxShape.circle,
                      ),
                      child: IconButton(
                        icon: _isSending
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                        onPressed: _isSending ? null : _handleSendMessage,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
