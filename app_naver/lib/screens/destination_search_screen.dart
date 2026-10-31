import 'package:flutter/material.dart';
import '../config.dart';
import '../driver/driver_navigator.dart';
import '../driver/geo.dart';
import '../services/destination_service.dart';
import '../widgets/naver_map_controller.dart';

class DestinationSearchScreen extends StatefulWidget {
  final DriverNavigator nav;
  final NaverMapController map;

  const DestinationSearchScreen({
    super.key,
    required this.nav,
    required this.map,
  });

  @override
  State<DestinationSearchScreen> createState() => _DestinationSearchScreenState();
}

class _DestinationSearchScreenState extends State<DestinationSearchScreen> {
  final _searchCtrl = TextEditingController();
  List<PlaceItem> _results = DestinationService.popularDestinations;
  bool _searching = false;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _performSearch(String query) async {
    final text = query.trim();
    if (text.isEmpty) {
      setState(() {
        _results = DestinationService.popularDestinations;
        _searching = false;
      });
      return;
    }

    setState(() {
      _searching = true;
    });

    final items = await DestinationService().searchPlaces(text);
    if (!mounted) return;

    setState(() {
      _results = items;
      _searching = false;
    });
  }

  void _selectPlace(PlaceItem item) {
    widget.nav.setDestination(item.name, item.point);
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('[목적지 설정 완료] ${item.name}'),
        backgroundColor: AppColors.naverGreenDark,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _clearDestination() {
    if (widget.nav.destination == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('이미 목적지가 초기화되어 있습니다.'),
          duration: Duration(seconds: 1),
        ),
      );
      return;
    }

    widget.nav.clearDestination();
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('목적지가 초기화되었습니다.'),
        backgroundColor: AppColors.slate800,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _pickOnMap() {
    Navigator.of(context).pop();
    widget.nav.togglePickOnMapMode();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('지도의 원하는 위치를 클릭하면 목적지로 지정됩니다.'),
        backgroundColor: AppColors.warningOrange,
        duration: const Duration(seconds: 3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.of(context).size.width > 640;

    Widget body = Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.slate800),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text(
          '목적지 설정 / 검색',
          style: TextStyle(
            color: AppColors.slate900,
            fontSize: 17,
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          TextButton.icon(
            onPressed: _clearDestination,
            icon: Icon(
              Icons.refresh,
              size: 15,
              color: widget.nav.destination != null ? AppColors.dangerRed : AppColors.slate500,
            ),
            label: Text(
              '초기화',
              style: TextStyle(
                color: widget.nav.destination != null ? AppColors.dangerRed : AppColors.slate500,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. 상단 검색창 + 검색 버튼 영역
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _searchCtrl,
                      autofocus: false,
                      textInputAction: TextInputAction.search,
                      onSubmitted: _performSearch,
                      onChanged: (text) {
                        setState(() {});
                        _performSearch(text);
                      },
                      decoration: InputDecoration(
                        hintText: '장소명 또는 주소 검색 (예: 서울역, 강남역)',
                        hintStyle: const TextStyle(fontSize: 13, color: AppColors.slate500),
                        prefixIcon: IconButton(
                          icon: const Icon(Icons.search, color: AppColors.naverGreenDark),
                          onPressed: () => _performSearch(_searchCtrl.text),
                        ),
                        suffixIcon: _searchCtrl.text.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear, size: 18, color: AppColors.slate500),
                                onPressed: () {
                                  _searchCtrl.clear();
                                  _performSearch('');
                                },
                              )
                            : (_searching
                                ? const Padding(
                                    padding: EdgeInsets.all(12),
                                    child: SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  )
                                : null),
                        filled: true,
                        fillColor: AppColors.slate50,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: AppColors.slate200),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: AppColors.slate200),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: AppColors.naverGreen, width: 2),
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    height: 48,
                    child: ElevatedButton.icon(
                      onPressed: () => _performSearch(_searchCtrl.text),
                      icon: const Icon(Icons.search, size: 16, color: Colors.white),
                      label: const Text(
                        '검색',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.naverGreen,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        elevation: 0,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // 2. 빠른 추천 목적지 칩
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    ActionChip(
                      avatar: const Icon(Icons.touch_app, size: 16, color: AppColors.warningOrange),
                      label: const Text(
                        '지도에서 핀 찍기',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.warningOrange),
                      ),
                      backgroundColor: AppColors.warningOrangeBg,
                      side: const BorderSide(color: AppColors.warningOrange),
                      onPressed: _pickOnMap,
                    ),
                    const SizedBox(width: 8),
                    ...DestinationService.popularDestinations.take(8).map((p) {
                      final isSelected = widget.nav.destinationName == p.name;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ActionChip(
                          label: Text(
                            p.name,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                              color: isSelected ? AppColors.naverGreenDark : AppColors.slate800,
                            ),
                          ),
                          backgroundColor: isSelected ? AppColors.naverGreenLight : AppColors.slate100,
                          side: BorderSide(
                            color: isSelected ? AppColors.naverGreen : Colors.transparent,
                          ),
                          onPressed: () => _selectPlace(p),
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),

            const Divider(height: 1, thickness: 1, color: AppColors.slate200),

            // 3. 현재 목적지 안내 배너 (설정된 경우)
            if (widget.nav.destination != null)
              Container(
                margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.dangerRedBg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.dangerRed.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.flag, size: 18, color: AppColors.dangerRed),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '현재 목적지: ${widget.nav.destinationName}',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: AppColors.dangerRed,
                        ),
                      ),
                    ),
                    OutlinedButton(
                      onPressed: _clearDestination,
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.dangerRed),
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                      ),
                      child: const Text('초기화', style: TextStyle(color: AppColors.dangerRed, fontSize: 11)),
                    ),
                  ],
                ),
              ),

            // 4. 검색 결과 목록 헤더
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _searchCtrl.text.isEmpty ? '인기 추천 목적지' : '검색 결과',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: AppColors.slate600,
                    ),
                  ),
                  Text(
                    '총 ${_results.length}건',
                    style: const TextStyle(fontSize: 12, color: AppColors.slate500),
                  ),
                ],
              ),
            ),

            // 5. 검색 결과 리스트
            Expanded(
              child: _results.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.search_off, size: 48, color: AppColors.slate300),
                          const SizedBox(height: 12),
                          Text(
                            '"${_searchCtrl.text}"에 대한 검색 결과가 없습니다.',
                            style: const TextStyle(fontSize: 14, color: AppColors.slate600),
                          ),
                          const SizedBox(height: 6),
                          const Text(
                            '다른 검색어를 입력하시거나 [지도에서 핀 찍기]를 이용해 보세요.',
                            style: TextStyle(fontSize: 12, color: AppColors.slate500),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      itemCount: _results.length,
                      separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.slate100),
                      itemBuilder: (_, idx) {
                        final item = _results[idx];
                        final isCurDest = widget.nav.destinationName == item.name;

                        return Material(
                          color: Colors.transparent,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(10),
                            onTap: () => _selectPlace(item),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 18,
                                    backgroundColor: isCurDest ? AppColors.dangerRedBg : AppColors.naverGreenLight,
                                    child: Icon(
                                      isCurDest ? Icons.flag : Icons.location_on,
                                      size: 19,
                                      color: isCurDest ? AppColors.dangerRed : AppColors.naverGreenDark,
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Flexible(
                                              child: Text(
                                                item.name,
                                                style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 14,
                                                  color: isCurDest ? AppColors.dangerRed : AppColors.slate900,
                                                ),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                            if (item.category != null) ...[
                                              const SizedBox(width: 6),
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                                decoration: BoxDecoration(
                                                  color: AppColors.slate100,
                                                  borderRadius: BorderRadius.circular(4),
                                                ),
                                                child: Text(
                                                  item.category!,
                                                  style: const TextStyle(fontSize: 10, color: AppColors.slate600),
                                                ),
                                              ),
                                            ],
                                          ],
                                        ),
                                        const SizedBox(height: 3),
                                        Text(
                                          item.address,
                                          style: const TextStyle(fontSize: 12, color: AppColors.slate500),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  ElevatedButton(
                                    onPressed: () => _selectPlace(item),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: isCurDest ? AppColors.dangerRed : AppColors.naverGreenLight,
                                      foregroundColor: isCurDest ? Colors.white : AppColors.naverGreenDark,
                                      elevation: 0,
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      minimumSize: Size.zero,
                                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                                    ),
                                    child: Text(
                                      isCurDest ? '선택됨' : '선택',
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                        color: isCurDest ? Colors.white : AppColors.naverGreenDark,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );

    if (isWide) {
      return Scaffold(
        backgroundColor: const Color(0xFF0B0F19),
        body: Center(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 540),
            decoration: BoxDecoration(
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.5),
                  blurRadius: 24,
                ),
              ],
            ),
            child: body,
          ),
        ),
      );
    }

    return body;
  }
}
