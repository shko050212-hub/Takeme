import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../config.dart';
import '../models/route_model.dart';
import '../models/user_model.dart';
import 'storage_service.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String? _token;
  UserModel? _currentUser;
  String _baseUrl = AppConfig.defaultBaseUrl;

  String? get token => _token;
  UserModel? get currentUser => _currentUser;
  String get baseUrl => _baseUrl;
  bool get isLoggedIn => _token != null && _token!.isNotEmpty;
  bool get isDemo => _token == null || _token == 'demo_token' || (_currentUser != null && _currentUser!.email.toLowerCase().contains('demo'));

  Future<void> init() async {
    await StorageService.init();
    _token = await StorageService.getToken();
    _currentUser = await StorageService.getUser();
    _baseUrl = await StorageService.getBaseUrl();
  }

  void updateBaseUrl(String url) {
    _baseUrl = url.trim();
    StorageService.saveBaseUrl(_baseUrl);
  }

  Future<void> setAuth(String? token, UserModel? user) async {
    _token = token;
    _currentUser = user;
    if (token != null) {
      await StorageService.saveToken(token);
    }
    if (user != null) {
      await StorageService.saveUser(user);
    }
    if (token == null && user == null) {
      await StorageService.clearAll();
    }
  }

  Future<void> logout() async {
    await setAuth(null, null);
  }

  Map<String, String> _headers([Map<String, String>? extra]) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_token != null && _token!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_token';
    }
    if (extra != null) {
      headers.addAll(extra);
    }
    return headers;
  }

  Future<http.Response> postWithAuth(Uri uri, dynamic body) async {
    return await http.post(
      uri,
      headers: _headers(),
      body: body is String ? body : jsonEncode(body),
    );
  }

  Future<http.Response> getWithAuth(Uri uri) async {
    return await http.get(uri, headers: _headers());
  }

  /// 기사 로그인
  Future<Map<String, dynamic>> login(String email, String password) async {
    try {
      final url = Uri.parse('$_baseUrl/auth/login');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email.trim(), 'password': password.trim()}),
      );

      final data = jsonDecode(utf8.decode(res.bodyBytes));
      if (res.statusCode == 200 || res.statusCode == 201) {
        final token = data['token'] ?? data['accessToken'];
        final userMap = data['user'] ?? data;
        final user = UserModel.fromJson(userMap);
        await setAuth(token, user);
        return {'success': true, 'user': user, 'token': token};
      } else {
        return {'success': false, 'message': data['message'] ?? '로그인에 실패했습니다.'};
      }
    } catch (e) {
      debugPrint('[ApiService] login error: $e');
      return {'success': false, 'message': '서버에 연결할 수 없습니다. ($e)'};
    }
  }

  /// 기사 배정 차량 조회
  Future<VehicleModel?> getDriverVehicle(String email) async {
    if (isDemo || email.toLowerCase().contains('demo')) {
      return null;
    }
    try {
      final url = Uri.parse('$_baseUrl/teacher/my-vehicle?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url);
      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        if (data != null && data is Map<String, dynamic>) {
          return VehicleModel.fromJson(data);
        }
      }
    } catch (e) {
      debugPrint('[ApiService] getDriverVehicle error: $e');
    }
    return null;
  }

  /// 노선 및 정류장 목록 조회
  Future<RouteDataModel?> getDriverRoute(String email) async {
    if (isDemo || email.toLowerCase().contains('demo')) {
      return null;
    }
    try {
      final url = Uri.parse('$_baseUrl/teacher/route?email=${Uri.encodeComponent(email)}');
      final res = await getWithAuth(url);
      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        if (data != null && data is Map<String, dynamic>) {
          return RouteDataModel.fromJson(data);
        }
      }
    } catch (e) {
      debugPrint('[ApiService] getDriverRoute error: $e');
    }
    return null;
  }

  /// 카카오/네이버 길찾기 중계 API (/directions)
  Future<Map<String, dynamic>> getDirections({
    required Map<String, dynamic> origin,
    required Map<String, dynamic> destination,
    required List<Map<String, dynamic>> waypoints,
    required String mode,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl/directions');
      final res = await postWithAuth(url, {
        'origin': origin,
        'destination': destination,
        'waypoints': waypoints,
        'mode': mode,
      });

      final data = jsonDecode(utf8.decode(res.bodyBytes));
      if (res.statusCode == 200 || res.statusCode == 201) {
        return data as Map<String, dynamic>;
      } else {
        throw Exception(data['message'] ?? '길찾기 실패 (${res.statusCode})');
      }
    } catch (e) {
      debugPrint('[ApiService] getDirections error: $e');
      rethrow;
    }
  }

  /// 운행 종료 통보
  Future<void> endOperation() async {
    try {
      final url = Uri.parse('$_baseUrl/teacher/end-operation');
      await postWithAuth(url, {});
    } catch (e) {
      debugPrint('[ApiService] endOperation error: $e');
    }
  }
}
