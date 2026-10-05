import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HoldButton, PositionBar, RepeatButton, ScrubChip, ZoomRocker, type ScrubOption } from '@/components/Controls';
import { LiveView } from '@/components/LiveView';
import { WheelSheet, type Wheel } from '@/components/WheelSheet';
import { aspectRatio, formatEv, rollToDegrees, rotateArea, unrotatePoint, type CameraChanges, type CameraState, type PhotoItem } from '@/lib/camera';
import { ThumbImage } from '@/components/ThumbImage';
import { useCamera } from '@/lib/CameraProvider';
import {
  APERTURES,
  SHUTTER_SPEEDS,
  driveModeName,
  focusModeName,
  modeBadge,
  orderSceneModes,
  sceneModeName,
  whiteBalanceName,
} from '@/lib/labels';
import { colors } from '@/lib/theme';

const STATE_POLL_MS = 1000;
/** How often the newest photo is checked, to follow how the camera was held for it. */
const LATEST_POLL_MS = 4000;

/** Clockwise turn that shows a photo upright, from its EXIF orientation. */
function exifRotation(orientation: number) {
  return orientation === 6 ? 90 : orientation === 3 ? 180 : orientation === 8 ? 270 : 0;
}
/**
 * Phone held sideways: the live view fills the height, settings lie over its bottom edge like the
 * camera's own display, and a narrow capture column sits at the right edge. When the camera itself
 * is held vertically the live view is too narrow for the overlay, so settings get a side panel.
 */
const CAPTURE_COLUMN_W = 92;
/** Room kept for the side panel before sizing a vertical-camera live view. */
const SIDE_PANEL_W = 300;
const MIN_OVERLAY_W = 520;
const DIAL_COLUMNS = 4;
const DIAL_MARGIN = 12;
/** Heights reserved under the live view on an upright phone (approximate, generous). */
const PORTRAIT_DIAL_H = 200;
const PORTRAIT_FOCUS_H = 52;
const PORTRAIT_CAPTURE_H = 106;
const TAB_BAR_H = 50;

type Sheet = { title: string; wheels: Wheel[]; toChanges: (changed: Record<string, string>) => CameraChanges };
type AfState = 'idle' | 'focusing' | 'focused' | 'failed';

export default function ShootScreen() {
  const { client, connected, info } = useCamera();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<CameraState | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [af, setAf] = useState<AfState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [latest, setLatest] = useState<PhotoItem | null>(null);
  // The α5000 has no tilt sensor apps can read, but each photo records how the camera was held:
  // the live view follows the latest shot, and a button turns it by hand
  const [manualRotation, setManualRotation] = useState(0);
  const latestId = useRef<number | null>(null);

  // Keep the settings in sync with the camera (its own dials can change them too)
  useFocusEffect(
    useCallback(() => {
      if (!connected) return;
      let cancelled = false;
      const poll = () => client.state().then((s) => !cancelled && setState(s), () => {});
      poll();
      const timer = setInterval(poll, STATE_POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [client, connected]),
  );

  const refreshLatest = useCallback(() => {
    client.photos(0, 1).then((list) => {
      const item = list.items[0] ?? null;
      setLatest(item);
      if (item && item.id !== latestId.current) {
        latestId.current = item.id;
        client.photo(item.id).then((d) => setManualRotation(exifRotation(d.orientation)), () => {});
      }
    }, () => {});
  }, [client]);

  // Also catches shots taken with the camera's own shutter button
  useFocusEffect(
    useCallback(() => {
      if (!connected) return;
      refreshLatest();
      const timer = setInterval(refreshLatest, LATEST_POLL_MS);
      return () => clearInterval(timer);
    }, [connected, refreshLatest]),
  );

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const apply = async (changes: CameraChanges) => {
    setBusy(true);
    try {
      setState(await client.apply(changes));
    } catch (e) {
      flash(`설정 실패: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const shoot = async () => {
    if (shooting) return;
    setShooting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await client.shoot();
      if (result.status === 'ok') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // The index needs a moment to list the new file
        setTimeout(refreshLatest, 800);
      } else {
        flash(`촬영 실패 (${result.status})`);
      }
    } catch (e) {
      flash(`촬영 실패: ${String(e)}`);
    } finally {
      setShooting(false);
      setAf('idle'); // a shot releases a held half-press
    }
  };

  const halfPressStart = () => {
    setAf('focusing');
    Haptics.selectionAsync();
    client.focus('start').then(
      (r) => {
        setAf(r.focused ? 'focused' : 'failed');
        if (r.focused) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      () => setAf('failed'),
    );
  };

  const halfPressEnd = () => {
    setAf('idle');
    client.focus('stop').catch(() => {});
  };

  const s = state;
  // Where the camera can report how it's held (not this model), that wins
  const cameraKnowsOrientation = s?.orientation !== undefined && s.orientation >= 0;
  const rotation = cameraKnowsOrientation ? s!.orientation! : s?.roll !== undefined && s.roll >= 0 ? rollToDegrees(s.roll) : manualRotation;
  const frameAspect = aspectRatio(s?.imageAspect);
  const liveAspect = rotation === 90 || rotation === 270 ? 1 / frameAspect : frameAspect;
  const landscape = width > height;

  // Live view as large as fits: full width when upright, capped height when the camera is sideways
  const landscapeW = width - CAPTURE_COLUMN_W - insets.left - insets.right;
  const landscapeH = height - insets.top - insets.bottom;
  const overlay = landscape && fit(landscapeW, landscapeH, liveAspect).width >= MIN_OVERLAY_W;
  // Upright phone: the live view gets what the dial, manual-focus row, capture bar and tab bar leave
  const portraitControlsH =
    PORTRAIT_DIAL_H + (s?.focusMode === 'manual' ? PORTRAIT_FOCUS_H : 0) + PORTRAIT_CAPTURE_H + TAB_BAR_H;
  const liveBox = landscape
    ? fit(overlay ? landscapeW : landscapeW - SIDE_PANEL_W, landscapeH, liveAspect)
    : fit(width, height - insets.top - insets.bottom - portraitControlsH, liveAspect);
  // Sideways with a vertical camera, the side panel takes whatever the narrow live view leaves
  const panelW = landscape ? landscapeW - liveBox.width : width - insets.left - insets.right;

  const open = (next: Sheet) => setSheet(next);

  /**
   * The settings as an exposure display: shutter, aperture, ISO, EV on the first row, the rest
   * below, divided by hairlines. {@code strip}: one row laid over the live view instead.
   */
  const dial = (strip: boolean) => {
    if (!s) return null;
    const list = settingsFor(s);
    const columns = strip ? list.length : DIAL_COLUMNS;
    // Inside the panel's margins and hairline border; floor so rounding never wraps the last cell
    const available = strip ? liveBox.width : panelW - DIAL_MARGIN * 2 - StyleSheet.hairlineWidth * 2;
    const cellW = Math.floor((available / columns) * 10) / 10;
    return (
      <View style={strip ? styles.strip : styles.dial}>
        {list.map((setting, i) => (
          <ScrubChip
            key={setting.key}
            label={setting.label}
            options={setting.options}
            current={setting.current}
            display={setting.display}
            disabled={setting.disabled}
            compact={strip}
            onCommit={(value) => apply(setting.toChanges(value))}
            onPress={() =>
              open(
                setting.sheet ?? {
                  title: setting.title ?? setting.label,
                  wheels: [{ key: setting.key, options: setting.options, value: setting.current }],
                  toChanges: (c) => setting.toChanges(c[setting.key]),
                },
              )
            }
            style={{
              width: cellW,
              borderColor: colors.hairline,
              borderLeftWidth: i % columns === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopWidth: i < columns ? 0 : StyleSheet.hairlineWidth,
            }}
          />
        ))}
      </View>
    );
  };

  const focusDriveButton = (direction: 'near' | 'far', compact: boolean) => (
    <RepeatButton
      label={direction === 'near' ? '초점 가깝게' : '초점 멀게'}
      onRepeat={() => client.focusDrive(direction).catch(() => {})}
      style={compact ? styles.focusButtonCompact : styles.focusButton}>
      <Ionicons name={direction === 'near' ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.text} />
    </RepeatButton>
  );

  // Manual focus: near / position / far in one slim row
  const manualFocus = (compact: boolean) =>
    s?.focusMode === 'manual' && (
      <View style={compact ? styles.focusOverlay : styles.focusRow}>
        {s.focusDriveSupported && focusDriveButton('near', compact)}
        <View style={styles.focusBar}>
          {s.focusMaxPosition && s.focusMaxPosition > 0 ? (
            <PositionBar fraction={(s.focusPosition ?? 0) / s.focusMaxPosition} left="가깝게" right="멀게" />
          ) : (
            <Text style={styles.focusHint}>MF · 렌즈의 초점 링으로 맞추세요</Text>
          )}
        </View>
        {s.focusDriveSupported && focusDriveButton('far', compact)}
        {magnifierButton(compact)}
      </View>
    );

  const zoom = (direction: 'tele' | 'wide' | 'stop') => client.zoom(direction).catch(() => {});
  // Zoom slider: only for power zoom lenses, which report a range
  const zoomRange = s?.zoom && s.zoom.max > 100 ? s.zoom : null;
  const zoomFraction = zoomRange ? (zoomRange.magnification - 100) / (zoomRange.max - 100) : 0;
  const zoomTo = zoomRange ? (f: number) => client.zoomTo(f).catch(() => {}) : undefined;

  // Focus magnifier: the button steps through the camera's levels; while on, a tap on the live
  // view moves the magnified window toward that point
  const magnifier = s?.magnifier;
  const magnify = (action: 'cycle' | 'pan', dx = 0, dy = 0) =>
    client
      .magnify(action, dx, dy)
      .then((m) => setState((prev) => prev && { ...prev, magnifier: m }))
      .catch(() => {});
  const magnifierButton = (compact: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="초점 확대"
      onPress={() => magnify('cycle')}
      style={({ pressed }) => [
        compact ? styles.focusButtonCompact : styles.focusButton,
        magnifier?.on && styles.magnifierOn,
        pressed && { opacity: 0.7 },
      ]}>
      {magnifier?.on ? (
        <Text style={styles.magnifierText}>×{magnifier.factor.toFixed(1)}</Text>
      ) : (
        <Ionicons name="search" size={17} color={colors.text} />
      )}
    </Pressable>
  );
  const magnifierTap =
    magnifier?.on &&
    connected && (
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityLabel="확대 위치 옮기기"
        onPress={(e) => {
          const p = unrotatePoint(e.nativeEvent.locationX / liveBox.width, e.nativeEvent.locationY / liveBox.height, rotation);
          magnify('pan', p.x - 0.5, p.y - 0.5);
        }}
      />
    );

  const afColor = af === 'focused' ? colors.ok : af === 'failed' ? colors.danger : 'rgba(255,255,255,0.7)';
  const afButton = (
    <HoldButton
      label="반셔터 (누르고 있으면 초점 고정)"
      onStart={halfPressStart}
      onStop={halfPressEnd}
      disabled={!connected}
      style={{ ...styles.af, borderColor: afColor }}
      pressedStyle={styles.afPressed}>
      {af === 'focusing' ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <Text style={[styles.afLabel, { color: af === 'idle' ? colors.text : afColor }]}>AF</Text>
      )}
    </HoldButton>
  );

  const shutter = (
    <Pressable
      style={[styles.shutterRing, !connected && styles.disabled]}
      onPress={shoot}
      disabled={!connected}
      accessibilityRole="button"
      accessibilityLabel="셔터">
      {({ pressed }) => (
        <View style={[styles.shutterDisc, (pressed || shooting) && styles.shutterDiscPressed]}>
          {shooting && <ActivityIndicator color="#000" />}
        </View>
      )}
    </Pressable>
  );

  const latestThumb = (
    <Pressable style={styles.thumb} onPress={() => router.push('/gallery')} accessibilityLabel="최근 사진, 갤러리 열기">
      {latest ? (
        <ThumbImage client={client} item={latest} style={styles.thumbImage} />
      ) : (
        <Ionicons name="images-outline" size={20} color={colors.textDim} />
      )}
    </Pressable>
  );

  const statusPill = (
    <View style={styles.statusPill} pointerEvents="none">
      <View style={[styles.dot, { backgroundColor: connected ? colors.ok : colors.danger }]} />
      <Text style={styles.statusText} numberOfLines={1}>
        {connected ? info?.model : '연결 안 됨'}
      </Text>
      {/* Battery and shots left, as on the camera's own screen */}
      {connected && s?.battery !== undefined && s.battery >= 0 && (
        <View style={styles.statusItem}>
          <Ionicons
            name={s.battery > 60 ? 'battery-full' : s.battery > 15 ? 'battery-half' : 'battery-dead'}
            size={15}
            color={s.battery > 15 ? colors.text : colors.danger}
          />
          <Text style={[styles.statusText, s.battery <= 15 && { color: colors.danger }]}>{s.battery}%</Text>
        </View>
      )}
      {connected && s?.shotsLeft !== undefined && s.shotsLeft >= 0 && (
        <Text style={styles.statusText}>{s.shotsLeft}장</Text>
      )}
      {busy && <ActivityIndicator size="small" color={colors.accent} style={styles.busy} />}
    </View>
  );

  // AF-S / AF-C / DMF / MF, green while a half-press holds focus, red if it couldn't focus
  const focusBadge = s && (
    <View
      style={[styles.focusBadge, af === 'focused' && styles.focusBadgeOk, af === 'failed' && styles.focusBadgeFail]}
      pointerEvents="none">
      <Text style={styles.focusBadgeText}>{focusModeName(s.focusMode, s.afMode)}</Text>
    </View>
  );

  // Green frames where the camera found focus (orange when it couldn't confirm it)
  const afLocked = s?.af && (s.af.status === 'lock' || s.af.status === 'warn');
  const afFrames =
    afLocked &&
    s.af!.areas.map((area, i) => {
      const r = rotateArea(area, rotation);
      return (
        <View
          key={i}
          pointerEvents="none"
          style={[
            styles.afFrame,
            s.af!.status === 'warn' && styles.afFrameWarn,
            { left: r.x * liveBox.width, top: r.y * liveBox.height, width: r.w * liveBox.width, height: r.h * liveBox.height },
          ]}
        />
      );
    });

  const live = (
    <View style={liveBox}>
      {connected ? (
        <LiveView url={client.liveViewUrl()} rotation={rotation} style={liveBox} />
      ) : (
        <Pressable style={[styles.offline, liveBox]} onPress={() => router.push('/settings')} accessibilityRole="button">
          <Ionicons name="wifi-outline" size={30} color={colors.textDim} />
          <Text style={styles.offlineTitle}>카메라에 연결되지 않았어요</Text>
          <Text style={styles.offlineHint}>
            카메라에서 ILCE Remote를 실행하고, 폰을 카메라 Wi-Fi(또는 같은 네트워크)에 연결하세요. 눌러서 주소 설정
          </Text>
        </Pressable>
      )}
      {!magnifier?.on && afFrames}
      {magnifierTap}
      {/* Sideways the capture column has no room for it; the live view's top right is free */}
      {landscape && overlay && (
        <View style={styles.zoomCornerTop}>
          <ZoomRocker onZoom={zoom} onTarget={zoomTo} fraction={zoomFraction} disabled={!connected} />
        </View>
      )}
      {connected && !cameraKnowsOrientation && (
        <Pressable
          // Top right, clear of the zoom control (which sits there itself when sideways)
          style={[styles.rotateButton, landscape && overlay && { top: 58 }]}
          onPress={() => setManualRotation((r) => (r + 90) % 360)}
          accessibilityRole="button"
          accessibilityLabel="라이브뷰 돌리기">
          <Ionicons name="refresh" size={18} color={colors.text} />
        </Pressable>
      )}
      <View style={styles.statusCorner}>
        {statusPill}
        {focusBadge}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={landscape ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}>
      {landscape ? (
        <View style={styles.landscape}>
          {overlay ? (
            <View style={styles.liveArea}>
              <View style={liveBox}>
                {live}
                <View style={styles.bottomOverlay}>
                  {manualFocus(true)}
                  {dial(true)}
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.liveArea}>{live}</View>
              <ScrollView style={{ width: panelW }} contentContainerStyle={styles.panel}>
                {/* A vertical camera's live view is too narrow to hold the zoom control */}
                <View style={styles.panelZoom}>
                  <ZoomRocker onZoom={zoom} onTarget={zoomTo} fraction={zoomFraction} disabled={!connected} />
                </View>
                {dial(false)}
                {manualFocus(false)}
              </ScrollView>
            </>
          )}
          {/* Always reachable, like the shutter side of a camera app */}
          <View style={[styles.captureColumn, { width: CAPTURE_COLUMN_W }]}>
            {afButton}
            {shutter}
            {latestThumb}
          </View>
        </View>
      ) : (
        <View style={styles.portraitRoot}>
          {/* The live view is centred in whatever the controls below leave */}
          <View style={[styles.liveArea, styles.portraitLive]}>
            <View style={liveBox}>
              {live}
              <View style={styles.zoomCorner}>
                <ZoomRocker onZoom={zoom} onTarget={zoomTo} fraction={zoomFraction} disabled={!connected} />
              </View>
            </View>
          </View>
          <View style={styles.portraitControls}>
            {dial(false)}
            {manualFocus(false)}
          </View>
          {/* The shutter stays put while the settings scroll */}
          <View style={styles.captureBar}>
            {latestThumb}
            {shutter}
            {afButton}
          </View>
        </View>
      )}

      {message && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{message}</Text>
        </View>
      )}

      {sheet && (
        <WheelSheet
          title={sheet.title}
          wheels={sheet.wheels}
          onDone={(changed) => apply(sheet.toChanges(changed))}
          onClose={() => setSheet(null)}
        />
      )}
    </SafeAreaView>
  );
}

type Setting = {
  key: string;
  label: string;
  /** Wheel drawer title, if different from the label. */
  title?: string;
  options: ScrubOption[];
  current: string;
  display?: string;
  disabled?: boolean;
  toChanges: (value: string) => CameraChanges;
  /** Custom drawer (white balance has several wheels). */
  sheet?: Sheet;
};

function settingsFor(s: CameraState): Setting[] {
  const drive = s.driveModeValues.filter((d) => d !== 'bracket').map((d) => ({ value: `${d}/0`, label: driveModeName(d) }));
  for (const t of s.selfTimerValues ?? []) {
    if (t > 0) drive.push({ value: `single/${t}`, label: driveModeName('single', t) });
  }
  const timer = s.selfTimer ?? 0;
  return [
    {
      key: 'shutter',
      label: '셔터',
      title: '셔터 속도',
      options: withCurrent(SHUTTER_SPEEDS, s.shutterText).map(same),
      current: s.shutterText,
      disabled: !(s.mode === 'manual' || s.mode === 'shutter'),
      toChanges: (v) => ({ shutter: v }),
    },
    {
      key: 'aperture',
      label: '조리개',
      options: withCurrent(APERTURES.map(String), String(s.aperture)).map((v) => ({ value: v, label: `F${v}` })),
      current: String(s.aperture),
      display: s.aperture > 0 ? `F${s.aperture}` : '--',
      disabled: !(s.mode === 'manual' || s.mode === 'aperture'),
      toChanges: (v) => ({ aperture: Number(v) }),
    },
    {
      key: 'iso',
      label: 'ISO',
      options: s.isoValues.map((v) => ({ value: String(v), label: v === 0 ? 'AUTO' : String(v) })),
      current: String(s.iso),
      toChanges: (v) => ({ iso: Number(v) }),
    },
    {
      key: 'ev',
      label: '노출 보정',
      options: range(s.evMin, s.evMax).map((i) => ({ value: String(i), label: formatEv(i, s.evStep) })),
      current: String(s.ev),
      toChanges: (v) => ({ ev: Number(v) }),
    },
    {
      key: 'sceneMode',
      label: '모드',
      title: '촬영 모드',
      options: orderSceneModes(s.sceneModeValues).map((m) => ({ value: m, label: sceneModeName(m) })),
      current: s.sceneMode,
      display: modeBadge(s.sceneMode),
      toChanges: (v) => ({ sceneMode: v }),
    },
    {
      key: 'whiteBalance',
      label: 'WB',
      options: s.whiteBalanceValues.map((v) => ({ value: v, label: whiteBalanceName(v) })),
      current: s.whiteBalance,
      display: s.whiteBalance === 'color-temp' && s.colorTemperature ? `${s.colorTemperature}K` : undefined,
      toChanges: (v) => ({ whiteBalance: v }),
      sheet: whiteBalanceSheet(s),
    },
    {
      key: 'drive',
      label: '드라이브',
      title: '드라이브 모드',
      options: drive,
      current: timer > 0 ? `single/${timer}` : `${s.driveMode}/0`,
      toChanges: (v) => {
        const [driveMode, selfTimer] = v.split('/');
        return { driveMode, selfTimer: Number(selfTimer) };
      },
    },
    {
      key: 'focusMode',
      label: '초점',
      title: '초점 모드',
      options: (s.focusModeValues ?? ['auto', 'manual']).map((m) => ({ value: m, label: focusModeName(m) })),
      current: s.focusMode,
      display: focusModeName(s.focusMode, s.afMode),
      toChanges: (v) => ({ focusMode: v }),
    },
  ];
}

/** White balance: mode, plus colour temperature (in colour-temperature mode) and A-B / G-M fine tuning. */
function whiteBalanceSheet(s: CameraState): Sheet {
  const wheels: Wheel[] = [
    {
      key: 'whiteBalance',
      title: '모드',
      flex: 2.4,
      options: s.whiteBalanceValues.map((v) => ({ value: v, label: whiteBalanceName(v) })),
      value: s.whiteBalance,
    },
  ];
  if (s.whiteBalance === 'color-temp' && s.colorTemperature !== undefined) {
    const temps: string[] = [];
    for (let k = s.colorTemperatureMin ?? 2500; k <= (s.colorTemperatureMax ?? 9900); k += 100) temps.push(String(k));
    wheels.push({ key: 'colorTemperature', title: '색온도', flex: 1.5, options: temps.map((k) => ({ value: k, label: `${k}K` })), value: String(s.colorTemperature) });
  }
  if (s.wbAB !== undefined) {
    wheels.push({
      key: 'wbAB',
      title: 'A-B',
      options: range(s.wbABMin ?? -7, s.wbABMax ?? 7).map((v) => ({ value: String(v), label: v < 0 ? `A${-v}` : v > 0 ? `B${v}` : '0' })),
      value: String(s.wbAB),
    });
  }
  if (s.wbGM !== undefined) {
    wheels.push({
      key: 'wbGM',
      title: 'G-M',
      options: range(s.wbGMMin ?? -7, s.wbGMMax ?? 7).map((v) => ({ value: String(v), label: v < 0 ? `G${-v}` : v > 0 ? `M${v}` : '0' })),
      value: String(s.wbGM),
    });
  }
  return {
    title: '화이트 밸런스',
    wheels,
    toChanges: (c) => {
      const changes: CameraChanges = {};
      if (c.whiteBalance) changes.whiteBalance = c.whiteBalance;
      if (c.colorTemperature) changes.colorTemperature = Number(c.colorTemperature);
      if (c.wbAB) changes.wbAB = Number(c.wbAB);
      if (c.wbGM) changes.wbGM = Number(c.wbGM);
      return changes;
    },
  };
}

/** Integers from {@code from} to {@code to}, either direction, inclusive. */
function range(from: number, to: number) {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(i);
  return out;
}

/** The list, with {@code current} added if the camera reports a value that isn't in it. */
function withCurrent(values: string[], current: string) {
  return values.includes(current) ? values : [current, ...values];
}

const same = (v: string) => ({ value: v, label: v });

/** Largest box of {@code aspect} (w/h) that fits in w x h. */
function fit(w: number, h: number, aspect: number) {
  return w / h > aspect ? { width: h * aspect, height: h } : { width: w, height: w / aspect };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  landscape: { flex: 1, flexDirection: 'row' },
  liveArea: { alignItems: 'center', justifyContent: 'center' },
  panel: { paddingBottom: 24, paddingTop: 8 },
  portraitRoot: { flex: 1 },
  // Only the space the controls leave; never grow past it (flexBasis 0 / minHeight 0)
  portraitLive: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' },
  // Controls sit low, near the thumb and the shutter
  portraitControls: { paddingTop: 10, paddingBottom: 6 },

  statusCorner: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 },
  afFrame: { position: 'absolute', borderWidth: 2, borderColor: colors.ok, borderRadius: 2 },
  afFrameWarn: { borderColor: colors.accent },
  focusBadge: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 7,
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  focusBadgeOk: { backgroundColor: 'rgba(62,207,110,0.85)', borderColor: colors.ok },
  focusBadgeFail: { backgroundColor: 'rgba(255,77,77,0.85)', borderColor: colors.danger },
  focusBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.overlay,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { color: colors.text, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  busy: { transform: [{ scale: 0.7 }] },
  zoomCorner: { position: 'absolute', right: 12, bottom: 12 },
  zoomCornerTop: { position: 'absolute', right: 10, top: 10 },
  rotateButton: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  panelZoom: { alignItems: 'center', marginTop: 8 },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  offline: { backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  offlineTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  offlineHint: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  dial: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: DIAL_MARGIN,
    borderRadius: 16,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  strip: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.62)' },
  bottomOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  focusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: DIAL_MARGIN + 4, marginTop: 16 },
  focusOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  focusBar: { flex: 1 },
  magnifierOn: { backgroundColor: colors.accent },
  magnifierText: { color: '#000', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  focusButton: { width: 44, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  focusButtonCompact: { width: 38, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  focusHint: { color: colors.textDim, fontSize: 12, textAlign: 'center' },

  captureBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  captureColumn: { alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 6 },
  shutterRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisc: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDiscPressed: { backgroundColor: colors.accent, transform: [{ scale: 0.92 }] },
  af: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  afPressed: { backgroundColor: 'rgba(255,255,255,0.16)' },
  afLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  thumb: {
    width: 50,
    height: 50,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  disabled: { opacity: 0.35 },
  toast: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(40,40,40,0.95)',
    borderRadius: 12,
    padding: 12,
  },
  toastText: { color: colors.text, fontSize: 14, textAlign: 'center' },
});
