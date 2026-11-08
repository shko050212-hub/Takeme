import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class HomeroomAttendanceView extends StatefulWidget {
  const HomeroomAttendanceView({super.key});

  @override
  State<HomeroomAttendanceView> createState() => _HomeroomAttendanceViewState();
}

class _HomeroomAttendanceViewState extends State<HomeroomAttendanceView> {
  DateTime _selectedDate = DateTime.now();
  bool _isLoading = true;
  bool _isSubmitting = false;

  String? _assignedClass;
  bool _isSubmitted = false;
  Map<String, dynamic>? _submissionData;
  List<Map<String, dynamic>> _students = [];

  // Local state: studentId -> status ('PRESENT', 'ABSENT', 'LATE', 'EARLY_LEAVE')
  final Map<int, String> _statuses = {};
  // Local state: studentId -> memo
  final Map<int, TextEditingController> _memoControllers = {};

  @override
  void initState() {
    super.initState();
    _loadAttendance();
  }

  @override
  void dispose() {
    for (final controller in _memoControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String _formatDate(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _loadAttendance() async {
    setState(() => _isLoading = true);
    final dateStr = _formatDate(_selectedDate);
    final res = await ApiService().getHomeroomAttendance(date: dateStr);

    if (!mounted) return;

    if (res != null) {
      _assignedClass = res['assignedClass'] as String?;
      _isSubmitted = res['isSubmitted'] == true;
      _submissionData = res['submission'] as Map<String, dynamic>?;

      final rawList = res['students'] as List<dynamic>? ?? [];
      _students = rawList.map((e) => Map<String, dynamic>.from(e as Map)).toList();

      for (final s in _students) {
        final id = s['studentId'] as int;
        final status = (s['status'] as String?) ?? 'PRESENT';
        _statuses[id] = status;

        final memo = (s['memo'] as String?) ?? '';
        if (_memoControllers.containsKey(id)) {
          _memoControllers[id]!.text = memo;
        } else {
          _memoControllers[id] = TextEditingController(text: memo);
        }
      }
    } else {
      _students = [];
    }

    setState(() => _isLoading = false);
  }

  void _markAllPresent() {
    setState(() {
      for (final s in _students) {
        final id = s['studentId'] as int;
        _statuses[id] = 'PRESENT';
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('전원 출석으로 설정했습니다. 하단의 제출 버튼을 눌러 확정하세요.'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  Future<void> _submitAttendance() async {
    if (_students.isEmpty) return;

    setState(() => _isSubmitting = true);
    final dateStr = _formatDate(_selectedDate);

    final payloadList = _students.map((s) {
      final id = s['studentId'] as int;
      return {
        'studentId': id,
        'status': _statuses[id] ?? 'PRESENT',
        'memo': _memoControllers[id]?.text.trim() ?? '',
      };
    }).toList();

    final res = await ApiService().submitHomeroomAttendance(
      date: dateStr,
      attendances: payloadList,
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (res['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res['message'] ?? '출석부가 관리자 웹으로 전송되었습니다.'),
          backgroundColor: const Color(0xFF16A34A),
        ),
      );
      _loadAttendance();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res['message'] ?? '출석부 제출에 실패했습니다.'),
          backgroundColor: const Color(0xFFDC2626),
        ),
      );
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2023, 1, 1),
      lastDate: DateTime(2030, 12, 31),
      locale: const Locale('ko', 'KR'),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: Color(0xFF2563EB),
              onPrimary: Colors.white,
              onSurface: Color(0xFF0F172A),
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null && picked != _selectedDate) {
      setState(() => _selectedDate = picked);
      _loadAttendance();
    }
  }

  @override
  Widget build(BuildContext context) {
    int presentCount = 0;
    int absentCount = 0;
    int lateCount = 0;
    int earlyLeaveCount = 0;

    for (final s in _students) {
      final id = s['studentId'] as int;
      final st = _statuses[id] ?? 'PRESENT';
      if (st == 'PRESENT') {
        presentCount++;
      } else if (st == 'ABSENT') {
        absentCount++;
      } else if (st == 'LATE') {
        lateCount++;
      } else if (st == 'EARLY_LEAVE') {
        earlyLeaveCount++;
      }
    }

    final dateStr = _formatDate(_selectedDate);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: Column(
        children: [
          // Top Date & Action Header
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    InkWell(
                      onTap: _pickDate,
                      borderRadius: BorderRadius.circular(10),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.calendar_today, size: 16, color: Color(0xFF2563EB)),
                            const SizedBox(width: 8),
                            Text(
                              dateStr,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const Icon(Icons.arrow_drop_down, color: Color(0xFF64748B)),
                          ],
                        ),
                      ),
                    ),
                    // Submission Status Badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: _isSubmitted ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: _isSubmitted ? const Color(0xFF86EFAC) : const Color(0xFFFDE68A),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _isSubmitted ? Icons.check_circle : Icons.schedule,
                            size: 14,
                            color: _isSubmitted ? const Color(0xFF16A34A) : const Color(0xFFD97706),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            _isSubmitted
                                ? (_submissionData?['teacherName'] != null
                                    ? '제출 완료 (${_submissionData!['teacherName']})'
                                    : '제출 완료')
                                : '미제출',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: _isSubmitted ? const Color(0xFF15803D) : const Color(0xFFB45309),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                // Summary Counts & "전원 출석" Button
                Row(
                  children: [
                    Expanded(
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          _buildCountBadge('출석', presentCount, const Color(0xFF16A34A), const Color(0xFFDCFCE7)),
                          _buildCountBadge('결석', absentCount, const Color(0xFFDC2626), const Color(0xFFFEE2E2)),
                          _buildCountBadge('지각', lateCount, const Color(0xFFD97706), const Color(0xFFFEF3C7)),
                          _buildCountBadge('조퇴', earlyLeaveCount, const Color(0xFF9333EA), const Color(0xFFF3E8FF)),
                        ],
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: _students.isEmpty ? null : _markAllPresent,
                      icon: const Icon(Icons.done_all, size: 16),
                      label: const Text('전원 출석', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF2563EB),
                        side: const BorderSide(color: Color(0xFF93C5FD)),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0xFFE2E8F0)),

          // Body List
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _students.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.people_outline, size: 48, color: Colors.grey[400]),
                            const SizedBox(height: 12),
                            Text(
                              _assignedClass != null ? '$_assignedClass 반 원아가 없습니다.' : '원아 목록이 없습니다.',
                              style: const TextStyle(fontSize: 15, color: Color(0xFF64748B)),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadAttendance,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: _students.length,
                          itemBuilder: (context, index) {
                            final s = _students[index];
                            final id = s['studentId'] as int;
                            final name = (s['name'] as String?) ?? '원아';
                            final currentStatus = _statuses[id] ?? 'PRESENT';
                            final boardStatus = s['boardStatus'] as String?;
                            final vehicleName = (s['vehicleName'] as String?) ?? '';
                            final memoCtrl = _memoControllers[id];

                            return Card(
                              margin: const EdgeInsets.only(bottom: 10),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                                side: BorderSide(
                                  color: currentStatus == 'ABSENT'
                                      ? const Color(0xFFFECACA)
                                      : const Color(0xFFE2E8F0),
                                ),
                              ),
                              elevation: 0,
                              color: currentStatus == 'ABSENT' ? const Color(0xFFFFF5F5) : Colors.white,
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    // Row: Name + Shuttle Status Badge
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            Text(
                                              name,
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w800,
                                                color: Color(0xFF0F172A),
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            if (boardStatus == 'BOARDED')
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFEFF6FF),
                                                  borderRadius: BorderRadius.circular(4),
                                                  border: Border.all(color: const Color(0xFFBFDBFE)),
                                                ),
                                                child: Text(
                                                  '셔틀 탑승 ($vehicleName)',
                                                  style: const TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.bold,
                                                    color: Color(0xFF2563EB),
                                                  ),
                                                ),
                                              )
                                            else if (boardStatus == 'ABSENT')
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFFEE2E2),
                                                  borderRadius: BorderRadius.circular(4),
                                                  border: Border.all(color: const Color(0xFFFECACA)),
                                                ),
                                                child: const Text(
                                                  '결석 신청',
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.bold,
                                                    color: Color(0xFFDC2626),
                                                  ),
                                                ),
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 10),
                                    // 4 Attendance Status Buttons
                                    Row(
                                      children: [
                                        _buildStatusChoiceButton(
                                          id,
                                          '출석',
                                          'PRESENT',
                                          currentStatus == 'PRESENT',
                                          const Color(0xFF16A34A),
                                          const Color(0xFFDCFCE7),
                                        ),
                                        const SizedBox(width: 6),
                                        _buildStatusChoiceButton(
                                          id,
                                          '결석',
                                          'ABSENT',
                                          currentStatus == 'ABSENT',
                                          const Color(0xFFDC2626),
                                          const Color(0xFFFEE2E2),
                                        ),
                                        const SizedBox(width: 6),
                                        _buildStatusChoiceButton(
                                          id,
                                          '지각',
                                          'LATE',
                                          currentStatus == 'LATE',
                                          const Color(0xFFD97706),
                                          const Color(0xFFFEF3C7),
                                        ),
                                        const SizedBox(width: 6),
                                        _buildStatusChoiceButton(
                                          id,
                                          '조퇴',
                                          'EARLY_LEAVE',
                                          currentStatus == 'EARLY_LEAVE',
                                          const Color(0xFF9333EA),
                                          const Color(0xFFF3E8FF),
                                        ),
                                      ],
                                    ),
                                    // Optional memo note
                                    const SizedBox(height: 8),
                                    TextField(
                                      controller: memoCtrl,
                                      style: const TextStyle(fontSize: 12),
                                      decoration: InputDecoration(
                                        isDense: true,
                                        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                        hintText: '특이사항 / 사유 메모 (선택)',
                                        hintStyle: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(8),
                                          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(8),
                                          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(8),
                                          borderSide: const BorderSide(color: Color(0xFF2563EB)),
                                        ),
                                        fillColor: Colors.white,
                                        filled: true,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),

          // Bottom Submit Action
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              border: const Border(top: BorderSide(color: Color(0xFFF1F5F9))),
              boxShadow: [
                BoxShadow(
                  color: const Color(0x0A000000),
                  offset: const Offset(0, -3),
                  blurRadius: 8,
                ),
              ],
            ),
            child: SafeArea(
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: (_isSubmitting || _students.isEmpty) ? null : _submitAttendance,
                  icon: _isSubmitting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Icon(_isSubmitted ? Icons.update : Icons.cloud_upload_outlined, size: 20),
                  label: Text(
                    _isSubmitting
                        ? '제출 처리 중...'
                        : _isSubmitted
                            ? '출석부 수정하여 재전송'
                            : '출석부 관리자에게 제출',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _isSubmitted ? const Color(0xFF0F766E) : const Color(0xFF2563EB),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCountBadge(String label, int count, Color textCol, Color bgCol) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: bgCol,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        '$label $count',
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: textCol),
      ),
    );
  }

  Widget _buildStatusChoiceButton(
    int studentId,
    String label,
    String statusCode,
    bool isSelected,
    Color activeColor,
    Color activeBg,
  ) {
    return Expanded(
      child: InkWell(
        onTap: () {
          setState(() {
            _statuses[studentId] = statusCode;
          });
        },
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? activeBg : const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isSelected ? activeColor : const Color(0xFFE2E8F0),
              width: isSelected ? 1.5 : 1.0,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
              color: isSelected ? activeColor : const Color(0xFF64748B),
            ),
          ),
        ),
      ),
    );
  }
}
