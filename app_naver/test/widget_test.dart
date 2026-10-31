import 'package:flutter_test/flutter_test.dart';
import 'package:app_naver/main.dart';

void main() {
  testWidgets('TakeMe Driver App loads smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const TakeMeDriverApp());
    expect(find.byType(TakeMeDriverApp), findsOneWidget);
  });
}
