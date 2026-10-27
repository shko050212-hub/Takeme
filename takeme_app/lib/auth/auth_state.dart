import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';

class AppUser {
  final int id;
  final String email;
  final String role; // DRIVER, TEACHER, PARENT, STUDENT, ACADEMY_ADMIN ...
  final String name;
  final String? academyName;

  AppUser({
    required this.id,
    required this.email,
    required this.role,
    required this.name,
    this.academyName,
  });

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: (j['id'] as num).toInt(),
        email: j['email']?.toString() ?? '',
        role: j['role']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        academyName: j['academyName']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'role': role,
        'name': name,
        'academyName': academyName,
      };

  bool get isStaff => role == 'DRIVER' || role == 'TEACHER';
  bool get isFamily => role == 'PARENT' || role == 'STUDENT';

  String get roleLabel => const {
        'DRIVER': '기사',
        'TEACHER': '지도교사',
        'PARENT': '학부모',
        'STUDENT': '원아',
      }[role] ??
      role;
}

enum LoginStatus { ok, otpRequired, otpSetup, pending }

/// 로그인 상태 (앱 전체에서 하나만 사용)
class AuthState extends ChangeNotifier {
  AuthState._();
  static final AuthState instance = AuthState._();

  static const _storage = FlutterSecureStorage();
  static const _userKey = 'takeme_user';

  AppUser? user;

  /// 앱 시작 시 저장된 로그인 정보 복원 (앱을 껐다 켜도 로그인 유지)
  Future<void> restore() async {
    final token = await ApiClient.instance.loadToken();
    final saved = await _storage.read(key: _userKey);
    if (token != null && saved != null) {
      user = AppUser.fromJson(jsonDecode(saved) as Map<String, dynamic>);
    }
    notifyListeners();
  }

  Future<LoginStatus> login(String email, String password, {String? otp}) async {
    final data = await ApiClient.instance.post('/auth/login', {
      'email': email.trim(),
      'password': password,
      if (otp != null && otp.isNotEmpty) 'otpToken': otp,
    }) as Map<String, dynamic>;

    if (data['requireOtpSetup'] == true) return LoginStatus.otpSetup;
    if (data['requireOtp'] == true) return LoginStatus.otpRequired;
    if (data['requireApproval'] == true) return LoginStatus.pending;

    final token = data['accessToken'];
    final u = data['user'];
    if (token is! String || u is! Map<String, dynamic>) {
      throw ApiException(
          data['message']?.toString() ?? '로그인 응답이 올바르지 않습니다.');
    }
    await ApiClient.instance.saveToken(token);
    user = AppUser.fromJson(u);
    await _storage.write(key: _userKey, value: jsonEncode(user!.toJson()));
    notifyListeners();
    return LoginStatus.ok;
  }

  Future<void> logout() async {
    await ApiClient.instance.saveToken(null);
    await _storage.delete(key: _userKey);
    user = null;
    notifyListeners();
  }
}
