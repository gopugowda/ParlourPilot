import { colors } from '@/src/theme';

/**
 * Shared types + constants for the Appointments feature.
 *
 * Keeping types in one place lets the screen, list row, editor, filter
 * sheet, and Send-Confirmation sheet all agree on the exact wire shape
 * that the backend returns. If the API adds a field, this is the ONE
 * place to update — every component picks it up automatically.
 */
export type Appointment = {
  id: string;
  customer_name: string;
  customer_phone?: string;
  member_id?: string | null;
  beautician_id?: string | null;
  beautician_name?: string;
  service_ids?: string[];
  service_names?: string[];
  scheduled_start: string;
  scheduled_end?: string;
  duration_minutes: number;
  status: 'booked' | 'in_progress' | 'completed' | 'canceled' | 'no_show';
  notes?: string;
  price_estimate?: number;
};

export type Beautician = { id: string; name: string };
export type Service = { id: string; name: string; price: number; duration_minutes?: number };

export const STATUS_ORDER = ['booked', 'in_progress', 'completed', 'canceled', 'no_show'] as const;

export const STATUS_META: Record<string, { label: string; color: string }> = {
  booked:      { label: 'Booked',      color: colors.info },
  in_progress: { label: 'In progress', color: colors.warning },
  completed:   { label: 'Completed',   color: colors.success },
  canceled:    { label: 'Canceled',    color: colors.onSurfaceTertiary },
  no_show:     { label: 'No-show',     color: colors.error },
};
