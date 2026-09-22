/**
 * Custom Expo config plugin for `react-native-image-crop-picker`.
 *
 * The library ships native code (uCrop on Android, TOCropViewController on iOS)
 * but does NOT provide an official Expo config plugin. Without this plugin the
 * prebuild step wouldn't add:
 *
 *   • iOS: NSCameraUsageDescription, NSPhotoLibraryUsageDescription
 *   • Android: android.permission.CAMERA in the merged manifest
 *   • Android: JitPack repo (some transitive deps live there)
 *
 * Reference: ivpusic/react-native-image-crop-picker discussion #1675 — this
 * is the community-standard config plugin for SDK 51+.
 *
 * NOTE: expo-image-picker already declares the camera permission, so this
 * plugin is defensive — it re-adds the same declaration under our full
 * control so nothing downstream can strip it (a bug we hit before with
 * expo-image-picker's `tools:node="remove"` directive on old versions).
 */
const {
  withPlugins,
  withProjectBuildGradle,
  withAndroidManifest,
  withInfoPlist,
} = require('@expo/config-plugins');
const { addPermission } = require('@expo/config-plugins/build/android/Permissions');

const withInfo = (config, { photoText, cameraText } = {}) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.NSCameraUsageDescription =
      cameraText ||
      cfg.modResults.NSCameraUsageDescription ||
      'Scan product labels to auto-fill stock';
    cfg.modResults.NSPhotoLibraryUsageDescription =
      photoText ||
      cfg.modResults.NSPhotoLibraryUsageDescription ||
      'Attach photos to stock items and expense receipts';
    return cfg;
  });

const withAndroidCameraPermission = (config) =>
  withAndroidManifest(config, async (cfg) => {
    addPermission(cfg.modResults, 'android.permission.CAMERA');
    return cfg;
  });

// react-native-image-crop-picker's uCrop dependency historically pulls a
// couple of artefacts from JitPack. Adding the repo is a no-op if it's
// already present.
const withJitpack = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      if (!cfg.modResults.contents.includes('jitpack.io')) {
        cfg.modResults.contents = cfg.modResults.contents.replace(
          /allprojects\s*{\s*repositories\s*{/,
          "allprojects {\n    repositories {\n        maven { url 'https://www.jitpack.io' }",
        );
      }
    }
    return cfg;
  });

module.exports = (config, props) =>
  withPlugins(config, [
    [withInfo, props || {}],
    withAndroidCameraPermission,
    withJitpack,
  ]);
