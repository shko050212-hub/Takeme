import 'package:flutter/material.dart';

import '../auth/auth_state.dart';
import '../theme.dart';
import 'register_screen.dart';

/// 로그인 화면 (기존 앱 index.tsx 와 같은 구성·색)
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  bool _needOtp = false;
  bool _busy = false;
  String? _message;
  bool _messageIsError = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _otp.dispose();
    super.dispose();
  }

  void _show(String msg, {bool error = false}) =>
      setState(() {
        _message = msg;
        _messageIsError = error;
      });

  Future<void> _login() async {
    if (_email.text.isEmpty || _password.text.isEmpty) {
      _show('이메일과 비밀번호를 입력해주세요.', error: true);
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final status = await AuthState.instance.login(
        _email.text,
        _password.text,
        otp: _needOtp ? _otp.text : null,
      );
      if (!mounted) return;
      switch (status) {
        case LoginStatus.ok:
          break; // main.dart 가 역할에 맞는 화면으로 바꿔줌
        case LoginStatus.otpRequired:
          setState(() => _needOtp = true);
          _show('Google OTP 앱의 6자리 코드를 입력해주세요.');
        case LoginStatus.otpSetup:
          _show('OTP 연동이 필요합니다. 관리자 웹에서 먼저 등록해주세요.');
        case LoginStatus.pending:
          _show('원장님의 승인을 기다리고 있습니다. 승인 후 다시 로그인해주세요.');
      }
    } catch (e) {
      if (mounted) _show(e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.slate600)),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 로고
                const Icon(Icons.directions_bus_rounded, size: 64, color: AppColors.blue600),
                const SizedBox(height: 8),
                const Text(
                  'takeme',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 36,
                    fontWeight: FontWeight.w900,
                    color: AppColors.blue600,
                    letterSpacing: -1,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  '스마트 셔틀 시스템',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, color: AppColors.slate500, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 48),

                _label('이메일'),
                TextField(
                  controller: _email,
                  enabled: !_busy,
                  keyboardType: TextInputType.emailAddress,
                  style: const TextStyle(fontSize: 16, color: AppColors.slate800),
                  decoration: const InputDecoration(hintText: 'example@email.com'),
                ),
                const SizedBox(height: 20),
                _label('비밀번호'),
                TextField(
                  controller: _password,
                  enabled: !_busy,
                  obscureText: true,
                  style: const TextStyle(fontSize: 16, color: AppColors.slate800),
                  decoration: const InputDecoration(hintText: '********'),
                ),
                if (_needOtp) ...[
                  const SizedBox(height: 20),
                  _label('OTP 인증번호'),
                  TextField(
                    controller: _otp,
                    enabled: !_busy,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 22, letterSpacing: 8),
                    decoration: const InputDecoration(hintText: '000000', counterText: ''),
                  ),
                ],
                if (_message != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _message!,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: _messageIsError ? AppColors.red600 : AppColors.blue600),
                  ),
                ],
                const SizedBox(height: 28),

                // 로그인 버튼 (파란색, 그림자)
                Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: const [
                      BoxShadow(color: Color(0x332563EB), blurRadius: 8, offset: Offset(0, 4)),
                    ],
                  ),
                  child: ElevatedButton(
                    onPressed: _busy ? null : _login,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.blue600,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: AppColors.blue600.withValues(alpha: 0.6),
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                          )
                        : Text(_needOtp ? '인증하기' : '로그인',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  ),
                ),

                // 또는
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Row(
                    children: [
                      Expanded(child: Divider(color: AppColors.slate200, thickness: 1)),
                      Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16),
                        child: Text('또는', style: TextStyle(color: AppColors.slate400, fontSize: 14)),
                      ),
                      Expanded(child: Divider(color: AppColors.slate200, thickness: 1)),
                    ],
                  ),
                ),

                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const RegisterScreen()),
                          ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    side: const BorderSide(color: AppColors.slate300),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('회원가입',
                      style: TextStyle(color: AppColors.slate600, fontSize: 16, fontWeight: FontWeight.w600)),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}