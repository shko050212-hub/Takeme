class NotificationModel {
  final int? id;
  final String? key;
  final String title;
  final String message;
  final String type;
  final bool isRead;
  final DateTime createdAt;

  NotificationModel({
    this.id,
    this.key,
    required this.title,
    required this.message,
    this.type = 'NOTICE',
    this.isRead = false,
    required this.createdAt,
  });

  NotificationModel copyWith({bool? isRead}) {
    return NotificationModel(
      id: id,
      key: key,
      title: title,
      message: message,
      type: type,
      isRead: isRead ?? this.isRead,
      createdAt: createdAt,
    );
  }

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    DateTime parsedDate;
    try {
      parsedDate = json['createdAt'] != null
          ? DateTime.parse(json['createdAt'].toString())
          : DateTime.now();
    } catch (_) {
      parsedDate = DateTime.now();
    }

    final rawTitle = json['title']?.toString();
    final rawMsg = json['message']?.toString() ?? '';

    return NotificationModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? ''),
      key: json['key']?.toString(),
      title: rawTitle != null && rawTitle.isNotEmpty ? rawTitle : '알림',
      message: rawMsg,
      type: json['type']?.toString() ?? 'NOTICE',
      isRead: json['isRead'] == true,
      createdAt: parsedDate,
    );
  }
}
