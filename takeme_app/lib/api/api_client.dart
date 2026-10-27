import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

class ApiException implements Exception {
  final String message;
  final int? status;
  ApiException(this.message, [this.status]);

  @override
  String toString() => message;
}

/// 모든 서버 요청은 이 클래스로: 로그인 토큰을 자동으로 붙이고 오류 메시지를 정리한다.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'takeme_token';

  String? _token;
  String? get token => _token;

  /// 토큰이 만료되어 401이 오면 호출 (로그아웃 처리)
  void Function()? onUnauthorized;

  Future<String?> loadToken() async {
    _token = await _storage.read(key: _tokenKey);
    return _token;
  }

  Future<void> saveToken(String? token) async {
    _token = token;
    if (token == null) {
      await _storage.delete(key: _tokenKey);
    } else {
      await _storage.write(key: _tokenKey, value: token);
    }
  }

  Map<String, String> _headers() => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  Future<dynamic> _send(String method, String path,
      [Map<String, dynamic>? body]) async {
    final uri = Uri.parse('${AppConfig.apiUrl}$path');
    const timeout = Duration(seconds: 10);

    http.Response res;
    try {
      res = method == 'GET'
          ? await http.get(uri, headers: _headers()).timeout(timeout)
          : await http
              .post(uri, headers: _headers(), body: jsonEncode(body ?? {}))
              .timeout(timeout);
    } catch (_) {
      throw ApiException('서버에 연결할 수 없습니다. (${AppConfig.apiUrl})');
    }

    final text = utf8.decode(res.bodyBytes);
    dynamic data;
    try {
      data = text.isEmpty ? null : jsonDecode(text);
    } catch (_) {
      data = text;
    }

    if (res.statusCode == 401 && _token != null) onUnauthorized?.call();

    if (res.statusCode >= 400) {
      final msg = data is Map ? data['message'] : null;
      throw ApiException(
        msg is List
            ? msg.join(', ')
            : (msg?.toString() ?? '요청 실패 (${res.statusCode})'),
        res.statusCode,
      );
    }
    if (data is String && data.trimLeft().startsWith('<')) {
      throw ApiException('API 대신 웹 화면이 응답했습니다. 서버 주소(포트 3000)를 확인하세요.');
    }
    return data;
  }
}
