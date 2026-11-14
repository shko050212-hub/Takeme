import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/student_model.dart';
import '../models/user_model.dart';
import 'login_screen.dart';

class SettingsScreen extends StatefulWidget {
  final bool isEmbeddedTab;
  const SettingsScreen({super.key, this.isEmbeddedTab = false});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  StudentModel? _childInfo;
  final _allergyController = TextEditingController();
  bool _isSavingAllergy = false;
  bool _isDeletingAccount = false;
  String _userPhone = '';
  bool _notifyShuttleOperation = true;
  bool _notifyBoardPost = true;

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
      final profile = await ApiService().getParentProfile();
      final notiSettings = await ApiService().getNotificationSettings();
      if (mounted) {
        setState(() {
          _childInfo = child;
          if (child != null) {
            _allergyController.text = child.allergies;
          }
          if (profile != null && profile['phone'] != null) {
            _userPhone = profile['phone'].toString();
          }
          _notifyShuttleOperation = notiSettings['notifyShuttleOperation'] ?? true;
          _notifyBoardPost = notiSettings['notifyBoardPost'] ?? true;
        });
      }
    }
  }

  void _showPhoneEditDialog() {
    final phoneCtrl = TextEditingController(text: _userPhone);
    bool isSaving = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) {
          return AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: const Text('전화번호 변경', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '비상 연락 및 알림 수신을 위한 휴대폰 번호를 입력해주세요.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF64748B), height: 1.4),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    hintText: '010-0000-0000',
                    labelText: '휴대폰 번호',
                    prefixIcon: const Icon(Icons.phone_android, size: 20, color: Color(0xFF2563EB)),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
              ),
              ElevatedButton(
                onPressed: isSaving
                    ? null
                    : () async {
                        final val = phoneCtrl.text.trim();
                        if (val.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('전화번호를 입력해주세요.'), backgroundColor: Colors.red),
                          );
                          return;
                        }
                        setDialogState(() => isSaving = true);
                        final res = await ApiService().updateParentPhone(val);
                        setDialogState(() => isSaving = false);
                        if (!ctx.mounted) return;
                        Navigator.pop(ctx);
                        if (res['success'] == true) {
                          setState(() => _userPhone = val);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('전화번호가 성공적으로 변경되었습니다.'), backgroundColor: Color(0xFF10B981)),
                          );
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(res['message'] ?? '변경에 실패했습니다.'), backgroundColor: Colors.red),
                          );
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: isSaving
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('저장하기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ],
          );
        },
      ),
    );
  }

  void _showPasswordChangeDialog() {
    final curCtrl = TextEditingController();
    final newCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    bool obscureCur = true;
    bool obscureNew = true;
    bool obscureConfirm = true;
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) {
          return AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: const Text('비밀번호 변경', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '안전한 로그인을 위해 새 비밀번호를 설정해주세요. (최소 6자 이상)',
                    style: TextStyle(fontSize: 12, color: Color(0xFF64748B), height: 1.4),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: curCtrl,
                    obscureText: obscureCur,
                    decoration: InputDecoration(
                      labelText: '현재 비밀번호',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      suffixIcon: IconButton(
                        icon: Icon(obscureCur ? Icons.visibility_off : Icons.visibility, size: 18),
                        onPressed: () => setDialogState(() => obscureCur = !obscureCur),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: newCtrl,
                    obscureText: obscureNew,
                    decoration: InputDecoration(
                      labelText: '새 비밀번호 (6자 이상)',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      suffixIcon: IconButton(
                        icon: Icon(obscureNew ? Icons.visibility_off : Icons.visibility, size: 18),
                        onPressed: () => setDialogState(() => obscureNew = !obscureNew),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: confirmCtrl,
                    obscureText: obscureConfirm,
                    decoration: InputDecoration(
                      labelText: '새 비밀번호 확인',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      suffixIcon: IconButton(
                        icon: Icon(obscureConfirm ? Icons.visibility_off : Icons.visibility, size: 18),
                        onPressed: () => setDialogState(() => obscureConfirm = !obscureConfirm),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
              ),
              ElevatedButton(
                onPressed: isSubmitting
                    ? null
                    : () async {
                        final cur = curCtrl.text.trim();
                        final newP = newCtrl.text.trim();
                        final conf = confirmCtrl.text.trim();
                        if (cur.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('현재 비밀번호를 입력해주세요.'), backgroundColor: Colors.red),
                          );
                          return;
                        }
                        if (newP.length < 6) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('새 비밀번호는 6자 이상이어야 합니다.'), backgroundColor: Colors.red),
                          );
                          return;
                        }
                        if (newP != conf) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('새 비밀번호가 일치하지 않습니다.'), backgroundColor: Colors.red),
                          );
                          return;
                        }
                        setDialogState(() => isSubmitting = true);
                        final res = await ApiService().changeParentPassword(cur, newP);
                        setDialogState(() => isSubmitting = false);
                        if (!ctx.mounted) return;
                        if (res['success'] == true) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('비밀번호가 성공적으로 변경되었습니다.'), backgroundColor: Color(0xFF10B981)),
                          );
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(res['message'] ?? '비밀번호 변경에 실패했습니다.'), backgroundColor: Colors.red),
                          );
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: isSubmitting
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('변경하기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ],
          );
        },
      ),
    );
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
        automaticallyImplyLeading: !widget.isEmbeddedTab,
        leading: widget.isEmbeddedTab
            ? null
            : IconButton(
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

                  // Notification Settings (Parent / Student)
                  if (user?.role == 'PARENT' || user?.role == 'STUDENT') ...[
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
                            thumbColor: WidgetStateProperty.resolveWith<Color>((states) {
                              if (states.contains(WidgetState.selected)) {
                                return const Color(0xFF2563EB);
                              }
                              return Colors.white;
                            }),
                            title: const Text('기사 운행 알림', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
                            subtitle: const Text('셔틀 운행 시작 및 종료 알림을 받습니다', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            value: _notifyShuttleOperation,
                            onChanged: (val) async {
                              setState(() => _notifyShuttleOperation = val);
                              await ApiService().updateNotificationSettings(notifyShuttleOperation: val);
                            },
                          ),
                          const Divider(height: 1, color: Color(0xFFF1F5F9)),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            activeTrackColor: const Color(0xFF93C5FD),
                            thumbColor: WidgetStateProperty.resolveWith<Color>((states) {
                              if (states.contains(WidgetState.selected)) {
                                return const Color(0xFF2563EB);
                              }
                              return Colors.white;
                            }),
                            title: const Text('담임 알림장 알림', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
                            subtitle: const Text('우리 반 새 알림장 글 및 사진 등록 알림을 받습니다', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            value: _notifyBoardPost,
                            onChanged: (val) async {
                              setState(() => _notifyBoardPost = val);
                              await ApiService().updateNotificationSettings(notifyBoardPost: val);
                            },
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
                          UserModel.getRoleKorean(user?.role),
                        ),
                        const Divider(height: 20, color: Color(0xFFF1F5F9)),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('연락처 (전화번호)', style: TextStyle(fontSize: 13, color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
                                const SizedBox(height: 2),
                                Text(
                                  _userPhone.isNotEmpty ? _userPhone : '등록된 전화번호 없음',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: _userPhone.isNotEmpty ? const Color(0xFF1E293B) : const Color(0xFF94A3B8),
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                            OutlinedButton(
                              onPressed: _showPhoneEditDialog,
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                visualDensity: VisualDensity.compact,
                                side: const BorderSide(color: Color(0xFFBFDBFE)),
                                backgroundColor: const Color(0xFFEFF6FF),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                              ),
                              child: const Text('수정', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF2563EB))),
                            ),
                          ],
                        ),
                        const Divider(height: 20, color: Color(0xFFF1F5F9)),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('로그인 비밀번호', style: TextStyle(fontSize: 13, color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
                                SizedBox(height: 2),
                                Text('••••••••', style: TextStyle(fontSize: 13, color: Color(0xFF1E293B), fontWeight: FontWeight.bold)),
                              ],
                            ),
                            OutlinedButton(
                              onPressed: _showPasswordChangeDialog,
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                visualDensity: VisualDensity.compact,
                                side: const BorderSide(color: Color(0xFFCBD5E1)),
                                backgroundColor: const Color(0xFFF8FAFC),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                              ),
                              child: const Text('비번 변경', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF475569))),
                            ),
                          ],
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
