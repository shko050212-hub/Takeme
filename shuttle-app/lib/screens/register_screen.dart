import 'package:flutter/material.dart';
import '../services/api_service.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  String _selectedRole = 'TEACHER';
  final _authCodeController = TextEditingController();
  final _nameController = TextEditingController();
  final _parentNameController = TextEditingController();
  final _allergiesController = TextEditingController();
  final _emailController = TextEditingController();
  final _verifyCodeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _passwordConfirmController = TextEditingController();

  bool _isEmailSent = false;
  bool _isEmailVerified = false;
  bool _isLoading = false;

  @override
  void dispose() {
    _authCodeController.dispose();
    _nameController.dispose();
    _parentNameController.dispose();
    _allergiesController.dispose();
    _emailController.dispose();
    _verifyCodeController.dispose();
    _passwordController.dispose();
    _passwordConfirmController.dispose();
    super.dispose();
  }

  void _showMessage(String message, {bool isError = true}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red.shade700 : const Color(0xFF10B981),
      ),
    );
  }

  bool _validatePassword(String pw) {
    final regex = RegExp(r'^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$');
    return regex.hasMatch(pw);
  }

  Future<void> _handleSendVerification() async {
    final email = _emailController.text.trim();
    if (!email.contains('@')) {
      _showMessage('유효한 이메일을 입력해주세요.');
      return;
    }

    setState(() => _isLoading = true);
    final res = await ApiService().sendVerificationEmail(email);
    setState(() => _isLoading = false);

    if (res['success'] == true) {
      setState(() => _isEmailSent = true);
      _showMessage('인증 코드가 이메일로 전송되었습니다. 메일함을 확인해주세요.', isError: false);
    } else {
      _showMessage(res['message'] ?? '인증 메일 전송 실패');
    }
  }

  Future<void> _handleVerifyCode() async {
    final email = _emailController.text.trim();
    final code = _verifyCodeController.text.trim();
    if (code.isEmpty) {
      _showMessage('인증코드를 입력해주세요.');
      return;
    }

    setState(() => _isLoading = true);
    final res = await ApiService().verifyEmailCode(email, code);
    setState(() => _isLoading = false);

    if (res['success'] == true) {
      setState(() => _isEmailVerified = true);
      _showMessage('이메일 인증이 완료되었습니다.', isError: false);
    } else {
      _showMessage(res['message'] ?? '인증 코드가 올바르지 않습니다.');
    }
  }

  Future<void> _handleRegister() async {
    if (!_isEmailVerified) {
      _showMessage('먼저 이메일 인증을 완료해주세요.');
      return;
    }
    if (_authCodeController.text.trim().isEmpty) {
      _showMessage('원 인증코드를 입력해주세요.');
      return;
    }
    if (_nameController.text.trim().isEmpty) {
      _showMessage(_selectedRole == 'PARENT' ? '원아 이름을 입력해주세요.' : (_selectedRole == 'TEACHER' ? '지도 교사 이름을 입력해주세요.' : '기사님 이름을 입력해주세요.'));
      return;
    }
    if (_selectedRole == 'PARENT' && _parentNameController.text.trim().isEmpty) {
      _showMessage('학부모 본인 이름을 입력해주세요.');
      return;
    }
    final pw = _passwordController.text;
    if (!_validatePassword(pw)) {
      _showMessage('비밀번호는 영문, 숫자, 특수문자를 모두 포함하여 8자 이상이어야 합니다.');
      return;
    }
    if (pw != _passwordConfirmController.text) {
      _showMessage('비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setState(() => _isLoading = true);

    final payloadName = _selectedRole == 'PARENT' ? _parentNameController.text.trim() : _nameController.text.trim();
    final res = await ApiService().register(
      email: _emailController.text.trim(),
      password: pw,
      name: payloadName,
      targetName: _nameController.text.trim(),
      authCode: _authCodeController.text.trim(),
      role: _selectedRole,
      allergies: _selectedRole == 'PARENT' ? _allergiesController.text.trim() : null,
    );

    setState(() => _isLoading = false);

    if (res['success'] == true) {
      if (!mounted) return;
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('회원가입 완료', style: TextStyle(fontWeight: FontWeight.bold)),
          content: Text(res['message'] ?? '회원가입이 정상적으로 완료되었습니다.'),
          actions: [
            ElevatedButton(
              onPressed: () {
                Navigator.pop(ctx);
                Navigator.pop(context);
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
              child: const Text('로그인으로 이동', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      );
    } else {
      _showMessage(res['message'] ?? '회원가입에 실패했습니다.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('회원가입', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: Color(0xFF1E293B))),
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
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Info Card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFF6FF),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFBFDBFE)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Text(
                          '원 인증코드가 필요합니다',
                          style: TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF1E40AF), fontSize: 15),
                        ),
                        SizedBox(height: 4),
                        Text(
                          '안전한 통학 관리를 위해 원장선생님이 발급하신 원 인증코드를 입력해야 가입이 진행됩니다.',
                          style: TextStyle(fontSize: 12, color: Color(0xFF3B82F6), height: 1.4),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Role Selection
                  const Text('가입 역할 선택', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      
                      _buildRoleButton('TEACHER', '지도교사'),
                      const SizedBox(width: 8),
                      _buildRoleButton('PARENT', '학부모'),
                      const SizedBox(width: 8),
                      _buildRoleButton('DRIVER', '기사님'),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Auth Code
                  const Text('원 인증코드', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                  const SizedBox(height: 6),
                  _buildTextField(_authCodeController, '예: TAKEME123'),
                  const SizedBox(height: 16),

                  // Student Name
                  Text(
                    _selectedRole == 'PARENT' ? '원아 이름' : (_selectedRole == 'TEACHER' ? '지도 교사 이름' : '기사님 이름'),
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155)),
                  ),
                  const SizedBox(height: 6),
                  _buildTextField(
                    _nameController,
                    _selectedRole == 'PARENT' ? '원아 이름 (예: 홍길동)' : (_selectedRole == 'TEACHER' ? '지도교사 성명 (예: 김선생)' : '기사님 성명 (예: 박기사)'),
                  ),
                  const SizedBox(height: 16),

                  // Parent Name (if parent)
                  if (_selectedRole == 'PARENT') ...[
                    const Text('학부모 본인 이름', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                    const SizedBox(height: 6),
                    _buildTextField(_parentNameController, '학부모님의 성명을 입력해주세요 (예: 김철수)'),
                    const SizedBox(height: 16),

                    // Allergy Input
                    const Text('원아 알레르기 정보 (선택사항)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                    const SizedBox(height: 6),
                    _buildTextField(_allergiesController, '식품/약품 알레르기 (예: 땅콩, 복숭아, 유제품 등)'),
                    const SizedBox(height: 16),
                  ],

                  // Email Input with Verification
                  const Text('로그인 이메일', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: _buildTextField(
                          _emailController,
                          'example@email.com',
                          enabled: !_isEmailVerified,
                          keyboardType: TextInputType.emailAddress,
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: _isEmailVerified || _isLoading ? null : _handleSendVerification,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          elevation: 0,
                        ),
                        child: Text(
                          _isEmailSent ? '재전송' : '인증요청',
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Verification Code
                  if (_isEmailSent && !_isEmailVerified) ...[
                    const Text('이메일 인증코드', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: _buildTextField(_verifyCodeController, '인증코드 6자리 입력', keyboardType: TextInputType.number),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: _isLoading ? null : _handleVerifyCode,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF10B981),
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            elevation: 0,
                          ),
                          child: const Text('인증확인', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                  ],

                  if (_isEmailVerified)
                    Container(
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFECFDF5),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFA7F3D0)),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.check_circle, size: 16, color: Color(0xFF10B981)),
                          SizedBox(width: 6),
                          Text('이메일 인증이 완료되었습니다.', style: TextStyle(color: Color(0xFF065F46), fontSize: 12, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),

                  // Password
                  const Text('비밀번호', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                  const SizedBox(height: 6),
                  _buildTextField(_passwordController, '영문, 숫자, 특수문자 포함 8자 이상', obscureText: true),
                  const SizedBox(height: 16),

                  // Password Confirm
                  const Text('비밀번호 확인', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                  const SizedBox(height: 6),
                  _buildTextField(_passwordConfirmController, '비밀번호를 한 번 더 입력하세요', obscureText: true),
                  const SizedBox(height: 28),

                  // Register Button
                  ElevatedButton(
                    onPressed: _isLoading ? null : _handleRegister,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      disabledBackgroundColor: const Color(0xFF93C5FD),
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                    child: _isLoading
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                          )
                        : const Text('회원가입 완료', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white)),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRoleButton(String role, String label) {
    final isSelected = _selectedRole == role;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedRole = role),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF2563EB) : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isSelected ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0)),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: isSelected ? Colors.white : const Color(0xFF64748B),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTextField(
    TextEditingController controller,
    String hint, {
    bool obscureText = false,
    bool enabled = true,
    TextInputType? keyboardType,
  }) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      enabled: enabled,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
        filled: true,
        fillColor: enabled ? Colors.white : const Color(0xFFF1F5F9),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF2563EB), width: 1.5),
        ),
      ),
    );
  }
}
