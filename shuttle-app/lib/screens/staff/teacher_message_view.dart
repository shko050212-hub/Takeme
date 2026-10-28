import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../models/student_model.dart';

class TeacherMessageView extends StatefulWidget {
  final List<StudentModel> students;
  const TeacherMessageView({super.key, this.students = const []});

  @override
  State<TeacherMessageView> createState() => _TeacherMessageViewState();
}

class _TeacherMessageViewState extends State<TeacherMessageView> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _inboxMessages = [];
  bool _isLoadingInbox = true;

  // Send Message form state
  final _messageController = TextEditingController();
  bool _isSending = false;
  String _targetRecipient = 'ADMIN'; // 'ADMIN' or 'PARENTS'
  int? _selectedStudentId;
  Map<String, dynamic>? _staffInfo;

  final List<String> _quickTemplates = const [
    '원아 전원 안전하게 하차 및 등원 완료했습니다.',
    '교통 체증으로 인하여 셔틀 도착이 약 10분 지연될 예정입니다.',
    '원아 컨디션 확인 및 특이사항 보고드립니다.',
    '오늘 일정 및 차량 운행 이상 없습니다.',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadInbox();
    _loadStaffInfo();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _loadInbox() async {
    setState(() => _isLoadingInbox = true);
    final user = ApiService().currentUser;
    if (user != null) {
      final list = await ApiService().getTeacherInbox(user.email);
      if (mounted) {
        setState(() {
          _inboxMessages = list;
          _isLoadingInbox = false;
        });
      }
    }
  }

  Future<void> _loadStaffInfo() async {
    final staff = await ApiService().getStaffList();
    if (mounted) {
      setState(() {
        _staffInfo = staff;
      });
    }
  }

  Future<void> _handleSendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('메시지 내용을 입력해주세요.')),
      );
      return;
    }

    final user = ApiService().currentUser;
    if (user == null) return;

    setState(() => _isSending = true);

    Map<String, dynamic> res;

    if (_targetRecipient == 'ADMIN') {
      final adminId = _staffInfo?['admin']?['id'] as int?;
      res = await ApiService().sendTeacherMessage(
        email: user.email,
        message: text,
        staffUserIds: adminId != null ? [adminId] : [],
      );
    } else {
      // Send to parents
      final targetIds = _selectedStudentId != null
          ? [_selectedStudentId!]
          : widget.students.map((s) => s.id).toList();

      res = await ApiService().sendTeacherMessage(
        email: user.email,
        message: text,
        parentIds: targetIds,
        studentIds: targetIds,
      );
    }

    setState(() => _isSending = false);

    if (mounted) {
      if (res['success'] == true) {
        _messageController.clear();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('메시지가 성공적으로 전송되었습니다. 관리자 웹 및 학부모 앱에 즉시 반영됩니다.'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
        _tabController.animateTo(0);
        _loadInbox();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['message'] ?? '메시지 전송에 실패했습니다.'),
            backgroundColor: const Color(0xFFDC2626),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Tab Header
        Container(
          color: Colors.white,
          child: TabBar(
            controller: _tabController,
            labelColor: const Color(0xFF2563EB),
            unselectedLabelColor: const Color(0xFF64748B),
            indicatorColor: const Color(0xFF2563EB),
            indicatorWeight: 3,
            labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            tabs: const [
              Tab(text: '수신함 (받은 메시지)'),
              Tab(text: '메시지 보내기'),
            ],
          ),
        ),

        // Tab Views
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              // Tab 1: Inbox
              _buildInboxTab(),

              // Tab 2: Send Message
              _buildSendTab(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInboxTab() {
    if (_isLoadingInbox) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)));
    }

    if (_inboxMessages.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.mark_email_read_outlined, size: 48, color: Color(0xFFCBD5E1)),
            const SizedBox(height: 8),
            const Text('수신된 메시지가 없습니다.', style: TextStyle(color: Color(0xFF94A3B8))),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _loadInbox,
              child: const Text('새로고침'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadInbox,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _inboxMessages.length,
        separatorBuilder: (ctx, idx) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final msg = _inboxMessages[index];
          final text = msg['message']?.toString() ?? '';
          final createdAt = msg['createdAt'] != null
              ? DateFormat('yyyy.MM.dd HH:mm').format(DateTime.parse(msg['createdAt']))
              : '';
          final student = msg['student'] as Map<String, dynamic>?;
          final isUrgent = text.contains('긴급') || text.contains('사고') || text.contains('결석');

          return Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: isUrgent ? const Color(0xFFFECACA) : const Color(0xFFE2E8F0),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 4,
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
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: isUrgent ? const Color(0xFFFEE2E2) : const Color(0xFFEFF6FF),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            isUrgent ? '긴급 알림' : (student != null ? '학부모 전달' : '관리자 공지'),
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: isUrgent ? const Color(0xFFDC2626) : const Color(0xFF2563EB),
                            ),
                          ),
                        ),
                        if (student != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            '원아: ${student['name']}',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF334155)),
                          ),
                        ],
                      ],
                    ),
                    Text(
                      createdAt,
                      style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  text,
                  style: const TextStyle(fontSize: 14, color: Color(0xFF1E293B), height: 1.4),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSendTab() {
    final adminName = _staffInfo?['admin']?['name'] ?? '원장선생님';

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Target Selector Card
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '수신 대상 선택',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: ChoiceChip(
                        label: Text('원장님께 보고 ($adminName)'),
                        selected: _targetRecipient == 'ADMIN',
                        onSelected: (val) {
                          if (val) setState(() => _targetRecipient = 'ADMIN');
                        },
                        selectedColor: const Color(0xFF2563EB),
                        labelStyle: TextStyle(
                          color: _targetRecipient == 'ADMIN' ? Colors.white : const Color(0xFF475569),
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ChoiceChip(
                        label: const Text('학부모님께 발송'),
                        selected: _targetRecipient == 'PARENTS',
                        onSelected: (val) {
                          if (val) setState(() => _targetRecipient = 'PARENTS');
                        },
                        selectedColor: const Color(0xFF2563EB),
                        labelStyle: TextStyle(
                          color: _targetRecipient == 'PARENTS' ? Colors.white : const Color(0xFF475569),
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
                if (_targetRecipient == 'PARENTS' && widget.students.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<int?>(
                    initialValue: _selectedStudentId,
                    decoration: InputDecoration(
                      labelText: '원아 선택 (선택 안할 시 전체)',
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    items: [
                      const DropdownMenuItem<int?>(
                        value: null,
                        child: Text('전체 원아 학부모 (일괄 발송)'),
                      ),
                      ...widget.students.map(
                        (s) => DropdownMenuItem<int?>(
                          value: s.id,
                          child: Text('${s.name} (${s.boardingLocation ?? s.address})'),
                        ),
                      ),
                    ],
                    onChanged: (val) {
                      setState(() => _selectedStudentId = val);
                    },
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Quick templates
          const Text(
            '빠른 템플릿 입력',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _quickTemplates.map((t) {
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ActionChip(
                    label: Text(t, style: const TextStyle(fontSize: 11, color: Color(0xFF334155))),
                    backgroundColor: const Color(0xFFF1F5F9),
                    onPressed: () {
                      _messageController.text = t;
                    },
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 14),

          // Message Input Field
          TextField(
            controller: _messageController,
            maxLines: 5,
            decoration: InputDecoration(
              labelText: '메시지 내용',
              hintText: '전송할 메시지 내용을 자세히 입력하세요.',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
          ),
          const SizedBox(height: 18),

          // Send Button
          ElevatedButton(
            onPressed: _isSending ? null : _handleSendMessage,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2563EB),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              elevation: 0,
            ),
            child: _isSending
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                  )
                : const Text(
                    '메시지 전송하기',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                  ),
          ),
        ],
      ),
    );
  }
}
