import 'dart:convert';

import 'package:flutter/material.dart';

import '../../config.dart';
import '../../services/api_service.dart';

/// 운행 일지 (월별)
/// 서버 GET /teacher/operation-logs?month=YYYY-MM 의 기록을 날짜별로 보여준다.
/// - 운행 시작·종료 시각, 운행 시간
/// - 탑승 기록 (QR / 수동 확인)
/// - 기타 기록 (운행 시작·종료, 결석 처리, 메시지, 긴급 상황 등)
class OperationLogScreen extends StatefulWidget {
  const OperationLogScreen({super.key});

  @override
  State<OperationLogScreen> createState() => _OperationLogScreenState();
}

class _LogRecord {
  final String name;
  final String method; // QR, MANUAL, SYSTEM
  final DateTime? time;
  _LogRecord(this.name, this.method, this.time);

  bool get isBoarding => method == 'QR' || method == 'MANUAL';
}

class _DayLog {
  final String date; // YYYY-MM-DD
  final DateTime? start;
  final DateTime? end;
  final List<_LogRecord> records;
  _DayLog(this.date, this.start, this.end, this.records);

  int get boardedCount => records.where((r) => r.isBoarding).length;
}

class _OperationLogScreenState extends State<OperationLogScreen> {
  static const _blue = Color(0xFF2563EB);
  static const _slate800 = Color(0xFF1E293B);
  static const _slate600 = Color(0xFF475569);
  static const _slate500 = Color(0xFF64748B);
  static const _slate200 = Color(0xFFE2E8F0);
  static const _red = Color(0xFFDC2626);

  late DateTime _month;
  bool _loading = true;
  String? _error;
  List<_DayLog> _logs = [];

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = DateTime(now.year, now.month);
    _load();
  }

  String get _monthKey => '${_month.year}-${_month.month.toString().padLeft(2, '0')}';

  DateTime? _parseTime(dynamic v) {
    if (v == null) return null;
    return DateTime.tryParse(v.toString())?.toLocal(); // 서버는 UTC → 휴대폰 시간으로
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final email = ApiService().currentUser?.email ?? '';
      final url = Uri.parse(
          '${AppConfig.apiHost}/teacher/operation-logs?month=$_monthKey&email=${Uri.encodeComponent(email)}');
      final res = await ApiService().getWithAuth(url);
      if (res.statusCode != 200) throw Exception('서버 응답 ${res.statusCode}');
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      final list = <_DayLog>[];
      for (final l in (data as List)) {
        final records = <_LogRecord>[];
        for (final r in (l['boardingRecords'] as List? ?? [])) {
          records.add(_LogRecord('${r['studentName'] ?? ''}', '${r['method'] ?? ''}', _parseTime(r['boardTime'])));
        }
        records.sort((a, b) => (a.time ?? DateTime(0)).compareTo(b.time ?? DateTime(0)));
        list.add(_DayLog('${l['dateString']}', _parseTime(l['startTime']), _parseTime(l['endTime']), records));
      }
      list.sort((a, b) => b.date.compareTo(a.date)); // 최근 날짜가 위로
      if (!mounted) return;
      setState(() {
        _logs = list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '운행 일지를 불러오지 못했습니다. ($e)';
        _loading = false;
      });
    }
  }

  void _moveMonth(int delta) {
    setState(() => _month = DateTime(_month.year, _month.month + delta));
    _load();
  }

  String _hm(DateTime? t) =>
      t == null ? '--:--' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  String _dateLabel(String ymd) {
    final d = DateTime.tryParse(ymd);
    if (d == null) return ymd;
    const week = ['월', '화', '수', '목', '금', '토', '일'];
    return '${d.month}월 ${d.day}일 (${week[d.weekday - 1]})';
  }

  @override
  Widget build(BuildContext context) {
    final isCurrentMonth = _month.year == DateTime.now().year && _month.month == DateTime.now().month;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text('운행 일지'),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            // 월 선택
            Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  IconButton(
                    iconSize: 28,
                    tooltip: '이전 달',
                    onPressed: _loading ? null : () => _moveMonth(-1),
                    icon: const Icon(Icons.chevron_left, color: _slate800),
                  ),
                  Expanded(
                    child: Text('${_month.year}년 ${_month.month}월',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: _slate800)),
                  ),
                  IconButton(
                    iconSize: 28,
                    tooltip: '다음 달',
                    onPressed: (_loading || isCurrentMonth) ? null : () => _moveMonth(1),
                    icon: const Icon(Icons.chevron_right, color: _slate800),
                  ),
                ],
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: _blue));
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: _red, fontSize: 14)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('다시 불러오기'),
            ),
          ]),
        ),
      );
    }
    if (_logs.isEmpty) {
      return const Center(
        child: Text('이 달의 운행 기록이 없습니다.', style: TextStyle(fontSize: 15, color: _slate500)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _logs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) => _dayCard(_logs[i]),
      ),
    );
  }

  Widget _dayCard(_DayLog d) {
    final running = d.start != null && d.end == null;
    final minutes = (d.start != null && d.end != null) ? d.end!.difference(d.start!).inMinutes : null;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _slate200),
      ),
      child: Theme(
        // ExpansionTile 의 기본 구분선 제거
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          title: Text(_dateLabel(d.date),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: _slate800)),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(spacing: 12, runSpacing: 4, children: [
              Text(
                running
                    ? '운행 ${_hm(d.start)} ~ 운행 중'
                    : '운행 ${_hm(d.start)} ~ ${_hm(d.end)}${minutes == null ? '' : ' ($minutes분)'}',
                style: TextStyle(fontSize: 13, color: running ? _blue : _slate600, fontWeight: FontWeight.w600),
              ),
              Text('탑승 ${d.boardedCount}명',
                  style: const TextStyle(fontSize: 13, color: _blue, fontWeight: FontWeight.w800)),
            ]),
          ),
          children: d.records.isEmpty
              ? [const Text('기록이 없습니다.', style: TextStyle(fontSize: 13, color: _slate500))]
              : [for (final r in d.records) _recordRow(r)],
        ),
      ),
    );
  }

  Widget _recordRow(_LogRecord r) {
    IconData icon;
    Color color;
    String tag;
    switch (r.method) {
      case 'QR':
        icon = Icons.qr_code_scanner;
        color = const Color(0xFF059669);
        tag = 'QR 탑승';
      case 'MANUAL':
        icon = Icons.how_to_reg;
        color = _blue;
        tag = '수동 확인';
      default:
        icon = Icons.info_outline;
        color = _slate500;
        tag = '기록';
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 48,
            child: Text(_hm(r.time), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _slate800)),
          ),
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              r.isBoarding ? '${r.name} · $tag' : r.name,
              style: TextStyle(fontSize: 13, color: r.isBoarding ? _slate800 : _slate600),
            ),
          ),
        ],
      ),
    );
  }
}
