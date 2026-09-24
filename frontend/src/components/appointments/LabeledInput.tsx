import React from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';
import { colors } from '@/src/theme';
import { styles } from './styles';

/**
 * Tiny form primitive used throughout the appointment editor:
 * a light label above a standard text input. Kept as its own file so
 * unrelated screens can reuse the exact same visual language without
 * pulling in the entire editor module.
 */
type Props = TextInputProps & { label: string };

export default function LabeledInput({ label, style, ...rest }: Props) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.onSurfaceTertiary}
        {...rest}
      />
    </View>
  );
}
