import 'package:flutter/material.dart';
import '../config.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';

class DriverSettingsScreen extends StatefulWidget {
  const DriverSettingsScreen({super.key});

  @override
  State<DriverSettingsScreen> createState() => _DriverSettingsScreenState();
}

class _DriverSettingsScreenState extends State<DriverSettingsScreen> {
  final _clientIdCtrl = TextEditingController();
  final _serverUrlCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final clientId = await StorageService.getNaverClientId();
    final serverUrl = await StorageService.getBaseUrl();
    setState(() {
      _clientIdCtrl.text = clientId;
      _serverUrlCtrl.text = serverUrl;
    });
  }

  Future<void> _save() async {
    final id = _clientIdCtrl.text.trim();
    final url = _serverUrlCtrl.text.trim();

    await StorageService.saveNaverClientId(id);
    if (url.isNotEmpty) {
      await StorageService.saveBaseUrl(url);
      ApiService().updateBaseUrl(url);
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('설정이 저장되었습니다.')),
      );
    }
  }

  @override
  void dispose() {
    _clientIdCtrl.dispose();
    _serverUrlCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.slate50,
      appBar: AppBar(
        title: const Text('기사앱 환경 설정', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        backgroundColor: Colors.white,
        foregroundColor: AppColors.slate800,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 네이버 클라우드 지도 API 섹션
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.slate200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.naverGreenLight,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text('NAVER MAP', style: TextStyle(color: AppColors.naverGreenDark, fontWeight: FontWeight.bold, fontSize: 11)),
                      ),
                      const SizedBox(width: 8),
                      const Text('네이버 지도 API 설정', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    '네이버 클라우드 플랫폼(NCP) Web Dynamic Map Client ID를 입력하세요. 미입력 시에도 시뮬레이션 지도로 모든 주행 테스트가 가능합니다.',
                    style: TextStyle(fontSize: 13, color: AppColors.slate600, height: 1.4),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _clientIdCtrl,
                    decoration: InputDecoration(
                      labelText: 'NCP Client ID (ncpClientId)',
                      hintText: '예: 9xx123ab...',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // 서버 주소 설정 섹션
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.slate200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('백엔드 서버 주소', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 8),
                  const Text(
                    '운행 상태 및 위치를 송수신할 백엔드 API 서버 주소입니다.',
                    style: TextStyle(fontSize: 13, color: AppColors.slate600),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _serverUrlCtrl,
                    decoration: InputDecoration(
                      labelText: '서버 URL',
                      hintText: AppConfig.defaultBaseUrl,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      OutlinedButton(
                        onPressed: () {
                          _serverUrlCtrl.text = AppConfig.defaultBaseUrl;
                        },
                        style: OutlinedButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          foregroundColor: AppColors.primaryBlue,
                        ),
                        child: const Text('클라우드 서버(기본값)'),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: () {
                          _serverUrlCtrl.text = 'http://localhost:3000';
                        },
                        style: OutlinedButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          foregroundColor: AppColors.slate600,
                        ),
                        child: const Text('로컬 서버'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // 저장 버튼
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.naverGreen,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  elevation: 0,
                ),
                child: const Text('설정 저장하기', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
