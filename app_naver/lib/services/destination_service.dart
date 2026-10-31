import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../driver/geo.dart';

class PlaceItem {
  final String name;
  final String address;
  final GeoPoint point;
  final String? category;

  const PlaceItem({
    required this.name,
    required this.address,
    required this.point,
    this.category,
  });
}

class DestinationService {
  static final DestinationService _instance = DestinationService._internal();
  factory DestinationService() => _instance;
  DestinationService._internal();

  /// 대표 추천 목적지 프리셋 목록
  static const List<PlaceItem> popularDestinations = [
    PlaceItem(
      name: '해맑은 유치원 본원',
      address: '서울특별시 중구 세종대로 110',
      point: GeoPoint(37.5665, 126.9780),
      category: '유치원',
    ),
    PlaceItem(
      name: '서울역 광장',
      address: '서울특별시 중구 한강대로 405',
      point: GeoPoint(37.5560, 126.9723),
      category: '교통',
    ),
    PlaceItem(
      name: '광화문 광장',
      address: '서울특별시 종로구 세종대로 172',
      point: GeoPoint(37.5724, 126.9769),
      category: '명소',
    ),
    PlaceItem(
      name: '명동역 사거리',
      address: '서울특별시 중구 퇴계로 126',
      point: GeoPoint(37.5610, 126.9858),
      category: '상권',
    ),
    PlaceItem(
      name: '강남역 교차로',
      address: '서울특별시 강남구 강남대로 396',
      point: GeoPoint(37.4979, 127.0276),
      category: '교통',
    ),
    PlaceItem(
      name: '여의도 더현대 서울',
      address: '서울특별시 영등포구 여의대로 108',
      point: GeoPoint(37.5259, 126.9284),
      category: '쇼핑',
    ),
    PlaceItem(
      name: '판교역 테크노밸리',
      address: '경기도 성남시 분당구 판교역로 160',
      point: GeoPoint(37.3948, 127.1112),
      category: '교통',
    ),
    PlaceItem(
      name: '용산역 아이파크몰',
      address: '서울특별시 용산구 한강대로23길 55',
      point: GeoPoint(37.5298, 126.9647),
      category: '쇼핑',
    ),
    PlaceItem(
      name: '홍대입구역 9번출구',
      address: '서울특별시 마포구 양화로 160',
      point: GeoPoint(37.5575, 126.9245),
      category: '상권',
    ),
    PlaceItem(
      name: '잠실 롯데월드타워',
      address: '서울특별시 송파구 올림픽로 300',
      point: GeoPoint(37.5133, 127.1028),
      category: '명소',
    ),
    PlaceItem(
      name: '샛별 어린이집',
      address: '서울특별시 중구 남대문로 30',
      point: GeoPoint(37.5615, 126.9745),
      category: '어린이집',
    ),
    PlaceItem(
      name: '한마음 초등학교',
      address: '서울특별시 중구 명동길 45',
      point: GeoPoint(37.5585, 126.9830),
      category: '초등학교',
    ),
    PlaceItem(
      name: '푸른숲 유치원',
      address: '서울특별시 중구 충무로 25',
      point: GeoPoint(37.5640, 126.9900),
      category: '유치원',
    ),
  ];

  /// 키워드로 장소/주소 검색
  Future<List<PlaceItem>> searchPlaces(String query) async {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return popularDestinations;

    // 1. 프리셋에서 우선 매칭
    final matchedPresets = popularDestinations.where((p) {
      return p.name.toLowerCase().contains(q) || p.address.toLowerCase().contains(q);
    }).toList();

    // 2. 외부 온라인 지오코딩 API 검색 (OSM Nominatim - 한국 지역 최적화)
    try {
      final url = Uri.parse(
        'https://nominatim.openstreetmap.org/search?q=${Uri.encodeComponent(query)}&format=json&countrycodes=kr&limit=5',
      );
      final res = await http.get(url, headers: {
        'User-Agent': 'TakeMeShuttleApp/1.0',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      }).timeout(const Duration(seconds: 3));

      if (res.statusCode == 200) {
        final list = jsonDecode(utf8.decode(res.bodyBytes)) as List;
        for (final item in list) {
          final lat = double.tryParse(item['lat']?.toString() ?? '');
          final lon = double.tryParse(item['lon']?.toString() ?? '');
          final displayName = item['display_name']?.toString() ?? query;
          if (lat != null && lon != null) {
            final parts = displayName.split(',');
            final name = parts.isNotEmpty ? parts.first.trim() : query;
            final address = parts.length > 1 ? parts.sublist(1).join(',').trim() : displayName;

            // 중복 방지
            if (!matchedPresets.any((p) => p.name == name)) {
              matchedPresets.add(PlaceItem(
                name: name,
                address: address,
                point: GeoPoint(lat, lon),
                category: '검색결과',
              ));
            }
          }
        }
      }
    } catch (e) {
      debugPrint('[DestinationService] Online search fallback: $e');
    }

    // 3. 만약 검색 결과가 없으면 임의 입력 좌표(서울 중심 기준 오프셋) 폴백 제공
    if (matchedPresets.isEmpty) {
      matchedPresets.add(PlaceItem(
        name: query,
        address: '입력하신 장소 위치',
        point: const GeoPoint(37.5665, 126.9780),
        category: '직접입력',
      ));
    }

    return matchedPresets;
  }
}
