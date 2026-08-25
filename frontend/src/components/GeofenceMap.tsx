/**
 * GeofenceMap — mini-map that shows the salon's attendance geo-fence radius so
 * staff can see exactly where they are relative to the check-in area before
 * tapping "Punch In".
 *
 * Visual spec:
 *   • Fixed pin on the branch coordinates (lat/lng).
 *   • Coloured circle at `check_in_radius_m` — GREEN border when the user is
 *     inside, RED border when outside.
 *   • The user's live GPS position is drawn as a pulsing blue dot.
 *   • The whole map-box border matches the same green/red status colour so
 *     the entire card gives instant feedback.
 *
 * Why WebView + Leaflet + OSM instead of react-native-maps?
 *   • `react-native-maps` requires native code + platform-specific Google
 *     Maps API keys → won't preview in Expo Go and needs a full EAS rebuild.
 *   • Leaflet inside a WebView renders identically on iOS + Android + Web,
 *     uses free OSM tiles (no key needed), and gives us a real interactive map.
 *
 * All numbers guarded — if backend returns null lat/lng we render a graceful
 * "geofence not configured" empty state.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, shadows } from '../theme';

export type GeofenceMapProps = {
  /** Branch centre. */
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  /** Fence radius in metres — used for the coloured circle. Defaults to 100m. */
  radiusM?: number | null;
  /** Whether the backend enforces the fence for this user. */
  gatingActive?: boolean;
  /** Human-readable branch name for the marker popup. */
  branchName?: string;
  /** Bubble up the current live position + whether it's inside the fence. */
  onPosition?: (coords: { latitude: number; longitude: number; accuracy?: number } | null, insideFence: boolean) => void;
};

// Haversine distance in metres (great-circle).
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function GeofenceMap({
  latitude, longitude, radiusM, gatingActive, branchName, onPosition,
}: GeofenceMapProps) {
  const webRef = useRef<WebView>(null);
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  const [me, setMe] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [permStatus, setPermStatus] = useState<'unknown' | 'granted' | 'denied' | 'requesting'>('unknown');
  const [locError, setLocError] = useState<string | null>(null);
  // `mapReady` gates the first inject — otherwise we may try to call setMe()
  // before Leaflet's scripts have finished loading (especially on the web iframe).
  const [mapReady, setMapReady] = useState(false);

  const hasFence = typeof latitude === 'number' && typeof longitude === 'number' && !Number.isNaN(latitude) && !Number.isNaN(longitude);
  // Fence radius from backend can be anything (some tenants use 50km for demo).
  // We cap the *visual* circle at 5000m to keep the map readable — the inside/
  // outside detection still uses the real backend value.
  const fenceRadiusReal = Math.max(20, Number(radiusM || 100));
  const fenceRadius = Math.min(fenceRadiusReal, 5000);

  // ---- Permission + LIVE position watcher ------------------------------------
  const stopWatcher = () => {
    if (watchSubRef.current) {
      try { watchSubRef.current.remove(); } catch {}
      watchSubRef.current = null;
    }
  };

  const startWatcher = async () => {
    setPermStatus('requesting');
    setLocError(null);
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      let status = existing.status;
      let canAskAgain = existing.canAskAgain;
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status; canAskAgain = req.canAskAgain;
      }
      if (status !== 'granted') {
        setPermStatus('denied');
        setLocError(canAskAgain ? 'Location denied. Tap to try again.' : 'Location blocked. Open Settings to grant.');
        return;
      }
      setPermStatus('granted');

      // One-shot fix so the marker appears immediately, then start the watcher.
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMe({ latitude: first.coords.latitude, longitude: first.coords.longitude, accuracy: first.coords.accuracy || undefined });

      stopWatcher();
      watchSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 3 },
        (pos) => {
          setMe({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || undefined,
          });
        },
      );
    } catch (e: any) {
      setLocError(e?.message || 'Could not read GPS.');
      setPermStatus('denied');
    }
  };

  useEffect(() => {
    startWatcher();
    return () => stopWatcher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Inside / outside detection (uses REAL backend radius) ------------------
  const insideFence = useMemo(() => {
    if (!hasFence || !me) return false;
    const d = distanceMeters({ lat: latitude!, lng: longitude! }, { lat: me.latitude, lng: me.longitude });
    return d <= fenceRadiusReal;
  }, [hasFence, me, latitude, longitude, fenceRadiusReal]);

  const distM = useMemo(() => {
    if (!hasFence || !me) return null;
    return distanceMeters({ lat: latitude!, lng: longitude! }, { lat: me.latitude, lng: me.longitude });
  }, [hasFence, me, latitude, longitude]);

  useEffect(() => { onPosition?.(me, insideFence); }, [me, insideFence, onPosition]);

  // Status colour — drives the fence border, the map-box border and the badge.
  const statusColor = !me ? colors.brandPrimary : insideFence ? colors.success : colors.error;

  // ---- Leaflet HTML ----------------------------------------------------------
  // Rendered once; live updates happen via `injectJavaScript` so the WebView
  // doesn't reload the tiles every position tick.
  const initialHtml = useMemo(() => {
    if (!hasFence) return '';
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e5e3d8;}
  .leaflet-container{background:#e5e3d8;}
  /* Pulsing blue dot for the user's live position */
  .me-dot {
    width: 14px; height: 14px; border-radius: 50%;
    background: #2E7BFF; border: 3px solid #fff;
    box-shadow: 0 0 0 rgba(46,123,255,0.55);
    animation: pulseDot 1.6s infinite;
  }
  @keyframes pulseDot {
    0%   { box-shadow: 0 0 0 0    rgba(46,123,255,0.55); }
    70%  { box-shadow: 0 0 0 18px rgba(46,123,255,0);    }
    100% { box-shadow: 0 0 0 0    rgba(46,123,255,0);    }
  }
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
  var CENTRE = [${latitude}, ${longitude}];
  var RADIUS = ${fenceRadius};
  var map = L.map('map', { zoomControl:false, attributionControl:false, dragging:true, tap:true }).setView(CENTRE, 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  // Fence circle — colour set later via updateStatus().
  var fence = L.circle(CENTRE, { radius: RADIUS, color: '${colors.brandPrimary}', weight: 3, fillColor: '${colors.brandPrimary}', fillOpacity: 0.12 }).addTo(map);
  // Salon centre pin (branded).
  var centre = L.circleMarker(CENTRE, { radius: 6, color:'#fff', weight:2, fillColor: '${colors.brandPrimary}', fillOpacity: 1 }).addTo(map).bindPopup(${JSON.stringify(branchName || 'Salon')});

  // Pulsing user dot rendered via a divIcon so we can style it with CSS.
  var meIcon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
  var meMarker = null, meAccuracy = null;

  window.setMe = function(lat, lng, acc) {
    if (meMarker) { meMarker.setLatLng([lat, lng]); }
    else { meMarker = L.marker([lat, lng], { icon: meIcon, interactive: false }).addTo(map); }
    if (meAccuracy) { meAccuracy.setLatLng([lat, lng]); meAccuracy.setRadius(Math.max(10, acc || 20)); }
    else { meAccuracy = L.circle([lat, lng], { radius: Math.max(10, acc || 20), color:'#2E7BFF', weight:1, opacity:0.35, fillColor:'#2E7BFF', fillOpacity:0.10 }).addTo(map); }
  };

  window.updateStatus = function(color) {
    // Both the fence stroke and fill tint change to reflect inside (green) /
    // outside (red) / unknown (brand). This is the key visual signal.
    if (fence) fence.setStyle({ color: color, fillColor: color });
  };

  window.frame = function() {
    if (meMarker) {
      var g = L.featureGroup([fence, meMarker]);
      map.fitBounds(g.getBounds().pad(0.25), { animate: true });
    } else {
      map.setView(CENTRE, 16);
    }
  };

  // Signal ready so RN can push its first update.
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
</script></body></html>`;
  }, [hasFence, latitude, longitude, fenceRadius, branchName]);

  // Push new "me" positions + status colour without reloading the map.
  useEffect(() => {
    if (!hasFence || !webRef.current || !mapReady) return;
    const setMeJs = me
      ? `try { setMe(${me.latitude}, ${me.longitude}, ${Number(me.accuracy || 20)}); frame(); } catch(e){}`
      : '';
    const colourJs = `try { updateStatus(${JSON.stringify(statusColor)}); } catch(e){}`;
    webRef.current.injectJavaScript(`${setMeJs} ${colourJs} true;`);
  }, [me, hasFence, statusColor, mapReady]);

  // ---- Render ----------------------------------------------------------------
  if (!hasFence) {
    return (
      <View style={styles.wrap} testID="geofence-empty">
        <View style={styles.empty}>
          <Ionicons name="location-outline" size={26} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Salon geofence not configured.{'\n'}Ask your owner to set the branch coordinates.</Text>
        </View>
      </View>
    );
  }

  const outsideBanner = me && !insideFence && (gatingActive !== false);

  return (
    <View style={styles.wrap} testID="geofence-map">
      {/* Header pill row */}
      <View style={styles.headerRow}>
        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: gatingActive === false ? '#EEE' : colors.brandTertiary }]}>
            <Ionicons name="shield-checkmark-outline" size={12} color={gatingActive === false ? colors.onSurfaceTertiary : colors.brandPrimary} />
            <Text style={[styles.pillText, gatingActive === false && { color: colors.onSurfaceTertiary }]}>
              {gatingActive === false ? 'Fence OFF' : `Fence ${fenceRadiusReal >= 1000 ? `${(fenceRadiusReal / 1000).toFixed(1)}km` : `${Math.round(fenceRadiusReal)}m`}`}
            </Text>
          </View>
          {me && (
            <View style={[styles.pill, { backgroundColor: insideFence ? '#DDF3E4' : '#FDECEC' }]}>
              <Ionicons name={insideFence ? 'checkmark-circle' : 'alert-circle'} size={12} color={insideFence ? colors.success : colors.error} />
              <Text style={[styles.pillText, { color: insideFence ? colors.success : colors.error }]}>
                {insideFence ? 'Inside fence' : `Outside · ${Math.round(distM || 0)}m away`}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          testID="geofence-locate-btn"
          onPress={() => { Haptics.selectionAsync(); startWatcher(); }}
          style={styles.locateBtn}
          disabled={permStatus === 'requesting'}
        >
          {permStatus === 'requesting' ? (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          ) : (
            <>
              <Ionicons name="locate-outline" size={14} color={colors.brandPrimary} />
              <Text style={styles.locateBtnText}>Locate me</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Map surface — border colour reflects fence status (green/red). */}
      <View style={[styles.mapBox, { borderColor: statusColor, borderWidth: 2 }]}>
        {Platform.OS === 'web' ? (
          // react-native-webview isn't supported on the web preview; render a
          // plain <iframe> with the same Leaflet HTML so the map still shows
          // in the browser preview. Native builds fall through to WebView.
          React.createElement('iframe', {
            title: 'geofence-map',
            srcDoc: initialHtml,
            style: { border: 0, width: '100%', height: '100%', background: '#e5e3d8' },
            ref: (el: any) => {
              // Push live-position updates by calling the functions we exposed
              // on `window` inside the iframe HTML (setMe / updateStatus / frame).
              (webRef as any).current = {
                injectJavaScript: (_js: string) => {
                  try {
                    const w: any = el?.contentWindow;
                    if (!w) return;
                    if (me && typeof w.setMe === 'function') w.setMe(me.latitude, me.longitude, Number(me.accuracy || 20));
                    if (typeof w.updateStatus === 'function') w.updateStatus(statusColor);
                    if (typeof w.frame === 'function') w.frame();
                  } catch {}
                },
              };
            },
            onLoad: () => setMapReady(true),
          })
        ) : (
          <WebView
            ref={webRef}
            testID="geofence-webview"
            source={{ html: initialHtml }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            scrollEnabled={false}
            style={styles.webview}
            allowsInlineMediaPlayback
            startInLoadingState
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (msg?.type === 'ready') setMapReady(true);
              } catch {}
            }}
            onLoadEnd={() => setMapReady(true)}
            renderLoading={() => (
              <View style={styles.mapLoading}>
                <ActivityIndicator color={colors.brandPrimary} />
                <Text style={styles.mapLoadingText}>Loading map…</Text>
              </View>
            )}
          />
        )}
      </View>

      {/* Outside-fence banner */}
      {outsideBanner ? (
        <View style={styles.outsideBanner} testID="geofence-outside-banner">
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={styles.outsideBannerText} numberOfLines={2}>
            You&apos;re {Math.round(distM || 0)}m from the salon — punch-in will be rejected until you&apos;re inside the {fenceRadiusReal >= 1000 ? `${(fenceRadiusReal / 1000).toFixed(1)}km` : `${Math.round(fenceRadiusReal)}m`} fence.
          </Text>
        </View>
      ) : null}

      {/* Permission-denied hint */}
      {permStatus === 'denied' && locError ? (
        <TouchableOpacity onPress={startWatcher} style={styles.errBanner} testID="geofence-perm-denied">
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={styles.errBannerText}>{locError}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  pillRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: 11, fontWeight: '800', color: colors.brandPrimary, letterSpacing: 0.3 },
  locateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.brandSecondary, backgroundColor: colors.surface,
    minWidth: 90, justifyContent: 'center',
  },
  locateBtnText: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary },
  mapBox: {
    height: 200, borderRadius: radius.md, overflow: 'hidden',
    borderWidth: 2, backgroundColor: '#e5e3d8',
    ...shadows.card,
  },
  webview: { flex: 1, backgroundColor: '#e5e3d8', ...Platform.select({ web: { minHeight: 200 } as any, default: {} }) },
  mapLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#e5e3d8' },
  mapLoadingText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: '600' },

  outsideBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: radius.sm, backgroundColor: '#FDECEC', borderWidth: 1, borderColor: '#F5C4C4' },
  outsideBannerText: { flex: 1, fontSize: 12, color: colors.error, fontWeight: '600', lineHeight: 16 },

  errBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: radius.sm, backgroundColor: '#FFF6E0', borderWidth: 1, borderColor: '#F4C77E' },
  errBannerText: { flex: 1, fontSize: 11, color: '#B8860B', fontWeight: '700' },

  empty: { alignItems: 'center', gap: 8, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  emptyText: { fontSize: 12, color: colors.onSurfaceTertiary, textAlign: 'center' },
});
