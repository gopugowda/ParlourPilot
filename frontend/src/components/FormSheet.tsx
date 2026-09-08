/**
 * FormSheet — the standard bottom-sheet Modal used throughout the app.
 *
 * Why this component exists:
 *   The previous pattern (Modal + backdrop Pressable + KeyboardAvoidingView
 *   + inner Pressable sheet) has a well-documented Android bug — the
 *   sheet does NOT move when the keyboard opens because
 *   `KeyboardAvoidingView behavior="padding"` is a no-op on Android.
 *   Users see the input hidden behind the keyboard (Samsung S24 numeric
 *   pad overlapping the Current Qty field, etc.).
 *
 * What this component does:
 *   • Wraps the modal in a KeyboardProvider-aware KeyboardAwareScrollView
 *     from `react-native-keyboard-controller`.
 *   • Automatically scrolls the currently focused TextInput above the
 *     keyboard on both iOS and Android.
 *   • Preserves the existing tap-outside-to-close + rounded-top look.
 *
 * Migration usage:
 *   Replace:
 *     <Modal visible={x} transparent animationType="slide" onRequestClose={close}>
 *       <Pressable style={styles.backdrop} onPress={close}>
 *         <KeyboardAvoidingView behavior={ios?'padding':undefined}>
 *           <Pressable style={styles.sheet}>
 *             <View style={styles.handle} />
 *             ...form fields...
 *           </Pressable>
 *         </KeyboardAvoidingView>
 *       </Pressable>
 *     </Modal>
 *
 *   With:
 *     <FormSheet visible={x} onClose={close} title="…">
 *       ...form fields...
 *     </FormSheet>
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, View, Text, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { colors, spacing, radius } from '@/src/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Extra spacing between the focused input and the top of the keyboard. */
  bottomOffset?: number;
  /** Optional style override for the outer sheet card. */
  sheetStyle?: ViewStyle;
  /** Optional inner padding override. */
  contentStyle?: ViewStyle;
  /** Optional right-side header slot (e.g. a Save chip). */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

export function FormSheet({
  visible, onClose, title, bottomOffset = 24,
  sheetStyle, contentStyle, headerRight, children,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, sheetStyle]} onPress={() => {}}>
          <View style={styles.handle} />
          {(title || headerRight) && (
            <View style={styles.headerRow}>
              {title ? <Text style={styles.title}>{title}</Text> : <View style={{ flex: 1 }} />}
              {headerRight}
            </View>
          )}
          <KeyboardAwareScrollView
            bottomOffset={bottomOffset}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              { paddingBottom: spacing.xl, gap: spacing.md },
              contentStyle,
            ]}
          >
            {children}
          </KeyboardAwareScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    maxHeight: '92%',
    width: '100%', maxWidth: 480, alignSelf: 'center',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: spacing.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
});
