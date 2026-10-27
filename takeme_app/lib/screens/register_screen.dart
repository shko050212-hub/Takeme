import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../theme.dart';

/// 회원가입 (기존 앱 register.tsx 와 같은 구성)
/// 역할 선택 → 원 인증코드 → 이름 → 이메일 인증 → 비밀번호
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const _roles = [
    ('STUDENT', '원아'),
    ('PARENT', '학부모'),
    ('TEACHER', '지도교사'),
    ('DRIVER', '기사'),
  ];

  String _role = 'DRIVER'; // 지금은 기사 앱 위주라 기본값을 기사로
  final _authCode = TextEditingController();
  final _name = TextEditingController();
  final _parentName = TextEditingController();
  final _allergies = TextEditingController();
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();

  bool _emailSent = false;
  bool _emailVerified = false;
  bool _busy = false;

  bool get _isFamily => _role == 'PARENT' || _role == 'STUDENT';

  @override
  void dispose() {
    for (final c in [_authCode, _name, _parentName, _allergies, _email, _code, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  void _alert(String title, String msg) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(msg),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('확인'))],
      ),
    );
  }

  Future<void> _sendEmail() async {
    if (_email.text.trim().isEmpty) return _alert('오류', '이메일을 입력해주세요.');
    setState(() => _busy = true);
    try {
      await ApiClient.instance.post('/auth/email/send', {'email': _email.text.trim()});
      setState(() => _emailSent = true);
      _alert('전송 완료', '이메일로 인증코드 6자리를 보냈습니다. (3분 안에 입력)');
    } catch (e) {
      _alert('오류', e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyEmail() async {
    if (_code.text.trim().length != 6) return _alert('오류', '인증코드 6자리를 입력해주세요.');
    setState(() => _busy = true);
    try {
      await ApiClient.instance.post('/auth/email/verify', {
        'email': _email.text.trim(),
        'code': _code.text.trim(),
      });
      setState(() => _emailVerified = true);
      _alert('인증 완료', '이메일 인증이 완료되었습니다.');
    } catch (e) {
      _alert('오류', e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _register() async {
    if (_authCode.text.trim().isEmpty) return _alert('오류', '원 인증코드를 입력해주세요.');
    if (_name.text.trim().isEmpty) {
      return _alert('오류', _isFamily ? '원아 이름을 입력해주세요.' : '이름을 입력해주세요.');
    }
    if (_role == 'PARENT' && _parentName.text.trim().isEmpty) {
      return _alert('오류', '학부모 본인 이름을 입력해주세요.');
    }
    if (!_emailVerified) return _alert('오류', '이메일 인증을 먼저 완료해주세요.');
    if (_password.text.length < 8) return _alert('오류', '비밀번호는 8자 이상이어야 합니다.');

    setState(() => _busy = true);
    try {
      await ApiClient.instance.post('/auth/register', {
        'email': _email.text.trim(),
        'password': _password.text,
        // 학부모는 본인 이름으로 가입하고, 원아 이름(targetName)으로 원아와 연결
        'name': _role == 'PARENT' ? _parentName.text.trim() : _name.text.trim(),
        'targetName': _name.text.trim(),
        'authCode': _authCode.text.trim(),
        'role': _role,
        if (_isFamily) 'allergies': _allergies.text.trim(),
      });
      if (!mounted) return;
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('가입 신청 완료'),
          content: const Text('원장선생님이 승인하면 로그인할 수 있습니다.'),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('확인'))],
        ),
      );
      if (mounted) Navigator.pop(context); // 로그인 화면으로
    } catch (e) {
      _alert('가입 실패', e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.slate600)),
      );

  Widget _field(TextEditingController c, String hint,
      {bool obscure = false, TextInputType? type, bool enabled = true, int? maxLength}) {
    return TextField(
      controller: c,
      obscureText: obscure,
      keyboardType: type,
      enabled: enabled && !_busy,
      maxLength: maxLength,
      style: const TextStyle(fontSize: 16, color: Color(0xFF0F172A)),
      decoration: InputDecoration(hintText: hint, counterText: ''),
    );
  }

  Widget _smallButton(String text, VoidCallback? onTap, {Color color = const Color(0xFF3B82F6)}) {
    return SizedBox(
      height: 54,
      child: ElevatedButton(
        onPressed: onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.slate300,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 20);
    final nameLabel = _isFamily ? '원아 이름' : (_role == 'TEACHER' ? '지도 교사 이름' : '기사님 이름');
    final nameHint = _isFamily ? '유치원에 등록된 원아 이름 (예: 홍길동)' : '유치원에 등록된 통학차량 담당자 이름 (예: 김기사)';

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            // 상단 바
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.slate100)),
              ),
              child: Row(
                children: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('← 뒤로', style: TextStyle(color: AppColors.slate600, fontSize: 16)),
                  ),
                  const Expanded(
                    child: Text('회원가입',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.slate800)),
                  ),
                  const SizedBox(width: 72),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  // 안내
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.blue50,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('원장선생님이 발급하신 원 인증코드가 필요합니다.',
                            style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.blue600)),
                        SizedBox(height: 4),
                        Text('안전한 관리를 위해 인증된 사용자만 가입할 수 있습니다.',
                            style: TextStyle(color: AppColors.slate600, fontSize: 13)),
                      ],
                    ),
                  ),
                  gap,

                  // 역할 선택
                  _label('가입 역할 선택'),
                  Row(
                    children: [
                      for (final (value, label) in _roles) ...[
                        Expanded(
                          child: InkWell(
                            borderRadius: BorderRadius.circular(8),
                            onTap: _busy ? null : () => setState(() => _role = value),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              decoration: BoxDecoration(
                                color: _role == value ? AppColors.blue50 : AppColors.slate50,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                    color: _role == value ? const Color(0xFF3B82F6) : AppColors.slate200),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                label,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: _role == value ? FontWeight.w800 : FontWeight.w600,
                                  color: _role == value ? AppColors.blue600 : AppColors.slate500,
                                ),
                              ),
                            ),
                          ),
                        ),
                        if (label != _roles.last.$2) const SizedBox(width: 8),
                      ],
                    ],
                  ),
                  gap,

                  _label('원 인증코드'),
                  _field(_authCode, '예: TAKEME123'),
                  gap,

                  _label(nameLabel),
                  _field(_name, nameHint),
                  if (_role == 'PARENT') ...[
                    gap,
                    _label('학부모 본인 이름'),
                    _field(_parentName, '학부모님의 이름을 입력해주세요 (예: 김철수)'),
                  ],
                  if (_isFamily) ...[
                    gap,
                    _label('원아 알레르기 정보 (선택사항)'),
                    _field(_allergies, '식품/약품 알레르기 (예: 땅콩, 복숭아, 유제품 등)'),
                  ],
                  gap,

                  // 이메일 인증
                  _label('로그인용 이메일'),
                  Row(
                    children: [
                      Expanded(
                        child: _field(_email, 'example@email.com',
                            type: TextInputType.emailAddress, enabled: !_emailVerified),
                      ),
                      const SizedBox(width: 8),
                      _smallButton(
                        _emailVerified ? '완료' : (_emailSent ? '재전송' : '인증'),
                        (_emailVerified || _busy) ? null : _sendEmail,
                      ),
                    ],
                  ),
                  if (_emailSent && !_emailVerified) ...[
                    const SizedBox(height: 12),
                    _label('인증코드 6자리'),
                    Row(
                      children: [
                        Expanded(child: _field(_code, '123456', type: TextInputType.number, maxLength: 6)),
                        const SizedBox(width: 8),
                        _smallButton('확인', _busy ? null : _verifyEmail, color: const Color(0xFF10B981)),
                      ],
                    ),
                  ],
                  gap,

                  _label('비밀번호'),
                  _field(_password, '영문, 숫자, 특수문자 포함 8자 이상', obscure: true),
                  const SizedBox(height: 32),

                  // 가입 버튼
                  Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: const [
                        BoxShadow(color: Color(0x332563EB), blurRadius: 8, offset: Offset(0, 4)),
                      ],
                    ),
                    child: ElevatedButton(
                      onPressed: _busy ? null : _register,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.blue600,
                        foregroundColor: Colors.white,
                        disabledBackgroundColor: AppColors.blue600.withValues(alpha: 0.6),
                        padding: const EdgeInsets.symmetric(vertical: 18),
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                          : const Text('가입 신청하기', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
