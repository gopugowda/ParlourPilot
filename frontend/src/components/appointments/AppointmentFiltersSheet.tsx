import React from 'react';
import { View, TextInput } from 'react-native';
import { colors } from '@/src/theme';
import { FilterSheet, FilterSection, FilterChip } from '@/src/components/FilterSheet';
import { styles } from './styles';
import { Appointment, Beautician, STATUS_ORDER, STATUS_META } from './types';

/**
 * Filter panel for the appointments list.
 *
 * Kept as a thin wrapper around the generic FilterSheet so that all the
 * appointment-specific facets (stylist, status, date range) live in one
 * place and can evolve independently of the screen.
 */
type Filters = {
  stylistId: string | null;
  status: Appointment['status'] | null;
  dateFrom: string | null;
  dateTo: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onClear: () => void;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  beauticians: Beautician[];
};

export default function AppointmentFiltersSheet({
  visible, onClose, onClear, filters, setFilters, beauticians,
}: Props) {
  return (
    <FilterSheet
      visible={visible}
      onClose={onClose}
      onClear={onClear}
      title="Filter appointments"
      testID="apt-filter-sheet"
    >
      <FilterSection label="Stylist">
        <FilterChip
          label="Any"
          selected={!filters.stylistId}
          onPress={() => setFilters({ stylistId: null })}
          testID="apt-fs-stylist-any"
        />
        {beauticians.map(b => (
          <FilterChip
            key={b.id}
            label={b.name}
            selected={filters.stylistId === b.id}
            onPress={() => setFilters({ stylistId: b.id })}
            testID={`apt-fs-stylist-${b.id}`}
          />
        ))}
      </FilterSection>

      <FilterSection label="Status">
        <FilterChip
          label="Any"
          selected={!filters.status}
          onPress={() => setFilters({ status: null })}
          testID="apt-fs-status-any"
        />
        {STATUS_ORDER.map(s => (
          <FilterChip
            key={s}
            label={STATUS_META[s]?.label || s}
            selected={filters.status === s}
            onPress={() => setFilters({ status: s })}
            testID={`apt-fs-status-${s}`}
          />
        ))}
      </FilterSection>

      <FilterSection label="Date range (YYYY-MM-DD)">
        <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
          <TextInput
            placeholder="From"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={filters.dateFrom || ''}
            onChangeText={(v) => setFilters({ dateFrom: v || null })}
            style={styles.filterInput}
          />
          <TextInput
            placeholder="To"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={filters.dateTo || ''}
            onChangeText={(v) => setFilters({ dateTo: v || null })}
            style={styles.filterInput}
          />
        </View>
      </FilterSection>
    </FilterSheet>
  );
}
