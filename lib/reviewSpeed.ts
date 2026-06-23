export type DeliverySpeed = 'very_fast' | 'fast' | 'average' | 'slow';

export const DELIVERY_SPEED_OPTIONS: { value: DeliverySpeed; label: string }[] = [
  { value: 'very_fast', label: 'Very Fast' },
  { value: 'fast', label: 'Fast' },
  { value: 'average', label: 'Average' },
  { value: 'slow', label: 'Slow' },
];

export function speedLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const found = DELIVERY_SPEED_OPTIONS.find((o) => o.value === value);
  return found ? found.label : null;
}
