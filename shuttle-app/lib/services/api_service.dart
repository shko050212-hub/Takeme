import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../models/user_model.dart';
import '../models/student_model.dart';
import '../models/notification_model.dart';
import '../models/route_model.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String? _accessToken;
  String? _refreshToken;
  UserModel? _currentUser;

  String? get token => _accessToken;
  String? get refreshToken => _refreshToken;
  UserModel? get currentUser => _currentUser;
  bool get isLoggedIn => _accessToken != null && _accessToken!.isNotEmpty;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString('takeme_token');
    _refreshToken = prefs.getString('takeme_refresh_token');
    final userJson = prefs.getString('takeme_user');
    if (userJson != null) {
      try {
        _currentUser = UserModel.fromJson(jsonDecode(userJson), token: _accessToken);
      } catch (_) {}
    }
  }

  Future<void> setAuth(String? token, UserModel? user, {String? refreshToken}) async {
    _accessToken = token;
    _currentUser = user;
    if (refreshToken != null) {
      _refreshToken = refreshToken;
    }
    final prefs = await SharedPreferences.getInstance();
    if (token != null) {
      await prefs.setString('takeme_token', token);
    } else {
      await prefs.remove('takeme_token');
    }
    if (refreshToken != null) {
      await prefs.setString('takeme_refresh_token', refreshToken);
    } else if (token == null) {
      _refreshToken = null;
      await prefs.remove('takeme_refresh_token');
    }
    if (user != null) {
      await prefs.setString('takeme_user', jsonEncode(user.toJson()));
    } else {
      await prefs.remove('takeme_user');
    }
  }

  Future<void> logout() async {
    await setAuth(null, null);
  }

  Future<bool> tryRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    final rToken = prefs.getString('takeme_refresh_token') ?? _refreshToken;
    if (rToken == null || rToken.isEmpty) return false;

    try {
      final url = Uri.parse('${AppConfig.apiHost}/auth/refresh');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': rToken}),
      );
      if (res.statusCode == 200 || res.statusCode == 201) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        final newAccessToken = data['accessToken'] as String?;
        final newRefreshToken = data['refreshToken'] as String?;
        if (newAccessToken != null) {
          _accessToken = newAccessToken;
          await prefs.setString('takeme_token', newAccessToken);
          if (newRefreshToken != null) {
            _refreshToken = newRefreshToken;
            await prefs.setString('takeme_refresh_token', newRefreshToken);
          }
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  Map<String, String> _headers([Map<String, String>? extra]) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_accessToken != null && _accessToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_accessToken';
    }
    if (extra != null) {
      headers.addAll(extra);
    }
    return headers;
  }

  // ----------------------------------------------------
  // AUTH
  // ----------------------------------------------------
  Future<Map<String, dynamic>> login(String email, String password, {String? otpToken}) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/login');
    final body = {
      'email': email.trim(),
      'password': password,
    };
    if (otpToken != null && otpToken.isNotEmpty) {
      body['otpToken'] = otpToken.trim();
    }

    final res = await http.post(url, headers: _headers(), body: jsonEncode(body));
    final data = jsonDecode(utf8.decode(res.bodyBytes));

    if (res.statusCode == 200 || res.statusCode == 201) {
      if (data['accessToken'] != null && data['user'] != null) {
        final user = UserModel.fromJson(data['user'], token: data['accessToken']);
        await setAuth(data['accessToken'], user, refreshToken: data['refreshToken']);
      }
      return {'success': true, 'data': data};
    } else {
      return {'success': false, 'message': data['message'] ?? '로그인에 실패했습니다.', 'data': data};
    }
  }

  Future<Map<String, dynamic>> sendVerificationEmail(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/email/send');
    final res = await http.post(url, headers: _headers(), body: jsonEncode({'email': email.trim()}));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'data': data, 'message': data['message']};
  }

  Future<Map<String, dynamic>> verifyEmailCode(String email, String code) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/email/verify');
    final res = await http.post(url, headers: _headers(), body: jsonEncode({'email': email.trim(), 'code': code.trim()}));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String name,
    required String targetName,
    required String authCode,
    required String role,
    String? allergies,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/register');
    final body = <String, dynamic>{
      'email': email.trim(),
      'password': password,
      'name': name.trim(),
      'targetName': targetName.trim(),
      'authCode': authCode.trim(),
      'role': role,
    };
    if (allergies != null && allergies.trim().isNotEmpty) {
      body['allergies'] = allergies.trim();
    }

    final res = await http.post(url, headers: _headers(), body: jsonEncode(body));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {
      'success': res.statusCode == 200 || res.statusCode == 201,
      'message': data['message'] ?? '회원가입 요청 처리 완료',
      'data': data,
    };
  }

  Future<Map<String, dynamic>> deleteAccount(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/account?email=${Uri.encodeComponent(email)}');
    final res = await http.delete(url, headers: _headers());
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode == 200) {
      await logout();
      return {'success': true, 'message': data['message']};
    }
    return {'success': false, 'message': data['message'] ?? '탈퇴 처리에 실패했습니다.'};
  }

  // ----------------------------------------------------
  // PARENT & STUDENT
  // ----------------------------------------------------
  Future<List<NotificationModel>> getNotifications(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/notifications?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
      return list.map((item) => NotificationModel.fromJson(item as Map<String, dynamic>)).toList();
    }
    return [];
  }

  Future<RouteDataModel?> getParentRoute(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/route?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      return RouteDataModel.fromJson(data);
    }
    return null;
  }

  Future<StudentModel?> getMyChild(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/my-child?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      if (data != null && data is Map<String, dynamic>) {
        return StudentModel.fromJson(data);
      }
    }
    return null;
  }

  Future<Map<String, dynamic>> updateChildAllergies(String email, String allergies) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/my-child/allergies');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({'email': email, 'allergies': allergies.trim()}),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> createOverride({
    required String email,
    required String targetDate,
    required String overrideType,
    required String reason,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/override');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'email': email,
        'targetDate': targetDate,
        'overrideType': overrideType,
        'reason': reason,
      }),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> createParentMessage({
    required String email,
    required List<String> targetRoles,
    required String message,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/message');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'email': email,
        'targetRoles': targetRoles,
        'message': message,
      }),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>?> getTodaySchedule(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/today-schedule?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>?;
    }
    return null;
  }

  Future<Map<String, dynamic>> studentBoardByQR(String studentEmail, String teacherEmail) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/student-board');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'studentEmail': studentEmail,
        'teacherEmail': teacherEmail,
      }),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  // ----------------------------------------------------
  // TEACHER & DRIVER
  // ----------------------------------------------------
  Future<List<StudentModel>> getTeacherStudents(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/students?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
      return list.map((item) => StudentModel.fromJson(item as Map<String, dynamic>)).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>?> getTeacherVehicle(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/my-vehicle?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>?;
    }
    return null;
  }

  Future<RouteDataModel?> getTeacherRoute(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/route?email=${Uri.encodeComponent(email)}');
    final res = await http.get(url, headers: _headers());
    if (res.statusCode == 200) {
      final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      return RouteDataModel.fromJson(data);
    }
    return null;
  }

  Future<Map<String, dynamic>> manualBoardStudent(String email, int studentId, String reason) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/board-student');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'email': email,
        'studentId': studentId,
        'reason': reason,
      }),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> skipStudent(String email, int studentId) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/skip-student');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'email': email,
        'studentId': studentId,
      }),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> saveTeacherMemo(int studentId, String memo) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/student/$studentId/memo');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({'memo': memo}),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> broadcastMessage(
    String email, {
    required List<int> studentIds,
    required List<String> targetRoles,
    required String message,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/message');
    final res = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'email': email,
        'studentIds': studentIds,
        'targetRoles': targetRoles,
        'message': message,
      }),
    );
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }
}
