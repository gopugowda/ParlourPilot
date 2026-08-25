/**
 * Legacy route — the "Staff Performance" screen was merged into the richer
 * Payroll & Performance dashboard at `/manage/payroll-report`. This file
 * exists only to keep older deep-links working.
 */
import { Redirect } from 'expo-router';

export default function StaffPerformanceRedirect() {
  return <Redirect href="/manage/payroll-report" />;
}
