/**
 * 관리자 웹(shuttle-web)과 같은 디자인을 쓰기 위한 색·모양 값.
 * 웹은 Tailwind 기본 색을 쓰므로 같은 값을 그대로 옮겨 왔음.
 */
export const C = {
  slate50: '#f8fafc', slate100: '#f1f5f9', slate200: '#e2e8f0', slate300: '#cbd5e1',
  slate400: '#94a3b8', slate500: '#64748b', slate600: '#475569', slate700: '#334155', slate800: '#1e293b',
  blue50: '#eff6ff', blue100: '#dbeafe', blue200: '#bfdbfe', blue500: '#3b82f6', blue600: '#2563eb', blue700: '#1d4ed8',
  green100: '#dcfce7', green200: '#bbf7d0', green600: '#16a34a', green700: '#15803d',
  orange100: '#ffedd5', orange200: '#fed7aa', orange700: '#c2410c',
  red50: '#fef2f2', red200: '#fecaca', red600: '#dc2626', red700: '#b91c1c',
  white: '#ffffff',
};

// 웹 index.css 의 .form-input
export const formInput = {
  width: '100%', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
  borderWidth: 1, borderColor: C.slate200, backgroundColor: C.slate50, fontSize: 16, color: C.slate800,
};
export const formInputFocus = { borderColor: C.blue500, backgroundColor: C.white };

// 웹 .btn-primary (bg-blue-600, rounded-xl, 흰 글씨, semibold)
export const btnPrimary = { backgroundColor: C.blue600, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' };
export const btnPrimaryText = { color: C.white, fontWeight: '600', fontSize: 16 };

// 웹 카드: bg-white border border-slate-200 rounded-xl shadow-sm
export const card = {
  backgroundColor: C.white, borderWidth: 1, borderColor: C.slate200, borderRadius: 12, padding: 16,
  shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
};

// 웹 상태 뱃지: text-[11px] px-2 py-1 rounded border font-bold
export const badge = { fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, fontWeight: '700', overflow: 'hidden' };
export const badgeGreen = { backgroundColor: C.green100, color: C.green700, borderColor: C.green200 };
export const badgeOrange = { backgroundColor: C.orange100, color: C.orange700, borderColor: C.orange200 };
export const badgeSlate = { backgroundColor: C.slate100, color: C.slate500, borderColor: C.slate200, fontWeight: '400' };
