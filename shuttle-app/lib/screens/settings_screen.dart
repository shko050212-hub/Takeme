import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/student_model.dart';
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
                          user?.role == 'DRIVER'
                              ? '기사님'
                              : (user?.role == 'TEACHER'
                                  ? '지도교사'
                                  : (user?.role == 'PARENT' ? '학부모' : '학생')),
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
