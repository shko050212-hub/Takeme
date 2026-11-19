import 'dart:typed_data';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../models/user_model.dart';
import '../models/student_model.dart';
import '../models/notification_model.dart';
import '../models/route_model.dart';

/// 서버가 응답은 했지만 처리하지 못한 경우(5xx) 등, 사용자에게 보여줄 수 있는 오류
class ApiException implements Exception {
  final int? statusCode;
  final String message;
  ApiException(this.message, [this.statusCode]);

  @override
  String toString() => message;
}

/// 예외를 사용자가 이해할 수 있는 한 줄 안내로 바꾼다 (기술적인 오류 문구를 그대로 보여주지 않는다)
String friendlyError(Object e) {
  // 화면에는 쉬운 문구만 보여주므로, 원인 확인용으로 실제 오류를 개발 로그에 남긴다
  debugPrint('[friendlyError] ${e.runtimeType}: $e');
  if (e is ApiException) return e.message;
  final t = e.toString();
  if (t.contains('SocketException') ||
      t.contains('ClientException') ||
      t.contains('TimeoutException') ||
      t.contains('HandshakeException') ||
      t.contains('Failed host lookup')) {
    return '인터넷 연결을 확인해 주세요.';
  }
  return '잠시 후 다시 시도해 주세요.';
}

/// 5xx(서버 오류)는 "데이터 없음"과 구분되도록 예외로 알린다. 4xx 는 호출한 쪽이 데이터 없음 등으로 판단한다.
void throwIfServerError(http.Response res) {
  if (res.statusCode >= 500) {
    throw ApiException('서버에 문제가 있어 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', res.statusCode);
  }
}

/// 예전 기관 공지사항 방("공지사항"/"실시간 알림 채널")은 보여주지 않는다.
/// 기관 전체 소식도 TakeMe 알림(개인 알림방)으로 오므로 같은 역할의 방이 둘일 필요가 없다.
/// (서버도 더 이상 이 방을 내려주지 않지만, 서버 배포 전에도 앱에서 바로 숨긴다)
bool isOldNoticeRoom(Map<String, dynamic> r) {
  final type = r['type']?.toString();
  final name = r['name']?.toString() ?? '';
  return type == 'NOTIFICATION_SYSTEM' && name != 'TakeMe 알림';
}

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

  Future<http.Response> getWithAuth(Uri url, [Map<String, String>? extra]) async {
    var res = await http.get(url, headers: _headers(extra));
    if (res.statusCode == 401 && _refreshToken != null) {
      final refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await http.get(url, headers: _headers(extra));
      } else {
        await logout();
      }
    }
    return res;
  }

  Future<http.Response> postWithAuth(Uri url, dynamic body, [Map<String, String>? extra]) async {
    final encoded = body is String ? body : jsonEncode(body);
    var res = await http.post(url, headers: _headers(extra), body: encoded);
    if (res.statusCode == 401 && _refreshToken != null) {
      final refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await http.post(url, headers: _headers(extra), body: encoded);
      } else {
        await logout();
      }
    }
    return res;
  }

  Future<http.Response> deleteWithAuth(Uri url, [Map<String, String>? extra]) async {
    var res = await http.delete(url, headers: _headers(extra));
    if (res.statusCode == 401 && _refreshToken != null) {
      final refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await http.delete(url, headers: _headers(extra));
      } else {
        await logout();
      }
    }
    return res;
  }

  // ----------------------------------------------------
  // AUTH
  // ----------------------------------------------------
  Future<Map<String, dynamic>> login(String email, String password, {String? otpToken, String? clientType = 'app'}) async {
    final body = {
      'email': email.trim(),
      'password': password,
      'clientType': clientType ?? 'app',
    };
    if (otpToken != null && otpToken.isNotEmpty) {
      body['otpToken'] = otpToken.trim();
    }
    final encodedBody = jsonEncode(body);
    final headers = {'Content-Type': 'application/json'};

    http.Response? res;
    dynamic lastError;

    // 1차 시도 (기본 apiHost: https://52.63.245.203.sslip.io 또는 kIsWeb origin)
    try {
      final url = Uri.parse('${AppConfig.apiHost}/auth/login');
      res = await http.post(url, headers: headers, body: encodedBody).timeout(const Duration(seconds: 7));
    } catch (e) {
      lastError = e;
      debugPrint('[ApiService] Primary host (${AppConfig.apiHost}) failed: $e');
    }

    // 1차 실패 또는 5xx 시 암호화되지 않은 대체 주소(http)로 재시도 -> 로그인 정보가 평문으로 가므로 개발(디버그)일 때만 허용
    if (AppConfig.canUseHttpFallback && (res == null || res.statusCode >= 500)) {
      try {
        final fallbackUrl = Uri.parse('${AppConfig.fallbackApiHost}/auth/login');
        debugPrint('[ApiService] Attempting fallback host: $fallbackUrl');
        final fallbackRes = await http.post(fallbackUrl, headers: headers, body: encodedBody).timeout(const Duration(seconds: 7));
        if (fallbackRes.statusCode < 500) {
          res = fallbackRes;
          AppConfig.useFallback();
          debugPrint('[ApiService] Fallback successful! Active host switched to: ${AppConfig.apiHost}');
        }
      } catch (e) {
        lastError ??= e;
        debugPrint('[ApiService] Fallback host failed: $e');
      }
    }

    if (res == null) {
      debugPrint('[ApiService] 서버 연결 실패: $lastError');
      throw Exception('서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.');
    }

    final data = jsonDecode(utf8.decode(res.bodyBytes));

    if (data['isWebAccount'] == true) {
      return {'success': false, 'isWebAccount': true, 'message': data['message'] ?? '본 계정은 웹기반 계정입니다.', 'data': data};
    }

    if (res.statusCode == 200 || res.statusCode == 201) {
      if (data['user'] != null && (data['user']['role'] == 'ACADEMY_ADMIN' || data['user']['role'] == 'SUPER_ADMIN')) {
        return {'success': false, 'isWebAccount': true, 'message': '본 계정은 웹기반 계정입니다.', 'data': data};
      }
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

  Future<Map<String, dynamic>> sendSelfUnlockCode(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/self-unlock/send');
    final res = await http.post(url, headers: _headers(), body: jsonEncode({'email': email.trim()}));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> verifySelfUnlockCode(String email, String code) async {
    final url = Uri.parse('${AppConfig.apiHost}/auth/self-unlock/verify');
    final res = await http.post(url, headers: _headers(), body: jsonEncode({'email': email.trim(), 'code': code.trim()}));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
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
    String? assignedClass,
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
    if (assignedClass != null && assignedClass.trim().isNotEmpty) {
      body['assignedClass'] = assignedClass.trim();
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
    final res = await getWithAuth(url);
    throwIfServerError(res);
    if (res.statusCode == 200) {
      final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
      return list.map((item) => NotificationModel.fromJson(item as Map<String, dynamic>)).toList();
    }
    return [];
  }

  /// 메신저 전체 안 읽은 메시지 수 (TakeMe 알림 포함)
  Future<int> getChatTotalUnreadCount() async {
    try {
      final email = currentUser?.email;
      if (email == null) return 0;
      final rooms = await getChatRooms(email);
      var sum = 0;
      for (final r in rooms) {
        final type = r['type']?.toString();
        if (type == 'PAYMENT_SYSTEM') continue;
        sum += (r['unreadCount'] as num?)?.toInt() ?? 0;
      }
      return sum;
    } catch (_) {
      return 0;
    }
  }

  Future<int> getUnreadNotificationCount(String email) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/notifications/unread-count?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url);
      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        return (data['count'] as num?)?.toInt() ?? 0;
      }
    } catch (_) {}
    return 0;
  }

  Future<bool> readNotification({required String email, int? messageId, String? notificationKey}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/read-message');
      final body = <String, dynamic>{'email': email};
      if (messageId != null) body['messageId'] = messageId;
      if (notificationKey != null) body['notificationKey'] = notificationKey;
      final res = await postWithAuth(url, jsonEncode(body));
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  Future<bool> markAllNotificationsRead(String email) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/notifications/read-all');
      final res = await postWithAuth(url, jsonEncode({'email': email}));
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, bool>> getNotificationSettings() async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/notification-settings');
      final res = await getWithAuth(url);
      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        return {
          'notifyShuttleOperation': data['notifyShuttleOperation'] != false,
          'notifyBoardPost': data['notifyBoardPost'] != false,
        };
      }
    } catch (_) {}
    return {
      'notifyShuttleOperation': true,
      'notifyBoardPost': true,
    };
  }

  Future<bool> updateNotificationSettings({bool? notifyShuttleOperation, bool? notifyBoardPost}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/notification-settings');
      final body = <String, dynamic>{};
      if (notifyShuttleOperation != null) body['notifyShuttleOperation'] = notifyShuttleOperation;
      if (notifyBoardPost != null) body['notifyBoardPost'] = notifyBoardPost;
      final res = await postWithAuth(url, body);
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  Future<List<Map<String, dynamic>>> getClassBoardPosts(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/class-board?email=${Uri.encodeComponent(email)}');
    final res = await getWithAuth(url);
    throwIfServerError(res);
    if (res.statusCode == 200) {
      final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
      return list.map((e) => e as Map<String, dynamic>).toList();
    }
    return [];
  }

  Future<RouteDataModel?> getParentRoute(String email, {int? studentId, String? direction, bool throwOnError = false}) async {
    try {
      String urlStr = '${AppConfig.apiHost}/parent/route?email=${Uri.encodeComponent(email)}';
      if (studentId != null) urlStr += '&studentId=$studentId';
      if (direction != null) urlStr += '&direction=$direction';
      final url = Uri.parse(urlStr);
      final res = await getWithAuth(url).timeout(const Duration(seconds: 6));
      if (throwOnError) throwIfServerError(res);
      if (res.statusCode == 200) {
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is Map<String, dynamic>) {
          return RouteDataModel.fromJson(decoded);
        }
      }
    } catch (e) {
      if (throwOnError) rethrow;
      debugPrint('[ApiService] getParentRoute error: $e');
    }
    return null;
  }

  /// 내 아이 차량의 실제 도로 경로(기사 앱이 올린 길찾기 경로)와 진행 위치.
  /// 기사 앱이 아직 경로를 만들지 않았으면 path 가 비어 있다.
  Future<Map<String, dynamic>?> getParentRoutePath() async {
    try {
      final res = await getWithAuth(Uri.parse('${AppConfig.apiHost}/parent/route-path'))
          .timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is Map<String, dynamic>) return decoded;
      }
    } catch (e) {
      debugPrint('[ApiService] getParentRoutePath error: $e');
    }
    return null;
  }

  Future<StudentModel?> getMyChild(String email, {bool throwOnError = false}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/my-child?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url).timeout(const Duration(seconds: 6));
      if (throwOnError) throwIfServerError(res);
      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        if (data != null && data is Map<String, dynamic>) {
          return StudentModel.fromJson(data);
        }
      }
    } catch (e) {
      if (throwOnError) rethrow;
      debugPrint('[ApiService] getMyChild error: $e');
    }
    return null;
  }

  Future<List<StudentModel>> getMyChildren(String email, {bool throwOnError = false}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/my-children?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url);
      if (throwOnError) throwIfServerError(res);
      if (res.statusCode == 200) {
        final list = jsonDecode(utf8.decode(res.bodyBytes));
        if (list is List) {
          return list.map((e) => StudentModel.fromJson(e as Map<String, dynamic>)).toList();
        }
      }
    } catch (_) {
      if (throwOnError) rethrow;
    }
    final single = await getMyChild(email, throwOnError: throwOnError);
    return single != null ? [single] : [];
  }

  Future<Map<String, dynamic>> createChangeRequest({
    required int studentId,
    required String type,
    required String targetDate,
    String? direction,
    String? targetTime,
    String? targetAddress,
    String? reason,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/approval/request');
    final payload = {
      'studentId': studentId,
      'type': type,
      'targetDate': targetDate,
      if (direction != null) 'direction': direction,
      if (targetTime != null && targetTime.isNotEmpty) 'targetTime': targetTime,
      if (targetAddress != null && targetAddress.isNotEmpty) 'newAddress': targetAddress,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    };
    final res = await postWithAuth(url, jsonEncode(payload));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {
      'success': res.statusCode == 200 || res.statusCode == 201,
      'message': data['message'] ?? (res.statusCode == 200 || res.statusCode == 201 ? '신청이 접수되었습니다.' : '신청 처리에 실패했습니다.'),
      'data': data,
    };
  }

  Future<List<Map<String, dynamic>>> getMyChangeRequests() async {
    final url = Uri.parse('${AppConfig.apiHost}/approval/my');
    final res = await getWithAuth(url);
    throwIfServerError(res);
    if (res.statusCode == 200) {
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      if (data is List) {
        return data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
    }
    return [];
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

  Future<Map<String, dynamic>?> getParentProfile() async {
    final email = currentUser?.email;
    if (email == null) return null;
    final url = Uri.parse('${AppConfig.apiHost}/parent/profile?email=${Uri.encodeComponent(email)}');
    final res = await getWithAuth(url);
    if (res.statusCode == 200) {
      return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    }
    return null;
  }

  Future<Map<String, dynamic>> updateParentPhone(String phone) async {
    final email = currentUser?.email;
    if (email == null) return {'success': false, 'message': '로그인이 필요합니다.'};
    final url = Uri.parse('${AppConfig.apiHost}/parent/update-phone');
    final res = await postWithAuth(url, jsonEncode({'email': email, 'phone': phone.trim()}));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message'] ?? '전화번호가 저장되었습니다.'};
  }

  /// 내 아이들의 원아·보호자 정보와 빠진 필수 칸(missing). 실패하면 예외
  Future<List<Map<String, dynamic>>> getChildInfoList() async {
    final res = await getWithAuth(Uri.parse('${AppConfig.apiHost}/parent/child-info'))
        .timeout(const Duration(seconds: 8));
    throwIfServerError(res);
    if (res.statusCode != 200) {
      throw ApiException('원아 정보를 불러오지 못했습니다. (${res.statusCode})', res.statusCode);
    }
    if (res.bodyBytes.isEmpty) return [];
    final decoded = jsonDecode(utf8.decode(res.bodyBytes));
    if (decoded is List) return decoded.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    if (decoded is Map) return [Map<String, dynamic>.from(decoded)];
    return [];
  }

  /// 원아·보호자 정보 저장. 성공하면 저장된 정보(missing 포함), 실패하면 message
  Future<Map<String, dynamic>> saveChildInfo(Map<String, dynamic> body) async {
    try {
      final res = await postWithAuth(Uri.parse('${AppConfig.apiHost}/parent/child-info'), jsonEncode(body));
      final data = res.bodyBytes.isEmpty ? <String, dynamic>{} : jsonDecode(utf8.decode(res.bodyBytes));
      final ok = res.statusCode == 200 || res.statusCode == 201;
      final map = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      final msg = map['message'];
      return {...map, 'success': ok, 'message': msg is List ? msg.join(', ') : msg};
    } catch (e) {
      return {'success': false, 'message': friendlyError(e)};
    }
  }

  Future<Map<String, dynamic>> changeParentPassword(String currentPassword, String newPassword) async {
    final email = currentUser?.email;
    if (email == null) return {'success': false, 'message': '로그인이 필요합니다.'};
    final url = Uri.parse('${AppConfig.apiHost}/parent/change-password');
    final res = await postWithAuth(url, jsonEncode({
      'email': email,
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message'] ?? '비밀번호가 변경되었습니다.'};
  }

  Future<Map<String, dynamic>> createOverride({
    required String email,
    required String targetDate,
    required String overrideType,
    required String reason,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/override');
    final res = await postWithAuth(url, jsonEncode({
        'email': email,
        'targetDate': targetDate,
        'overrideType': overrideType,
        'reason': reason,
      }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> createParentMessage({
    required String email,
    required List<String> targetRoles,
    required String message,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/parent/message');
    final res = await postWithAuth(url, jsonEncode({
        'email': email,
        'targetRoles': targetRoles,
        'message': message,
      }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>?> getTodaySchedule(String email, {bool throwOnError = false}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/parent/today-schedule?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url).timeout(const Duration(seconds: 6));
      if (throwOnError) throwIfServerError(res);
      // 오늘 일정이 없으면 서버가 빈 응답(null)을 보낸다. 오류가 아니라 "일정 없음"이다.
      if (res.statusCode == 200 && res.bodyBytes.isEmpty) return null;
      if (res.statusCode == 200) {
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is Map<String, dynamic>) {
          return decoded;
        }
      }
    } catch (e) {
      if (throwOnError) rethrow;
      debugPrint('[ApiService] getTodaySchedule error: $e');
    }
    return null;
  }

  Future<Map<String, dynamic>> studentBoardByQR(String studentEmail, String teacherEmail) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/student-board');
    final res = await postWithAuth(url, jsonEncode({
        'studentEmail': studentEmail,
        'teacherEmail': teacherEmail,
      }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  // ----------------------------------------------------
  // TEACHER & DRIVER
  // ----------------------------------------------------
  Future<List<StudentModel>> getTeacherStudents(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/students?email=${Uri.encodeComponent(email)}');
    final res = await getWithAuth(url);
    if (res.statusCode == 200) {
      final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
      return list.map((item) => StudentModel.fromJson(item as Map<String, dynamic>)).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>?> getTeacherVehicle(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/my-vehicle?email=${Uri.encodeComponent(email)}');
    final res = await getWithAuth(url);
    if (res.statusCode == 200) {
      return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>?;
    }
    return null;
  }

  Future<RouteDataModel?> getTeacherRoute(String email) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/route?email=${Uri.encodeComponent(email)}');
    final res = await getWithAuth(url);
    if (res.statusCode == 200) {
      final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      return RouteDataModel.fromJson(data);
    }
    return null;
  }

  Future<Map<String, dynamic>> manualBoardStudent(String email, int studentId, String reason) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/board');
    final res = await postWithAuth(url, jsonEncode({
        'email': email,
        'studentId': studentId,
        'reason': reason,
      }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> skipStudent(String email, int studentId) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/skip-student');
    final res = await postWithAuth(url, jsonEncode({
        'email': email,
        'studentId': studentId,
      }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> saveTeacherMemo(int studentId, String memo) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/student/$studentId/memo');
    final res = await postWithAuth(url, jsonEncode({'memo': memo}));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  Future<Map<String, dynamic>> broadcastMessage(
    String email, {
    required List<int> studentIds,
    required List<String> targetRoles,
    required String message,
  }) async {
    final url = Uri.parse('${AppConfig.apiHost}/teacher/send-message');
    final res = await postWithAuth(url, jsonEncode({
        'email': email,
        'studentIds': studentIds,
        'parentIds': studentIds,
        'targetRoles': targetRoles,
        'message': message,
      }));
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    return {'success': res.statusCode == 200 || res.statusCode == 201, 'message': data['message']};
  }

  // ==================== BOARD APIs ====================
  Future<List<Map<String, dynamic>>> getBoardPosts({int? academyId, String? search}) async {
    try {
      final qp = <String, String>{};
      if (academyId != null) qp['academyId'] = academyId.toString();
      if (search != null && search.isNotEmpty) qp['search'] = search;
      final uri = Uri.parse('${AppConfig.apiHost}/routing/board/posts').replace(queryParameters: qp.isEmpty ? null : qp);
      final res = await getWithAuth(uri);
      if (res.statusCode == 200) {
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is List) {
          return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        }
      }
    } catch (_) {}
    return [];
  }

  Future<Map<String, dynamic>> uploadBoardImage({
    required Uint8List bytes,
    required String filename,
    required String mimeType,
  }) async {
    try {
      final base64Data = 'data:$mimeType;base64,${base64Encode(bytes)}';
      final url = Uri.parse('${AppConfig.apiHost}/routing/board/upload');
      final res = await postWithAuth(url, jsonEncode({
        'base64Data': base64Data,
        'filename': filename,
        'mimeType': mimeType,
      }));
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': res.statusCode == 200 || res.statusCode == 201,
        'url': data['url'],
        'filename': data['filename'],
        'message': data['message'],
      };
    } catch (e) {
      return {'success': false, 'message': '이미지 업로드에 실패했습니다.'};
    }
  }

  Future<Map<String, dynamic>> createBoardPost({
    required String title,
    required String content,
    String visibility = 'ALL',
    String? targetClass,
    String? imageUrl,
    List<String>? images,
    required String authorName,
    String authorRole = 'TEACHER',
    int? academyId,
  }) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/routing/board/posts');
      final res = await postWithAuth(url, jsonEncode({
        'title': title,
        'content': content,
        'visibility': visibility,
        'targetClass': targetClass,
        'imageUrl': imageUrl,
        'images': images ?? (imageUrl != null ? [imageUrl] : []),
        'authorName': authorName,
        'authorRole': authorRole,
        'academyId': academyId,
      }));
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': res.statusCode == 200 || res.statusCode == 201,
        'data': data,
        'message': data['message'],
      };
    } catch (e) {
      return {'success': false, 'message': '게시글 등록에 실패했습니다.'};
    }
  }

  Future<Map<String, dynamic>> togglePostLike(int postId, String userId) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/routing/board/posts/$postId/like');
      final res = await postWithAuth(url, jsonEncode({'userId': userId}));
      return {'success': res.statusCode == 200 || res.statusCode == 201};
    } catch (_) {
      return {'success': false};
    }
  }

  Future<Map<String, dynamic>> addPostComment(
    int postId, {
    required String content,
    required String authorName,
    String authorRole = 'TEACHER',
  }) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/routing/board/posts/$postId/comments');
      final res = await postWithAuth(url, jsonEncode({
        'content': content,
        'authorName': authorName,
        'authorRole': authorRole,
      }));
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': res.statusCode == 200 || res.statusCode == 201,
        'data': data,
      };
    } catch (e) {
      return {'success': false, 'message': '댓글 작성에 실패했습니다.'};
    }
  }

  Future<Map<String, dynamic>> deleteBoardPost(int postId) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/routing/board/posts/$postId');
      final res = await deleteWithAuth(url);
      return {'success': res.statusCode == 200 || res.statusCode == 204};
    } catch (_) {
      return {'success': false};
    }
  }

  // ==================== TEACHER MESSAGES APIs ====================
  Future<List<Map<String, dynamic>>> getTeacherInbox(String email) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/teacher/inbox?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url);
      if (res.statusCode == 200) {
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is List) {
          return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        }
      }
    } catch (_) {}
    return [];
  }

  Future<Map<String, dynamic>?> getStaffList() async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/teacher/staff');
      final res = await getWithAuth(url);
      if (res.statusCode == 200) {
        return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>?;
      }
    } catch (_) {}
    return null;
  }

  Future<Map<String, dynamic>> sendTeacherMessage({
    required String email,
    required String message,
    List<int>? studentIds,
    List<int>? parentIds,
    List<int>? staffUserIds,
  }) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/teacher/send-message');
      final res = await postWithAuth(url, jsonEncode({
        'email': email,
        'message': message,
        'studentIds': studentIds ?? [],
        'parentIds': parentIds ?? [],
        'staffUserIds': staffUserIds ?? [],
      }));
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': res.statusCode == 200 || res.statusCode == 201,
        'message': data['message'] ?? (res.statusCode == 200 || res.statusCode == 201 ? '메시지가 성공적으로 전송되었습니다.' : '전송 실패'),
      };
    } catch (e) {
      return {'success': false, 'message': '메시지 전송에 실패했습니다.'};
    }
  }

  // ==================== CHAT APIs ====================
  Future<List<Map<String, dynamic>>> getChatRooms(String email, {bool throwOnError = false}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/chat/rooms?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url).timeout(const Duration(seconds: 6));
      if (throwOnError) throwIfServerError(res);
      if (res.statusCode == 200) {
        final List<dynamic> data = jsonDecode(utf8.decode(res.bodyBytes));
        return data.whereType<Map<String, dynamic>>().where((r) => !isOldNoticeRoom(r)).toList();
      }
      return [];
    } catch (e) {
      debugPrint('[ApiService] getChatRooms error: $e');
      if (throwOnError) rethrow;
      return [];
    }
  }

  Future<Map<String, List<Map<String, dynamic>>>> getChatUsers(String email, {bool throwOnError = false}) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/chat/users?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url).timeout(const Duration(seconds: 6));
      if (throwOnError) throwIfServerError(res);
      if (res.statusCode == 200) {
        final Map<String, dynamic> data = jsonDecode(utf8.decode(res.bodyBytes));
        return {
          'drivers': (data['drivers'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>().toList(),
          'teachers': (data['teachers'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>().toList(),
          'admins': (data['admins'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>().toList(),
          'parents': (data['parents'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>().toList(),
        };
      }
      return {'drivers': [], 'teachers': [], 'admins': [], 'parents': []};
    } catch (e) {
      debugPrint('[ApiService] getChatUsers error: $e');
      if (throwOnError) rethrow;
      return {'drivers': [], 'teachers': [], 'admins': [], 'parents': []};
    }
  }

  Future<List<Map<String, dynamic>>> getChatMessages(int roomId, {String? email, int? userId, bool throwOnError = false}) async {
    try {
      final queryParams = <String, String>{'roomId': roomId.toString()};
      if (email != null) queryParams['email'] = email;
      if (userId != null) queryParams['userId'] = userId.toString();
      final uri = Uri.parse('${AppConfig.apiHost}/chat/messages').replace(queryParameters: queryParams);
      final res = await getWithAuth(uri).timeout(const Duration(seconds: 6));
      if (throwOnError) throwIfServerError(res);
      if (res.statusCode == 200) {
        final List<dynamic> data = jsonDecode(utf8.decode(res.bodyBytes));
        return data.whereType<Map<String, dynamic>>().toList();
      }
      return [];
    } catch (e) {
      if (throwOnError) rethrow;
      debugPrint('[ApiService] getChatMessages error: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> sendChatMessage({
    required int roomId,
    required String text,
    required String senderEmail,
  }) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/chat/messages');
      final res = await postWithAuth(url, jsonEncode({
        'roomId': roomId,
        'text': text,
        'senderEmail': senderEmail,
      })).timeout(const Duration(seconds: 6));
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': res.statusCode == 200 || res.statusCode == 201,
        'data': data,
      };
    } catch (e) {
      debugPrint('[ApiService] sendChatMessage error: $e');
      return {'success': false, 'message': '메시지 전송 실패: $e'};
    }
  }

  Future<Map<String, dynamic>> createChatRoom({
    required String name,
    String type = 'DIRECT',
    required List<int> userIds,
    required String creatorEmail,
  }) async {
    try {
      final url = Uri.parse('${AppConfig.apiHost}/chat/rooms');
      final res = await postWithAuth(url, jsonEncode({
        'name': name,
        'type': type,
        'userIds': userIds,
        'creatorEmail': creatorEmail,
      })).timeout(const Duration(seconds: 6));
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': res.statusCode == 200 || res.statusCode == 201,
        'data': data,
      };
    } catch (e) {
      debugPrint('[ApiService] createChatRoom error: $e');
      return {'success': false, 'message': '채팅방 생성 실패: $e'};
    }
  }
}
