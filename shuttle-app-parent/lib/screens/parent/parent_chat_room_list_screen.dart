import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../config.dart';
import '../../models/chat_model.dart';
import '../../services/api_service.dart';
import 'parent_chat_room_screen.dart';

/// 대화 가능한 유치원 교직원 및 통학차량 담당자 모델
class ChatContact {
  final int userId;
  final String name;
  final String roleTitle;
  final String category; // '교사', '원장/행정', '통학차량', '학부모'
  final String description;
  final IconData icon;
  final Color themeColor;
  final Color bgColor;

  const ChatContact({
    required this.userId,
    required this.name,
    required this.roleTitle,
    required this.category,
    required this.description,
    required this.icon,
    required this.themeColor,
    required this.bgColor,
  });
}

class ParentChatRoomListScreen extends StatefulWidget {
  final bool isEmbedded;

  const ParentChatRoomListScreen({super.key, this.isEmbedded = false});

  @override
  State<ParentChatRoomListScreen> createState() => _ParentChatRoomListScreenState();
}

class _ParentChatRoomListScreenState extends State<ParentChatRoomListScreen> {
  List<ChatRoomModel> _rooms = [];
  bool _isLoading = true;
  String? _loadError; // 채팅방 목록 불러오기 실패 이유 (null 이면 정상)
  String? _contactsError; // 대화 상대 목록 불러오기 실패 이유
  String? _myEmail;

  List<ChatContact> _contacts = [];
  bool _isLoadingContacts = false;
  @override
  void initState() {
    super.initState();
    _myEmail = ApiService().currentUser?.email ?? 'parent@takeme.com';
    _loadRooms();
    _loadContacts();
  }

  Future<void> _loadContacts() async {
    setState(() {
      _isLoadingContacts = true;
      _contactsError = null;
    });
    try {
      final res = await ApiService().getChatUsers(_myEmail ?? 'parent@takeme.com', throwOnError: true);
      final List<ChatContact> fetched = [];

      // 1. 원장님 및 행정실
      final admins = res['admins'] ?? [];
      for (final a in admins) {
        final aName = (a['name'] ?? '').toString();
        fetched.add(ChatContact(
          userId: a['id'] as int,
          name: aName.contains('원장') ? aName : (aName.isNotEmpty ? '$aName 원장님' : '원장님'),
          roleTitle: a['subText'] ?? '유치원 원장',
          category: '원장·행정',
          description: '유치원 전반 운영, 원비 및 학사 일정 문의',
          icon: Icons.account_balance_rounded,
          themeColor: const Color(0xFF059669),
          bgColor: const Color(0xFFECFDF5),
        ));
      }

      // 2. 담임 및 동승 교사
      final teachers = res['teachers'] ?? [];
      for (final t in teachers) {
        final isShuttle = t['role'] == 'SHUTTLE_TEACHER';
        fetched.add(ChatContact(
          userId: t['id'] as int,
          name: t['name'] ?? '선생님',
          roleTitle: t['subText'] ?? (isShuttle ? '동승 안전교사' : '담임교사'),
          category: isShuttle ? '통학차량' : '담임·교사',
          description: isShuttle ? '차량 내 원아 안전 지도 및 승하차 대기' : '원아 생활, 알림장, 출결 및 원내 지도 상담',
          icon: isShuttle ? Icons.health_and_safety_rounded : Icons.face_rounded,
          themeColor: isShuttle ? const Color(0xFF7C3AED) : const Color(0xFF2563EB),
          bgColor: isShuttle ? const Color(0xFFF5F3FF) : const Color(0xFFEFF6FF),
        ));
      }

      // 3. 통학 셔틀 기사님
      final drivers = res['drivers'] ?? [];
      for (final d in drivers) {
        final dName = (d['name'] ?? '').toString();
        fetched.add(ChatContact(
          userId: d['id'] as int,
          name: dName.contains('기사') ? dName : (dName.isNotEmpty ? '$dName 기사님' : '기사님'),
          roleTitle: d['subText'] ?? '통학버스 기사',
          category: '통학차량',
          description: '통학버스 승하차 장소 및 실시간 운행/도착 문의',
          icon: Icons.directions_bus_rounded,
          themeColor: const Color(0xFFD97706),
          bgColor: const Color(0xFFFFFBEB),
        ));
      }

      // 4. 원아 학부모님
      final parents = res['parents'] ?? [];
      for (final p in parents) {
        final pEmail = p['email'] ?? '';
        if (_myEmail != null && pEmail == _myEmail) continue;

        final pName = (p['name'] ?? '').toString();
        final childSub = p['subText'] ?? '원아 학부모';
        fetched.add(ChatContact(
          userId: p['id'] as int,
          name: pName.contains('학부모') ? pName : (pName.isNotEmpty ? '$pName 학부모님' : '학부모님'),
          roleTitle: childSub,
          category: '학부모',
          description: '원아 친구 학부모님과 소통 및 정보 공유',
          icon: Icons.family_restroom_rounded,
          themeColor: const Color(0xFF8B5CF6),
          bgColor: const Color(0xFFF5F3FF),
        ));
      }

      if (mounted) {
        setState(() {
          _contacts = fetched;
          _isLoadingContacts = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _contacts = [];
          _isLoadingContacts = false;
          _contactsError = friendlyError(e);
        });
      }
    }
  }

  Future<void> _loadRooms() async {
    setState(() => _isLoading = true);
    try {
      final rawList = await ApiService().getChatRooms(_myEmail ?? 'parent@takeme.com', throwOnError: true);
      if (!mounted) return;

      final parsed = rawList
          .map((r) => ChatRoomModel.fromJson(r))
          .where((r) => r.type != 'PAYMENT_SYSTEM')
          .toList();

      setState(() {
        _rooms = parsed;
        _isLoading = false;
        _loadError = null;
      });
    } catch (e) {
      if (!mounted) return;
      final message = friendlyError(e);
      setState(() {
        _isLoading = false;
        // 이미 보이는 목록이 없을 때만 오류 화면, 목록이 있으면 그대로 두고 안내만 한다
        if (_rooms.isEmpty) _loadError = message;
      });
      if (_rooms.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('대화 목록을 새로 불러오지 못했습니다. $message')),
        );
      }
    }
  }

  Future<void> _openDirectRoom({
    required String name,
    required int targetUserId,
    required String roleName,
  }) async {
    for (final room in _rooms) {
      if (room.type != 'GROUP' && room.type != 'NOTIFICATION_SYSTEM') {
        final other = room.getOtherMember(_myEmail);
        if (other != null && other.userId == targetUserId) {
          _enterRoom(room.id, room.getDisplayName(_myEmail), roleName, other.name, isGroup: false);
          return;
        }
      }
    }

    final res = await ApiService().createChatRoom(
      name: name,
      type: 'DIRECT',
      userIds: [targetUserId],
      creatorEmail: _myEmail ?? 'parent@takeme.com',
    );

    if (res['success'] && res['data'] != null) {
      final newRoomId = res['data']['id'] as int;
      if (mounted) {
        _loadRooms();
        _enterRoom(newRoomId, name, roleName, name, isGroup: false);
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res['message'] ?? '채팅방 생성에 실패했습니다.')),
        );
      }
    }
  }

  Future<void> _openOrCreateGroupRoom({
    required String groupName,
    required List<int> userIds,
  }) async {
    // 같은 사람들과 만든 그룹방이 이미 있으면 그 방으로 들어간다
    final wanted = userIds.toSet();
    for (final room in _rooms.where((r) => r.type == 'GROUP')) {
      final others = room.members
          .where((m) => m.email.toLowerCase() != (_myEmail ?? '').toLowerCase())
          .map((m) => m.userId)
          .toSet();
      if (others.length == wanted.length && others.containsAll(wanted)) {
        _enterRoom(room.id, room.name, '그룹 채팅', '${room.members.length}명 참여 중', isGroup: true, memberCount: room.members.length);
        return;
      }
    }

    // 신규 그룹 채팅방 개설
    final res = await ApiService().createChatRoom(
      name: groupName,
      type: 'GROUP',
      userIds: userIds,
      creatorEmail: _myEmail ?? 'parent@takeme.com',
    );

    if (res['success'] && res['data'] != null) {
      final newRoomId = res['data']['id'] as int;
      if (mounted) {
        _loadRooms();
        _enterRoom(newRoomId, groupName, '그룹 채팅', '${userIds.length + 1}명 참여 중', isGroup: true, memberCount: userIds.length + 1);
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res['message'] ?? '그룹 채팅방을 만들지 못했습니다.')),
        );
      }
    }
  }

  void _enterRoom(int roomId, String title, String role, String opponentName, {bool isGroup = false, int? memberCount}) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ParentChatRoomScreen(
          roomId: roomId,
          roomName: title,
          opponentRole: role,
          opponentName: opponentName,
          isGroup: isGroup,
          memberCount: memberCount,
        ),
      ),
    ).then((_) => _loadRooms());
  }

  /// 대화 상대 선택 바텀시트: 체크박스로 여러 명을 고른다.
  /// 1명이면 1:1 대화, 2명 이상이면 그룹 채팅방을 만든다.
  void _showContactPicker() {
    if (_contacts.isEmpty) _loadContacts();
    final Set<int> selectedIds = {};
    final nameCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        String searchQuery = '';
        String selectedCategory = '전체';

        return StatefulBuilder(
          builder: (context, setModalState) {
            final filteredContacts = _contacts.where((c) {
              final matchCat = selectedCategory == '전체' || c.category == selectedCategory;
              final matchQuery = searchQuery.isEmpty ||
                  c.name.contains(searchQuery) ||
                  c.roleTitle.contains(searchQuery) ||
                  c.description.contains(searchQuery);
              return matchCat && matchQuery;
            }).toList();
            final selected = _contacts.where((c) => selectedIds.contains(c.userId)).toList();

            return Container(
              height: MediaQuery.of(context).size.height * 0.82,
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                children: [
                  const SizedBox(height: 12),
                  Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xFFCBD5E1), borderRadius: BorderRadius.circular(2))),
                  const SizedBox(height: 14),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('대화 상대 선택', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                              SizedBox(height: 2),
                              Text('여러 명을 선택하면 그룹 채팅방이 만들어져요.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            ],
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close_rounded, color: Color(0xFF94A3B8)),
                          onPressed: () => Navigator.pop(ctx),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  // 검색창
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Container(
                      decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(12)),
                      child: TextField(
                        onChanged: (val) => setModalState(() => searchQuery = val.trim()),
                        decoration: const InputDecoration(
                          hintText: '이름, 직책으로 검색 (예: 담임, 기사님)',
                          hintStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                          prefixIcon: Icon(Icons.search_rounded, color: Color(0xFF64748B), size: 20),
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  // 카테고리 칩
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: ['전체', '담임·교사', '학부모', '통학차량', '원장·행정'].map((cat) {
                        final isSelected = selectedCategory == cat;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(cat, style: TextStyle(fontSize: 12, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal, color: isSelected ? Colors.white : const Color(0xFF475569))),
                            selected: isSelected,
                            selectedColor: const Color(0xFF2563EB),
                            backgroundColor: const Color(0xFFF8FAFC),
                            onSelected: (_) => setModalState(() => selectedCategory = cat),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  const Divider(height: 20, thickness: 1, color: Color(0xFFF1F5F9)),
                  // 목록
                  Expanded(
                    child: _isLoadingContacts && _contacts.isEmpty
                        ? const Center(child: CircularProgressIndicator())
                        : (_contactsError != null && _contacts.isEmpty)
                            ? Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.cloud_off_rounded, size: 40, color: Color(0xFFCBD5E1)),
                                    const SizedBox(height: 10),
                                    const Text(
                                      '대화 상대를 불러오지 못했습니다.',
                                      style: TextStyle(color: Color(0xFF64748B), fontSize: 14, fontWeight: FontWeight.bold),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      _contactsError!,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                                    ),
                                    const SizedBox(height: 12),
                                    OutlinedButton.icon(
                                      onPressed: () async {
                                        await _loadContacts();
                                        setModalState(() {});
                                      },
                                      icon: const Icon(Icons.refresh_rounded, size: 18),
                                      label: const Text('다시 시도'),
                                    ),
                                  ],
                                ),
                              )
                            : filteredContacts.isEmpty
                                ? const Center(
                                    child: Text(
                                      '검색된 대화 상대가 없습니다.',
                                      style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                                    ),
                                  )
                                : ListView.separated(
                                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                                    itemCount: filteredContacts.length,
                                    separatorBuilder: (_, __) => const SizedBox(height: 6),
                                    itemBuilder: (context, index) {
                                      final c = filteredContacts[index];
                                      final isChecked = selectedIds.contains(c.userId);
                                      return CheckboxListTile(
                                        value: isChecked,
                                        onChanged: (val) => setModalState(() {
                                          if (val == true) {
                                            selectedIds.add(c.userId);
                                          } else {
                                            selectedIds.remove(c.userId);
                                          }
                                        }),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(12),
                                          side: BorderSide(color: isChecked ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0)),
                                        ),
                                        tileColor: isChecked ? const Color(0xFFEFF6FF) : Colors.white,
                                        activeColor: const Color(0xFF2563EB),
                                        secondary: CircleAvatar(
                                          backgroundColor: c.bgColor,
                                          radius: 18,
                                          child: Icon(c.icon, color: c.themeColor, size: 18),
                                        ),
                                        title: Text(c.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                                        subtitle: Text(c.roleTitle, style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                                        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                                      );
                                    },
                                  ),
                  ),
                  // 2명 이상이면 그룹 채팅방 이름 (비우면 참여자 이름으로)
                  if (selected.length >= 2)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: TextField(
                        controller: nameCtrl,
                        decoration: InputDecoration(
                          labelText: '그룹 채팅방 이름 (선택)',
                          hintText: _autoGroupName(selected),
                          isDense: true,
                          filled: true,
                          fillColor: const Color(0xFFF8FAFC),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
                        ),
                      ),
                    ),
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                      child: SizedBox(
                        width: double.infinity,
                        height: 50,
                        child: ElevatedButton.icon(
                          onPressed: selected.isEmpty
                              ? null
                              : () {
                                  Navigator.pop(ctx);
                                  if (selected.length == 1) {
                                    final c = selected.first;
                                    _openDirectRoom(name: c.name, targetUserId: c.userId, roleName: c.roleTitle);
                                  } else {
                                    final typed = nameCtrl.text.trim();
                                    _openOrCreateGroupRoom(
                                      groupName: typed.isNotEmpty ? typed : _autoGroupName(selected),
                                      userIds: selected.map((c) => c.userId).toList(),
                                    );
                                  }
                                },
                          icon: Icon(selected.length >= 2 ? Icons.groups_rounded : Icons.chat_bubble_rounded, color: Colors.white),
                          label: Text(
                            selected.isEmpty
                                ? '대화할 상대를 선택하세요'
                                : (selected.length == 1 ? '${selected.first.name}와 대화하기' : '${selected.length}명과 그룹 채팅 시작'),
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF2563EB),
                            disabledBackgroundColor: const Color(0xFFCBD5E1),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    ).whenComplete(nameCtrl.dispose);
  }

  /// 그룹 채팅방 기본 이름: "김선생님, 박기사님 외 2명"
  String _autoGroupName(List<ChatContact> members) {
    final names = members.map((c) => c.name).toList();
    if (names.length <= 3) return names.join(', ');
    return '${names.take(2).join(', ')} 외 ${names.length - 2}명';
  }

  /// 알림 방(TakeMe 알림·공지사항)은 맨 위에 고정, 그 아래 1:1·그룹 대화를 함께 보여준다
  Widget _buildRoomsList() {
    final notiRooms = _rooms.where((r) => r.type == 'NOTIFICATION_SYSTEM').toList()
      ..sort((a, b) => (a.name == 'TakeMe 알림' ? 0 : 1).compareTo(b.name == 'TakeMe 알림' ? 0 : 1));
    final chatRooms = _rooms.where((r) => r.type == 'DIRECT' || r.type == 'GROUP').toList();

    return RefreshIndicator(
      onRefresh: _loadRooms,
      color: const Color(0xFF2563EB),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 대화 상대 선택하기
          InkWell(
            onTap: _showContactPicker,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFBFDBFE), width: 1.5),
              ),
              child: const Row(
                children: [
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: Color(0xFFEFF6FF),
                    child: Icon(Icons.person_search_rounded, color: Color(0xFF2563EB), size: 24),
                  ),
                  SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('대화 상대 선택하기', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                        SizedBox(height: 2),
                        Text('한 명은 1:1 대화, 여러 명은 그룹 채팅', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                      ],
                    ),
                  ),
                  Icon(Icons.arrow_forward_ios_rounded, color: Color(0xFF2563EB), size: 14),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_loadError != null && _rooms.isEmpty)
            // 불러오기에 실패했을 때 "대화 없음"으로 보이지 않게 이유를 알려준다
            _buildEmptyState('대화 목록을 불러오지 못했습니다.', '$_loadError\n화면을 아래로 당겨 다시 시도해 주세요.')
          else ...[
            ...notiRooms.map((room) => _buildRoomCard(room, isGroup: false)),
            if (chatRooms.isEmpty)
              _buildEmptyState('진행 중인 대화가 없습니다.', '[대화 상대 선택하기]로 대화를 시작하세요.')
            else
              ...chatRooms.map((room) => _buildRoomCard(room, isGroup: room.type == 'GROUP')),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        automaticallyImplyLeading: !widget.isEmbedded,
        elevation: 0,
        backgroundColor: Colors.white,
        centerTitle: false,
        title: const Row(
          children: [
            Icon(Icons.chat_bubble_rounded, color: Color(0xFF2563EB), size: 22),
            SizedBox(width: 8),
            Text('채팅방', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFF0F172A))),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFF475569)),
            tooltip: '새로고침',
            onPressed: () {
              _loadRooms();
              _loadContacts();
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : _buildRoomsList(),
    );
  }

  void _showRoomActions(ChatRoomModel room, String title) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            ListTile(
              minTileHeight: 56,
              leading: Icon(room.isPinned ? Icons.push_pin_outlined : Icons.push_pin),
              title: Text(room.isPinned ? '고정 해제' : '맨 위에 고정', style: const TextStyle(fontSize: 16)),
              onTap: () {
                Navigator.pop(ctx);
                _roomAction('/chat/rooms/${room.id}/pin', {'pinned': !room.isPinned},
                    failText: room.isPinned ? '고정을 해제하지 못했습니다.' : '고정하지 못했습니다.');
              },
            ),
            ListTile(
              minTileHeight: 56,
              leading: const Icon(Icons.delete_outline, color: Color(0xFFDC2626)),
              title: const Text('채팅방 삭제', style: TextStyle(fontSize: 16, color: Color(0xFFDC2626))),
              onTap: () {
                Navigator.pop(ctx);
                showDialog(
                  context: context,
                  builder: (dctx) => AlertDialog(
                    title: const Text('채팅방 삭제'),
                    content: Text('"$title" 채팅방을 내 목록에서 삭제할까요?\n상대방에게는 그대로 남고, 새 메시지가 오면 다시 보입니다.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(dctx), child: const Text('취소')),
                      TextButton(
                        onPressed: () {
                          Navigator.pop(dctx);
                          _roomAction('/chat/rooms/${room.id}/hide', {}, failText: '채팅방을 삭제하지 못했습니다.');
                        },
                        child: const Text('삭제', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _roomAction(String path, Map<String, dynamic> body, {required String failText}) async {
    try {
      final res = await ApiService().postWithAuth(Uri.parse('${AppConfig.apiHost}$path'), jsonEncode(body));
      if (res.statusCode == 200 || res.statusCode == 201) {
        _loadRooms();
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$failText (${res.statusCode})')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$failText ${friendlyError(e)}')));
    }
  }


  Widget _buildRoomCard(ChatRoomModel room, {required bool isGroup}) {
    final title = isGroup ? room.name : room.getDisplayName(_myEmail);
    final opponent = isGroup ? null : room.getOtherMember(_myEmail);
    final opponentRole = isGroup ? '그룹 대화' : (opponent?.role ?? '교직원');
    final memberCount = room.members.length;

    final lastMsg = room.lastMessage;
    // 알림 방에 아직 메시지가 없으면 무슨 방인지 설명을 보여준다
    final lastText = lastMsg?.text ??
        (room.type == 'NOTIFICATION_SYSTEM'
            ? (room.name == 'TakeMe 알림' ? '나와 우리 아이 관련 알림이 오는 방이에요' : '유치원 전체 공지가 오는 방이에요')
            : '대화 내용이 없습니다.');
    final dateStr = lastMsg != null ? _formatDate(lastMsg.createdAt) : '';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 4,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _enterRoom(
            room.id,
            title,
            // 알림 방(TakeMe 알림·공지사항)은 상대가 없으므로 방 이름 그대로, 역할은 SYSTEM
            room.type == 'NOTIFICATION_SYSTEM' ? 'SYSTEM' : opponentRole,
            room.type == 'NOTIFICATION_SYSTEM' ? title : (opponent?.name ?? title),
            isGroup: isGroup,
            memberCount: memberCount,
          ),
          // 길게 누르면 맨 위 고정/채팅방 삭제 (TakeMe 알림은 항상 맨 위라 해당 없음)
          onLongPress: room.type == 'NOTIFICATION_SYSTEM' ? null : () => _showRoomActions(room, title),
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                if (room.type == 'NOTIFICATION_SYSTEM' && room.name == 'TakeMe 알림')
                  // TakeMe 알림: 차량선생님·기사 앱과 같은 어두운 종 아이콘
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.notifications_active, color: Colors.white, size: 22),
                  )
                else if (room.type == 'NOTIFICATION_SYSTEM')
                  // 공지사항: 기관 전체 공지
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: const Color(0xFFECFDF5),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.campaign_rounded, color: Color(0xFF059669), size: 24),
                  )
                else
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: isGroup ? const Color(0xFFEDE9FE) : const Color(0xFFEFF6FF),
                    child: Icon(
                      isGroup ? Icons.groups_rounded : Icons.person_rounded,
                      color: isGroup ? const Color(0xFF7C3AED) : const Color(0xFF2563EB),
                      size: 24,
                    ),
                  ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (room.isPinned) ...[
                            const Icon(Icons.push_pin, size: 14, color: Color(0xFF64748B), semanticLabel: '고정됨'),
                            const SizedBox(width: 4),
                          ],
                          Flexible(
                            child: Text(
                              title,
                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (isGroup) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(color: const Color(0xFFEDE9FE), borderRadius: BorderRadius.circular(10)),
                              child: Text('$memberCount명', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF7C3AED))),
                            ),
                          ],
                          const Spacer(),
                          Text(dateStr, style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        lastText,
                        style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                if (room.unreadCount > 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(color: const Color(0xFFEF4444), borderRadius: BorderRadius.circular(10)),
                    child: Text(
                      '${room.unreadCount}',
                      style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(String title, String subtitle) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 40),
      alignment: Alignment.center,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(color: Color(0xFFF1F5F9), shape: BoxShape.circle),
            child: const Icon(Icons.chat_bubble_outline_rounded, size: 36, color: Color(0xFF94A3B8)),
          ),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF475569))),
          const SizedBox(height: 4),
          Text(subtitle, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)), textAlign: TextAlign.center),
        ],
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return DateFormat('a h:mm', 'ko').format(dt);
    }
    return DateFormat('M월 d일', 'ko').format(dt);
  }
}
