/**
 * BarcodeScanner — full-screen camera modal that returns a single
 * barcode value + type back to the caller. Kept intentionally
 * lightweight and re-usable so other modules (billing, cash closing,
 * etc.) can adopt it later without a rewrite.
 *
 * Design decisions:
 *   • Uses expo-camera (SDK 54) — bundled with Expo Go for camera
 *     scanning. NO extra native module is required just for the
 *     barcode part; a dev build is only needed for the OCR helper
 *     (see ocr.ts).
 *   • Debounces detected codes: once a valid code is captured the
 *     scanner locks (`lockedRef`) so we never fire 10 API calls
 *     while the barcode stays in view.
 *   • Permission is only requested when this modal opens — not on
 *     app launch. If the user denies twice we surface an "Open
 *     Settings" button (matches the app's location-permission UX).
 *   • Torch toggle where the device supports it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius } from '@/src/theme';

/** Retail + QR formats supported by expo-camera on both platforms. */
const BARCODE_TYPES = [
  'ean13', 'ean8', 'upc_a', 'upc_e',
  'code128', 'code39', 'code93', 'codabar', 'itf14',
  'qr', 'pdf417', 'aztec', 'datamatrix',
] as const;

type OnScanned = (result: { value: string; type: string }) => void;

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: OnScanned;
  /** Copy shown under the scan frame. */
  hint?: string;
  /** Optional caption above the frame (e.g. "New Product"). */
  title?: string;
};

export function BarcodeScanner({ visible, onClose, onScanned, hint, title }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // A ref (not state) — we do NOT want a re-render every time a frame
  // detects the same barcode. The lock is released when the modal is
  // reopened.
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      lockedRef.current = false;
      setTorch(false);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handleScanned = useCallback((res: BarcodeScanningResult) => {
    if (lockedRef.current) return;
    const raw = (res?.data || '').trim();
    if (!raw) return;
    lockedRef.current = true;
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    onScanned({ value: raw, type: String(res?.type || 'unknown') });
  }, [onScanned]);

  const renderBody = () => {
    if (!permission) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={44} color={colors.onSurfaceTertiary} />
          <Text style={styles.permTitle}>Camera permission needed</Text>
          <Text style={styles.permBody}>
            Grant access so ParlourPilot can scan product barcodes. We only turn on the camera on this screen.
          </Text>
          <View style={styles.permBtnRow}>
            {permission.canAskAgain ? (
              <TouchableOpacity style={[styles.permBtn, styles.permBtnPrimary]} onPress={requestPermission}>
                <Text style={styles.permBtnPrimaryText}>Allow camera</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.permBtn, styles.permBtnPrimary]} onPress={() => Linking.openSettings()}>
                <Text style={styles.permBtnPrimaryText}>Open Settings</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.permBtn]} onPress={onClose}>
              <Text style={styles.permBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return (
      <>
        <CameraView
          testID="barcode-camera"
          style={StyleSheet.absoluteFillObject}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] as any }}
          onBarcodeScanned={visible ? handleScanned : undefined}
        />
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.frame} />
          <Text style={styles.hint}>{hint || 'Point the camera at a product barcode.'}</Text>
        </View>
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {renderBody()}

        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={styles.circleBtn} testID="scanner-close">
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          {!!title && <Text style={styles.title}>{title}</Text>}
          {permission?.granted ? (
            <TouchableOpacity onPress={() => setTorch(t => !t)} style={styles.circleBtn} testID="scanner-torch">
              <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color="#fff" />
            </TouchableOpacity>
          ) : <View style={styles.circleBtn} />}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const FRAME = 260;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: FRAME, height: FRAME * 0.6,
    borderWidth: 2, borderColor: '#fff', borderRadius: radius.md,
    backgroundColor: 'transparent',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8,
  },
  hint: { marginTop: spacing.lg, color: '#fff', fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.xl, opacity: 0.9 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    justifyContent: 'space-between',
  },
  title: { color: '#fff', fontSize: 14, fontWeight: '800', flex: 1, textAlign: 'center' },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  permTitle: { fontSize: 16, fontWeight: '800', color: colors.onSurface, marginTop: spacing.sm, textAlign: 'center' },
  permBody: { fontSize: 13, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.md },
  permBtnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
  permBtn: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  permBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  permBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  permBtnText: { color: colors.onSurface, fontWeight: '600', fontSize: 13 },
});
