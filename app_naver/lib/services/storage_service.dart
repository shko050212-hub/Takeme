import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../models/user_model.dart';

class StorageService {
  static const _keyToken = 'takeme_auth_token';
  static const _keyUser = 'takeme_auth_user';
  static const _keyNaverClientId = 'takeme_naver_client_id';
  static const _keyBaseUrl = 'takeme_base_url';

  static SharedPreferences? _prefs;

  static Future<void> init() async {
    _prefs ??= await SharedPreferences.getInstance();
  }

  static Future<void> saveToken(String token) async {
    await init();
    await _prefs!.setString(_keyToken, token);
  }

  static Future<String?> getToken() async {
    await init();
    return _prefs!.getString(_keyToken);
  }

  static Future<void> saveUser(UserModel user) async {
    await init();
    await _prefs!.setString(_keyUser, jsonEncode(user.toJson()));
  }

  static Future<UserModel?> getUser() async {
    await init();
    final raw = _prefs!.getString(_keyUser);
    if (raw == null) return null;
    try {
      return UserModel.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveNaverClientId(String clientId) async {
    await init();
    await _prefs!.setString(_keyNaverClientId, clientId.trim());
  }

  static Future<String> getNaverClientId() async {
    await init();
    final saved = _prefs!.getString(_keyNaverClientId);
    if (saved != null && saved.trim().isNotEmpty) {
      return saved.trim();
    }
    return AppConfig.defaultNaverClientId;
  }

  static Future<void> saveBaseUrl(String url) async {
    await init();
    await _prefs!.setString(_keyBaseUrl, url.trim());
  }

  static Future<String> getBaseUrl() async {
    await init();
    final saved = _prefs!.getString(_keyBaseUrl);
    if (saved != null && saved.trim().isNotEmpty) {
      return saved.trim();
    }
    return AppConfig.defaultBaseUrl;
  }

  static Future<void> clearAll() async {
    await init();
    await _prefs!.remove(_keyToken);
    await _prefs!.remove(_keyUser);
  }
}
