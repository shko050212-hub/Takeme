import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/student_model.dart';
import '../models/user_model.dart';
import 'login_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  StudentModel? _childInfo;
  final _allergyController = TextEditingController();
  bool _isSavingAllergy = false;
  bool _isDeletingAccount = false;

  bool _notiAll = true;
  bool _notiChangeRequest = true;
  bool _notiChat = true;
  bool _notiNotice = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _allergyController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    final user = ApiService().currentUser;
    if (user != null && (user.role == 'PARENT' || user.role == 'STUDENT')) {
      final child = await ApiService().getMyChild(user.email);
      if (mounted) {
        setState(() {
          _childInfo = child;
          if (child != null) {
            _allergyController.text = child.allergies;
          }
        });
      }
    }

    try {
      final noti = await ApiService().getMyNotificationSettings();
      if (mounted) {
        setState(() {
          _notiAll = noti['all'] ?? true;
          _notiChangeRequest = noti['change_request'] ?? true;
          _notiChat = noti['chat'] ?? true;
          _notiNotice = noti['notice'] ?? true;
        });
      }
    } catch (_) {}
  }

  Future<void> _updateNotiSetting(String key, bool val) async {
    setState(() {
      if (key == 'all') _notiAll = val;
      if (key == 'change_request') _notiChangeRequest = val;
      if (key == 'chat') _notiChat = val;
      if (key == 'notice') _notiNotice = val;
    });
    await ApiService().updateMyNotificationSettings({
      'all': _notiAll,
      'change_request': _notiChangeRequest,
      'chat': _notiChat,
      'notice': _notiNotice,
    });
  }

  Future<void> _handleSaveAllergy() async {
    final user = ApiService().currentUser;
    if (user == null) return;

    setState(() => _isSavingAllergy = true);
    final res = await ApiService().updateChildAllergies(user.email, _allergyController.text.trim());
    setState(() => _isSavingAllergy = false);

    if (!mounted) return;
    if (res['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('알레르기 정보가 수정되었습니다.'), backgroundColor: Color(0xFF10B981)),
      );
      _loadData();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(res['message'] ?? '저장에 실패했습니다.'), backgroundColor: Colors.red),
      );
    }
  }

  void _handleDeleteAccount() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('회원 탈퇴', style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text(
          '정말로 회원 탈퇴하시겠습니까?\n모든 계정 및 연동 정보가 즉시 삭제되며 복구할 수 없습니다.',
          style: TextStyle(height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final user = ApiService().currentUser;
              if (user == null) return;

              setState(() => _isDeletingAccount = true);
              final res = await ApiService().deleteAccount(user.email);
              setState(() => _isDeletingAccount = false);

              if (!mounted) return;
              if (res['success'] == true) {
                Navigator.pushAndRemoveUntil(
                  context,
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                  (route) => false,
                );
              } else {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(res['message'] ?? '탈퇴 처리에 실패했습니다.'), backgroundColor: Colors.red),
                );
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            child: const Text('탈퇴하기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _handleLogout() async {
    await ApiService().logout();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = ApiService().currentUser;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          '환경설정',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: Color(0xFF1E293B)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20, color: Color(0xFF64748B)),
          onPressed: () => Navigator.pop(context),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Child Info & Allergy settings (Parent / Student only)
                  if (_childInfo != null) ...[
                    const Text(
                      '자녀(원아) 정보 및 알레르기 설정',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Color(0xFF64748B)),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _buildInfoRow('원아 성명', '${_childInfo!.name} (${_childInfo!.className ?? '반 미배정'})'),
                          const Divider(height: 20, color: Color(0xFFF1F5F9)),
                          _buildInfoRow('소속 유치원', _childInfo!.academyName ?? '소속 원'),
                          const Divider(height: 20, color: Color(0xFFF1F5F9)),
                          _buildInfoRow('배정 통학차량', _childInfo!.vehicleName ?? '배정 대기'),
                          const Divider(height: 20, color: Color(0xFFF1F5F9)),
                          const Text(
                            '알레르기 정보 (식품/약품 주의사항)',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B)),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _allergyController,
                            decoration: InputDecoration(
                              hintText: '예: 땅콩, 복숭아, 유제품 알레르기 주의',
                              hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                          ),
                          const SizedBox(height: 10),
                          ElevatedButton(
                            onPressed: _isSavingAllergy ? null : _handleSaveAllergy,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF2563EB),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            child: _isSavingAllergy
                                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                : const Text('알레르기 저장', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                  ],

                  // Notification Settings (담임 / 지도교사)
                  _buildTeacherNotificationSection(),

                  // Account Info
                  const Text(
                    '계정 정보',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Color(0xFF64748B)),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      children: [
                        _buildInfoRow('로그인 이메일', user?.email ?? '알 수 없음'),
                        const Divider(height: 20, color: Color(0xFFF1F5F9)),
                        _buildInfoRow(
                          '계정 역할',
                          UserModel.getRoleKorean(user?.role),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Logout Button
                  OutlinedButton.icon(
                    onPressed: _handleLogout,
                    icon: const Icon(Icons.logout, size: 18, color: Color(0xFF475569)),
                    label: const Text('로그아웃', style: TextStyle(color: Color(0xFF475569), fontWeight: FontWeight.bold)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      backgroundColor: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Delete Account Button
                  OutlinedButton.icon(
                    onPressed: _isDeletingAccount ? null : _handleDeleteAccount,
                    icon: const Icon(Icons.delete_outline, size: 18, color: Color(0xFFDC2626)),
                    label: const Text('회원 탈퇴 (모든 정보 삭제)', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      side: const BorderSide(color: Color(0xFFFECACA)),
                      backgroundColor: const Color(0xFFFEF2F2),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTeacherNotificationSection() {
    final subEnabled = _notiAll;
    const disabledColor = Color(0xFF94A3B8);
    const activeTextColor = Color(0xFF0F172A);
    const activeSubColor = Color(0xFF64748B);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          '알림 수신 설정',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Color(0xFF64748B)),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                activeTrackColor: const Color(0xFF93C5FD),
                activeColor: const Color(0xFF2563EB),
                title: const Text('전체', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
                subtitle: const Text('모든 알림을 수신합니다', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                value: _notiAll,
                onChanged: (val) => _updateNotiSetting('all', val),
              ),
              const Divider(height: 1, color: Color(0xFFF1F5F9)),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                activeTrackColor: subEnabled ? const Color(0xFF93C5FD) : const Color(0xFFE2E8F0),
                activeColor: subEnabled ? const Color(0xFF2563EB) : const Color(0xFF94A3B8),
                title: Text(
                  '통학 변동 신청',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: subEnabled ? activeTextColor : disabledColor,
                  ),
                ),
                subtitle: Text(
                  '결석·지각·하원 방식 변경 등 원아 변동 신청 알림',
                  style: TextStyle(
                    fontSize: 12,
                    color: subEnabled ? activeSubColor : disabledColor,
                  ),
                ),
                value: subEnabled ? _notiChangeRequest : false,
                onChanged: subEnabled ? (val) => _updateNotiSetting('change_request', val) : null,
              ),
              const Divider(height: 1, color: Color(0xFFF1F5F9)),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                activeTrackColor: subEnabled ? const Color(0xFF93C5FD) : const Color(0xFFE2E8F0),
                activeColor: subEnabled ? const Color(0xFF2563EB) : const Color(0xFF94A3B8),
                title: Text(
                  '메시지',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: subEnabled ? activeTextColor : disabledColor,
                  ),
                ),
                subtitle: Text(
                  '학부모 및 원내 교직원과의 1:1/단체 메시지 알림',
                  style: TextStyle(
                    fontSize: 12,
                    color: subEnabled ? activeSubColor : disabledColor,
                  ),
                ),
                value: subEnabled ? _notiChat : false,
                onChanged: subEnabled ? (val) => _updateNotiSetting('chat', val) : null,
              ),
              const Divider(height: 1, color: Color(0xFFF1F5F9)),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                activeTrackColor: subEnabled ? const Color(0xFF93C5FD) : const Color(0xFFE2E8F0),
                activeColor: subEnabled ? const Color(0xFF2563EB) : const Color(0xFF94A3B8),
                title: Text(
                  '공지',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: subEnabled ? activeTextColor : disabledColor,
                  ),
                ),
                subtitle: Text(
                  '유치원 휴원일, 행사 일정 등 기관 공지 알림',
                  style: TextStyle(
                    fontSize: 12,
                    color: subEnabled ? activeSubColor : disabledColor,
                  ),
                ),
                value: subEnabled ? _notiNotice : false,
                onChanged: subEnabled ? (val) => _updateNotiSetting('notice', val) : null,
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 13, color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
        Text(value, style: const TextStyle(fontSize: 13, color: Color(0xFF1E293B), fontWeight: FontWeight.bold)),
      ],
    );
  }
}
