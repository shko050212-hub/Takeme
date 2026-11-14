import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:http/http.dart' as http;
import '../../config.dart';
import '../../services/api_service.dart';

class PhotoGalleryScreen extends StatefulWidget {
  final int? initialVehicleId;
  final String? initialClassName;

  const PhotoGalleryScreen({
    super.key,
    this.initialVehicleId,
    this.initialClassName,
  });

  @override
  State<PhotoGalleryScreen> createState() => _PhotoGalleryScreenState();
}

class _PhotoGalleryScreenState extends State<PhotoGalleryScreen> {
  final ApiService _api = ApiService();
  final ImagePicker _picker = ImagePicker();

  bool _isLoading = true;
  bool _isUploading = false;
  bool _isSaving = false;
  String? _errorMessage;

  List<dynamic> _photos = [];

  String _selectedSource = ''; // '' 전체, 'GALLERY' 보관함, 'NOTICE' 알림장, 'BOARD' 게시판
  bool _isSelectMode = false;
  final Set<int> _selectedIds = {};

  @override
  void initState() {
    super.initState();
    _loadPhotos();
  }

  Future<void> _loadPhotos() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await _api.getMediaAssets(
        vehicleId: widget.initialVehicleId,
        className: widget.initialClassName,
        sourceType: _selectedSource.isNotEmpty ? _selectedSource : null,
      );
      if (mounted) {
        setState(() {
          _photos = res;
          _isLoading = false;
          _selectedIds.clear();
        });
      }
    } catch (e) {
      if (mounted) {
        String msg = e.toString();
        if (msg.contains('서버에 이 기능이 아직 없습니다') || msg.contains('<!doctype') || msg.contains('<html') || msg.contains('FormatException')) {
          msg = '서버에 이 기능이 아직 없습니다(배포 필요)';
        } else {
          msg = msg.replaceFirst(RegExp(r'^Exception:\s*'), '');
        }
        setState(() {
          _errorMessage = msg;
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _pickAndUploadImages({required ImageSource source}) async {
    try {
      List<XFile> picked = [];
      if (source == ImageSource.camera) {
        final photo = await _picker.pickImage(
          source: ImageSource.camera,
          imageQuality: 85,
          maxWidth: 1920,
        );
        if (photo != null) picked.add(photo);
      } else {
        picked = await _picker.pickMultiImage(
          imageQuality: 85,
          maxWidth: 1920,
        );
      }

      if (picked.isEmpty) return;

      setState(() => _isUploading = true);

      final photoPayloads = <Map<String, dynamic>>[];
      for (final file in picked) {
        final bytes = await file.readAsBytes();
        final base64String = base64Encode(bytes);
        final ext = file.name.split('.').last.toLowerCase();
        final mime = ext == 'png'
            ? 'image/png'
            : ext == 'webp'
                ? 'image/webp'
                : 'image/jpeg';

        photoPayloads.add({
          'base64Data': 'data:$mime;base64,$base64String',
          'filename': file.name,
          'mimeType': mime,
        });
      }

      await _api.uploadMediaAssets(
        photos: photoPayloads,
        vehicleId: widget.initialVehicleId,
        className: widget.initialClassName,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${photoPayloads.length}장의 사진이 보관함에 저장되었습니다.'),
            backgroundColor: const Color(0xFF16A34A),
          ),
        );
      }

      await _loadPhotos();
    } catch (e) {
      if (mounted) {
        String msg = e.toString();
        if (msg.contains('서버에 이 기능이 아직 없습니다') || msg.contains('<!doctype') || msg.contains('<html') || msg.contains('FormatException')) {
          msg = '서버에 이 기능이 아직 없습니다(배포 필요)';
        } else {
          msg = msg.replaceFirst(RegExp(r'^Exception:\s*'), '');
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('사진 업로드 실패: $msg'),
            backgroundColor: const Color(0xFFDC2626),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isUploading = false);
      }
    }
  }

  void _showUploadSourceSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFE2E8F0),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                '사진 보관함에 사진 올리기',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 12),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFEFF6FF),
                  child: Icon(Icons.camera_alt, color: Color(0xFF2563EB)),
                ),
                title: const Text('카메라로 바로 촬영', style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: const Text('현장 사진을 즉시 촬영하여 업로드합니다.'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndUploadImages(source: ImageSource.camera);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFF0FDF4),
                  child: Icon(Icons.photo_library, color: Color(0xFF16A34A)),
                ),
                title: const Text('앨범/갤러리에서 선택 (여러 장 가능)', style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: const Text('기기에 저장된 사진을 한 번에 여러 장 선택합니다.'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndUploadImages(source: ImageSource.gallery);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _deletePhoto(int id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('사진 삭제'),
        content: const Text('이 사진을 보관함에서 영구히 삭제하시겠습니까?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('삭제', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await _api.deleteMediaAsset(id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('사진이 삭제되었습니다.')),
        );
      }
      await _loadPhotos();
    } catch (e) {
      if (mounted) {
        String msg = e.toString();
        if (msg.contains('서버에 이 기능이 아직 없습니다') || msg.contains('<!doctype') || msg.contains('<html') || msg.contains('FormatException')) {
          msg = '서버에 이 기능이 아직 없습니다(배포 필요)';
        } else {
          msg = msg.replaceFirst(RegExp(r'^Exception:\s*'), '');
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('삭제 실패: $msg'), backgroundColor: const Color(0xFFDC2626)),
        );
      }
    }
  }

  Future<bool> _savePhotoToDevice(dynamic photo, {bool showToast = true}) async {
    try {
      final token = _api.token ?? '';
      final url = Uri.parse('${AppConfig.apiHost}/routing/media/${photo['id']}/download?token=$token');
      final res = await http.get(url);
      if (res.statusCode != 200) {
        throw Exception('다운로드 실패 (코드: ${res.statusCode})');
      }

      Directory? baseDir;
      if (Platform.isAndroid) {
        final extDir = Directory('/storage/emulated/0/Pictures/TakeMe');
        if (await extDir.exists()) {
          baseDir = extDir;
        } else {
          try {
            await extDir.create(recursive: true);
            baseDir = extDir;
          } catch (_) {
            baseDir = await getExternalStorageDirectory() ?? await getApplicationDocumentsDirectory();
          }
        }
      } else {
        baseDir = await getApplicationDocumentsDirectory();
      }

      final filename = photo['filename'] ?? 'takeme_${photo['id']}.jpg';
      final file = File('${baseDir.path}/$filename');
      await file.writeAsBytes(res.bodyBytes);

      if (mounted && showToast) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('사진이 저장되었습니다: ${file.path}'),
            backgroundColor: const Color(0xFF16A34A),
          ),
        );
      }
      return true;
    } catch (e) {
      if (mounted && showToast) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('사진 저장 실패: $e'),
            backgroundColor: const Color(0xFFDC2626),
          ),
        );
      }
      return false;
    }
  }

  Future<void> _saveSelectedPhotosToDevice() async {
    if (_selectedIds.isEmpty) return;
    setState(() => _isSaving = true);
    int savedCount = 0;
    try {
      for (final id in _selectedIds) {
        final photo = _photos.firstWhere((p) => p['id'] == id, orElse: () => null);
        if (photo != null) {
          final ok = await _savePhotoToDevice(photo, showToast: false);
          if (ok) savedCount++;
        }
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$savedCount장의 사진이 저장되었습니다.'),
            backgroundColor: const Color(0xFF16A34A),
          ),
        );
        setState(() {
          _isSelectMode = false;
          _selectedIds.clear();
        });
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _openFullScreenViewer(dynamic photo) {
    final currentUserId = _api.currentUser?.id;
    final isOwner = photo['uploaderId'] == currentUserId;
    final isAdmin = _api.currentUser?.role == 'ACADEMY_ADMIN';
    final canDelete = isOwner || isAdmin;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: const Color(0x99000000),
            foregroundColor: Colors.white,
            elevation: 0,
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: photo['sourceType'] == 'NOTICE'
                            ? const Color(0xFFF59E0B)
                            : photo['sourceType'] == 'BOARD'
                                ? const Color(0xFF0284C7)
                                : const Color(0xFF7C3AED),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        photo['sourceType'] == 'NOTICE'
                            ? '알림장'
                            : photo['sourceType'] == 'BOARD'
                                ? '게시판'
                                : '보관함',
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      photo['uploaderName'] ?? '교직원',
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                  ],
                ),
                Text(
                  _formatDate(photo['createdAt']),
                  style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                ),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.download_rounded, color: Colors.white),
                tooltip: '사진 저장',
                onPressed: () => _savePhotoToDevice(photo),
              ),
              if (canDelete)
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: Color(0xFFEF4444)),
                  tooltip: '사진 삭제',
                  onPressed: () async {
                    Navigator.pop(context);
                    await _deletePhoto(photo['id']);
                  },
                ),
            ],
          ),
          body: Center(
            child: InteractiveViewer(
              minScale: 0.8,
              maxScale: 4.0,
              child: photo['url'] != null && photo['url'].toString().isNotEmpty
                  ? Image.network(
                      photo['url'],
                      fit: BoxFit.contain,
                      loadingBuilder: (ctx, child, progress) {
                        if (progress == null) return child;
                        return const Center(child: CircularProgressIndicator(color: Colors.white));
                      },
                      errorBuilder: (ctx, err, stack) => const Center(
                        child: Text('이미지를 불러올 수 없습니다.', style: TextStyle(color: Colors.white)),
                      ),
                    )
                  : const Center(
                      child: Text('이미지 주소가 없습니다.', style: TextStyle(color: Colors.white)),
                    ),
            ),
          ),
        ),
      ),
    );
  }

  String _formatDate(dynamic dateStr) {
    if (dateStr == null) return '';
    try {
      final dt = DateTime.parse(dateStr.toString()).toLocal();
      return '${dt.year}.${dt.month.toString().padLeft(2, '0')}.${dt.day.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return dateStr.toString();
    }
  }

  String _extractDateKey(dynamic dateStr) {
    if (dateStr == null) return '기타';
    try {
      final dt = DateTime.parse(dateStr.toString()).toLocal();
      const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
      final weekday = weekdays[dt.weekday - 1];
      return '${dt.year}년 ${dt.month}월 ${dt.day}일 ($weekday)';
    } catch (_) {
      return '기타';
    }
  }

  Map<String, List<dynamic>> _groupByDate(List<dynamic> photos) {
    final map = <String, List<dynamic>>{};
    for (final p in photos) {
      final key = _extractDateKey(p['createdAt']);
      map.putIfAbsent(key, () => []).add(p);
    }
    return map;
  }

  Widget _buildSourceChips() {
    final chips = [
      {'label': '전체', 'value': ''},
      {'label': '보관함 업로드', 'value': 'GALLERY'},
      {'label': '알림장', 'value': 'NOTICE'},
      {'label': '게시판', 'value': 'BOARD'},
    ];

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: chips.map((c) {
            final isSelected = _selectedSource == c['value'];
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(
                  c['label']!,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                    color: isSelected ? Colors.white : const Color(0xFF475569),
                  ),
                ),
                selected: isSelected,
                selectedColor: const Color(0xFF2563EB),
                backgroundColor: const Color(0xFFF1F5F9),
                onSelected: (val) {
                  if (val) {
                    setState(() => _selectedSource = c['value']!);
                    _loadPhotos();
                  }
                },
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentUserId = _api.currentUser?.id;
    final grouped = _groupByDate(_photos);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Text(
          _isSelectMode ? '${_selectedIds.length}장 선택됨' : '사진 보관함 (클라우드)',
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: Icon(_isSelectMode ? Icons.close : Icons.checklist_rounded, color: const Color(0xFF475569)),
            tooltip: _isSelectMode ? '선택 취소' : '선택 모드',
            onPressed: () {
              setState(() {
                _isSelectMode = !_isSelectMode;
                _selectedIds.clear();
              });
            },
          ),
          if (!_isSelectMode) ...[
            IconButton(
              icon: const Icon(Icons.refresh, color: Color(0xFF64748B)),
              tooltip: '새로고침',
              onPressed: _loadPhotos,
            ),
            IconButton(
              icon: const Icon(Icons.add_a_photo, color: Color(0xFF2563EB)),
              tooltip: '사진 추가',
              onPressed: _isUploading ? null : _showUploadSourceSheet,
            ),
          ],
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: Column(
        children: [
          _buildSourceChips(),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
                : _errorMessage != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.error_outline, size: 40, color: Color(0xFFEF4444)),
                            const SizedBox(height: 12),
                            Text(_errorMessage!, style: const TextStyle(color: Color(0xFF64748B))),
                            const SizedBox(height: 12),
                            ElevatedButton(
                              onPressed: _loadPhotos,
                              child: const Text('다시 시도'),
                            ),
                          ],
                        ),
                      )
                    : _photos.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Container(
                                  width: 72,
                                  height: 72,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFEFF6FF),
                                    borderRadius: BorderRadius.circular(36),
                                  ),
                                  child: const Icon(Icons.cloud_outlined, size: 36, color: Color(0xFF2563EB)),
                                ),
                                const SizedBox(height: 16),
                                const Text(
                                  '보관함에 저장된 사진이 없습니다.',
                                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                                ),
                                const SizedBox(height: 6),
                                const Text(
                                  '현장 사진을 안전하게 클라우드에 보관하고\n관리자 웹과 실시간으로 공유하세요.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                ),
                                const SizedBox(height: 20),
                                ElevatedButton.icon(
                                  onPressed: _showUploadSourceSheet,
                                  icon: const Icon(Icons.add_a_photo, size: 18),
                                  label: const Text('사진 올리기'),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: const Color(0xFF2563EB),
                                    foregroundColor: Colors.white,
                                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                  ),
                                ),
                              ],
                            ),
                          )
                        : Stack(
                            children: [
                              RefreshIndicator(
                                onRefresh: _loadPhotos,
                                color: const Color(0xFF2563EB),
                                child: ListView.builder(
                                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 80),
                                  itemCount: grouped.keys.length,
                                  itemBuilder: (ctx, idx) {
                                    final dateKey = grouped.keys.elementAt(idx);
                                    final datePhotos = grouped[dateKey]!;

                                    return Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Padding(
                                          padding: const EdgeInsets.symmetric(vertical: 8),
                                          child: Row(
                                            children: [
                                              const Icon(Icons.calendar_today, size: 14, color: Color(0xFF64748B)),
                                              const SizedBox(width: 6),
                                              Text(
                                                dateKey,
                                                style: const TextStyle(
                                                  fontSize: 13,
                                                  fontWeight: FontWeight.w800,
                                                  color: Color(0xFF334155),
                                                ),
                                              ),
                                              const SizedBox(width: 6),
                                              Text(
                                                '(${datePhotos.length})',
                                                style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8), fontWeight: FontWeight.bold),
                                              ),
                                            ],
                                          ),
                                        ),
                                        GridView.builder(
                                          shrinkWrap: true,
                                          physics: const NeverScrollableScrollPhysics(),
                                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                                            crossAxisCount: 3,
                                            crossAxisSpacing: 8,
                                            mainAxisSpacing: 8,
                                            childAspectRatio: 1,
                                          ),
                                          itemCount: datePhotos.length,
                                          itemBuilder: (context, pIdx) {
                                            final photo = datePhotos[pIdx];
                                            final isMyPhoto = photo['uploaderId'] == currentUserId;
                                            final photoId = photo['id'] as int? ?? 0;
                                            final isSelected = _selectedIds.contains(photoId);

                                            return GestureDetector(
                                              onTap: () {
                                                if (_isSelectMode) {
                                                  setState(() {
                                                    if (isSelected) {
                                                      _selectedIds.remove(photoId);
                                                    } else {
                                                      _selectedIds.add(photoId);
                                                    }
                                                  });
                                                } else {
                                                  _openFullScreenViewer(photo);
                                                }
                                              },
                                              child: ClipRRect(
                                                borderRadius: BorderRadius.circular(10),
                                                child: Stack(
                                                  fit: StackFit.expand,
                                                  children: [
                                                    photo['url'] != null && photo['url'].toString().isNotEmpty
                                                        ? Image.network(
                                                            photo['url'],
                                                            fit: BoxFit.cover,
                                                            errorBuilder: (ctx, err, stack) => Container(
                                                              color: const Color(0xFFE2E8F0),
                                                              child: const Icon(Icons.broken_image, color: Color(0xFF94A3B8)),
                                                            ),
                                                          )
                                                        : Container(
                                                            color: const Color(0xFFE2E8F0),
                                                            child: const Icon(Icons.image, color: Color(0xFF94A3B8)),
                                                          ),

                                                    // Source Badge (Top-Left)
                                                    Positioned(
                                                      top: 4,
                                                      left: 4,
                                                      child: Container(
                                                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                                        decoration: BoxDecoration(
                                                          color: photo['sourceType'] == 'NOTICE'
                                                              ? const Color(0xE6F59E0B)
                                                              : photo['sourceType'] == 'BOARD'
                                                                  ? const Color(0xE60284C7)
                                                                  : const Color(0xE67C3AED),
                                                          borderRadius: BorderRadius.circular(4),
                                                        ),
                                                        child: Text(
                                                          photo['sourceType'] == 'NOTICE'
                                                              ? '알림장'
                                                              : photo['sourceType'] == 'BOARD'
                                                                  ? '게시판'
                                                                  : '보관함',
                                                          style: const TextStyle(color: Colors.white, fontSize: 8.5, fontWeight: FontWeight.bold),
                                                        ),
                                                      ),
                                                    ),

                                                    // Top-Right: Selection Checkbox or My Photo Badge
                                                    if (_isSelectMode)
                                                      Positioned(
                                                        top: 4,
                                                        right: 4,
                                                        child: Container(
                                                          width: 22,
                                                          height: 22,
                                                          decoration: BoxDecoration(
                                                            color: isSelected ? const Color(0xFF2563EB) : const Color(0xCCFFFFFF),
                                                            shape: BoxShape.circle,
                                                            border: Border.all(
                                                              color: isSelected ? const Color(0xFF2563EB) : const Color(0xFFCBD5E1),
                                                              width: 2,
                                                            ),
                                                          ),
                                                          child: isSelected
                                                              ? const Icon(Icons.check, size: 14, color: Colors.white)
                                                              : null,
                                                        ),
                                                      )
                                                    else if (isMyPhoto)
                                                      Positioned(
                                                        top: 4,
                                                        right: 4,
                                                        child: Container(
                                                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                                                          decoration: BoxDecoration(
                                                            color: const Color(0xD92563EB),
                                                            borderRadius: BorderRadius.circular(4),
                                                          ),
                                                          child: const Text(
                                                            '내 사진',
                                                            style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                                                          ),
                                                        ),
                                                      ),
                                                  ],
                                                ),
                                              ),
                                            );
                                          },
                                        ),
                                        const SizedBox(height: 12),
                                      ],
                                    );
                                  },
                                ),
                              ),
                              if (_isUploading || _isSaving)
                                Container(
                                  color: const Color(0x4D000000),
                                  child: Center(
                                    child: Card(
                                      child: Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
                                        child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            const CircularProgressIndicator(color: Color(0xFF2563EB)),
                                            const SizedBox(height: 14),
                                            Text(
                                              _isSaving ? '스마트폰 갤러리에 저장 중...' : '클라우드에 사진 업로드 중...',
                                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
          ),
        ],
      ),
      floatingActionButton: _isSelectMode
          ? FloatingActionButton.extended(
              onPressed: _selectedIds.isEmpty || _isSaving ? null : _saveSelectedPhotosToDevice,
              backgroundColor: const Color(0xFF16A34A),
              foregroundColor: Colors.white,
              icon: const Icon(Icons.download_rounded),
              label: Text('${_selectedIds.length}장 스마트폰에 저장', style: const TextStyle(fontWeight: FontWeight.bold)),
            )
          : FloatingActionButton.extended(
              onPressed: _isUploading ? null : _showUploadSourceSheet,
              backgroundColor: const Color(0xFF2563EB),
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_a_photo),
              label: const Text('사진 올리기', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
    );
  }
}
