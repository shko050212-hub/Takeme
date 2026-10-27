import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';

class AbsenceModal extends StatefulWidget {
  final String email;
  final VoidCallback onSuccess;

  const AbsenceModal({
    super.key,
    required this.email,
    required this.onSuccess,
  });

  @override
  State<AbsenceModal> createState() => _AbsenceModalState();
}

class _AbsenceModalState extends State<AbsenceModal> {
  String _overrideType = 'ABSENCE'; // 'ABSENCE' | 'CHANGE_LOCATION' | 'MESSAGE'
  final _reasonController = TextEditingController();
  final _dateController = TextEditingController();
  final Set<String> _selectedRoles = {'TEACHER'};
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    _dateController.text = DateFormat('yyyy-MM-dd').format(tomorrow);
  }

  @override
  void dispose() {
    _reasonController.dispose();
    _dateController.dispose();
    super.dispose();
  }

  void _showMessage(String msg, {bool isError = true}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.red.shade700 : const Color(0xFF10B981),
      ),
    );
  }

  Future<void> _handleSubmit() async {
    final reason = _reasonController.text.trim();
    if (_overrideType == 'ABSENCE' && reason.isEmpty) {
      _showMessage('결석 사유를 입력해주세요.');
      return;
    }
    if (_overrideType == 'CHANGE_LOCATION' && reason.isEmpty) {
      _showMessage('정확한 도로명 주소를 입력해주세요.');
      return;
    }
    if (_overrideType == 'MESSAGE') {
      if (_selectedRoles.isEmpty) {
        _showMessage('수신 대상을 선택해주세요.');
        return;
      }
      if (reason.isEmpty) {
        _showMessage('메시지 내용을 입력해주세요.');
        return;
      }
    }

    setState(() => _isLoading = true);

    Map<String, dynamic> res;
    if (_overrideType == 'MESSAGE') {
      res = await ApiService().createParentMessage(
        email: widget.email,
        targetRoles: _selectedRoles.toList(),
        message: reason,
      );
    } else {
      res = await ApiService().createOverride(
        email: widget.email,
        targetDate: _dateController.text.trim(),
        overrideType: _overrideType,
        reason: reason,
      );
    }

    setState(() => _isLoading = false);

    if (res['success'] == true) {
      if (!mounted) return;
      Navigator.pop(context);
      widget.onSuccess();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('신청이 정상적으로 접수되었습니다.'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
    } else {
      _showMessage(res['message'] ?? '신청에 실패했습니다.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Container(
        padding: const EdgeInsets.all(22),
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '결석 / 변경 / 메시지 신청',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 4),
              const Text(
                '언제든지 자유롭게 신청하실 수 있습니다.',
                style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 18),

              // Mode Tabs
              Row(
                children: [
                  _buildTab('ABSENCE', '결석 신청'),
                  const SizedBox(width: 6),
                  _buildTab('CHANGE_LOCATION', '탑승지 변경'),
                  const SizedBox(width: 6),
                  _buildTab('MESSAGE', '메시지 전송'),
                ],
              ),
              const SizedBox(height: 18),

              if (_overrideType != 'MESSAGE') ...[
                const Text('적용 날짜', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                const SizedBox(height: 6),
                TextField(
                  controller: _dateController,
                  decoration: InputDecoration(
                    hintText: 'YYYY-MM-DD',
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    suffixIcon: const Icon(Icons.calendar_today, size: 18, color: Color(0xFF94A3B8)),
                  ),
                ),
                const SizedBox(height: 14),
              ],

              if (_overrideType == 'MESSAGE') ...[
                const Text('수신 대상 선택', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: [
                    _buildRoleChip('TEACHER', '지도교사'),
                    _buildRoleChip('DRIVER', '기사님'),
                    _buildRoleChip('ACADEMY_ADMIN', '원장선생님'),
                  ],
                ),
                const SizedBox(height: 14),
              ],

              Text(
                _overrideType == 'ABSENCE'
                    ? '결석 사유'
                    : (_overrideType == 'CHANGE_LOCATION' ? '변경할 탑승지 주소' : '전송할 메시지 내용'),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF334155)),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _reasonController,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: _overrideType == 'ABSENCE'
                      ? '예: 감기 몸살로 인한 병결'
                      : (_overrideType == 'CHANGE_LOCATION'
                          ? '예: 서울시 강서구 마곡중앙로 33 정문 앞'
                          : '선생님께 전달할 전달사항을 적어주세요.'),
                  contentPadding: const EdgeInsets.all(12),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 22),

              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('취소', style: TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.w700)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _handleSubmit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        elevation: 0,
                      ),
                      child: _isLoading
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Text('신청하기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTab(String type, String label) {
    final isSelected = _overrideType == type;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _overrideType = type),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFFEFF6FF) : const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: isSelected ? const Color(0xFF3B82F6) : Colors.transparent),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: isSelected ? const Color(0xFF2563EB) : const Color(0xFF64748B),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRoleChip(String role, String label) {
    final isSelected = _selectedRoles.contains(role);
    return FilterChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (val) {
        setState(() {
          if (val) {
            _selectedRoles.add(role);
          } else {
            _selectedRoles.remove(role);
          }
        });
      },
      selectedColor: const Color(0xFFEFF6FF),
      checkmarkColor: const Color(0xFF2563EB),
      labelStyle: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: isSelected ? const Color(0xFF2563EB) : const Color(0xFF64748B),
      ),
    );
  }
}
