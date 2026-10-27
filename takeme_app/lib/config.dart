/// 실행할 때 바꾸려면:
/// flutter run --dart-define=API_URL=http://내_IPv4_주소:3000
class AppConfig {
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://52.63.245.203:3000',
  );

  /// 기존 앱(shuttle-app)과 같은 카카오맵 JavaScript 키
  static const kakaoJsKey = String.fromEnvironment(
    'KAKAO_JS_KEY',
    defaultValue: 'cdd5918d0722ccd39b08f2d09b102d31',
  );
}
