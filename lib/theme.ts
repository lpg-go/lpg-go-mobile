export const colors = {
  bg: '#FAFAF9', card: '#FFFFFF', cardBorder: '#F0F0EF',
  headerBg: '#052e16', headerText: '#FFFFFF', headerSubtext: '#86efac', headerAccent: '#4ade80',
  headerSurface: 'rgba(255,255,255,0.08)', headerSurfaceBorder: 'rgba(255,255,255,0.15)',
  primary: '#16A34A', primaryDark: '#15803D', primaryTint: '#F0FDF4', primaryTintStrong: '#DCFCE7', primaryTintBorder: '#BBF7D0',
  text: '#111827', textSecondary: '#6B7280', textMuted: '#9CA3AF', textFaint: '#C4C4C0',
  border: '#E5E7EB',
  amber: '#F59E0B', amberDark: '#B45309', amberTint: '#FEF3C7', amberText: '#92400E',
  danger: '#DC2626', dangerTint: '#FEE2E2', dangerBorder: '#FCA5A5',
} as const;

export const brandTints = [
  { bg: '#DBEAFE', icon: '#185FA5' },
  { bg: '#FEE2E2', icon: '#A32D2D' },
  { bg: '#FEF3C7', icon: '#854F0B' },
  { bg: '#EDEE', icon: '#5B21B6' },
  { bg: '#FCE7F3', icon: '#9D174D' },
  { bg: '#DCFCE7', icon: '#15803D' },
] as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 18, xxl: 24, xxxl: 32 } as const;

export const radii = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;

export const typography = {
  greeting: { fontSize: 18, fontWeight: '600' as const },
  title: { fontSize: 22, fontWeight: '700' as const },
  sectionHeader: { fontSize: 18, fontWeight: '600' as const },
  cardTitle: { fontSize: 15, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  label: { fontSize: 11, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  button: { fontSize: 16, fontWeight: '600' as const },
  price: { fontSize: 17, fontWeight: '600' as const },
} as const;

export const shadows = {
  card: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  raised: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  nav: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 8 },
} as const;
