import { useColorScheme } from 'react-native';

const palette = {
  light: {
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF1F6',
    border: '#DFE3EA',
    text: '#111827',
    textMuted: '#6B7280',
    accent: '#2563EB',
    debit: '#DC2626',
    credit: '#059669',
    warn: '#B45309',
  },
  dark: {
    bg: '#0B0F14',
    surface: '#151B23',
    surfaceAlt: '#1E2632',
    border: '#2A3441',
    text: '#F3F4F6',
    textMuted: '#94A3B8',
    accent: '#60A5FA',
    debit: '#F87171',
    credit: '#34D399',
    warn: '#FBBF24',
  },
};

export type Theme = typeof palette.light;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export function formatMoney(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₹${formatted}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
