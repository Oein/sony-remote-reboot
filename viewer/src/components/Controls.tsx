import * as Haptics from 'expo-haptics';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '@/lib/theme';

export type ScrubOption = { value: string; label: string };

/** Finger travel per value while scrubbing a chip sideways. */
const SCRUB_STEP_PX = 26;

/**
 * A setting chip that changes value when swiped sideways, like turning a dial: dragging left
 * brings in the next value from the right. Neighbouring values show faintly while dragging, and
 * the value is applied once on release. A tap (no drag) calls {@code onPress} to open the wheel.
 * Only horizontal drags are claimed, so the surrounding list still scrolls vertically.
 */
export function ScrubChip({
  label,
  options,
  current,
  display,
  onCommit,
  onPress,
  disabled,
  compact,
  style,
}: {
  label: string;
  options: ScrubOption[];
  current: string;
  /** Text when idle; defaults to the current option's label. */
  display?: string;
  onCommit: (value: string) => void;
  onPress: () => void;
  disabled?: boolean;
  /** Smaller, translucent chip for laying over the live view. */
  compact?: boolean;
  style?: ViewStyle;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragDx, setDragDx] = useState(0);
  const startIndex = useRef(0);
  const lastIndex = useRef(0);
  const currentIndex = Math.max(0, options.findIndex((o) => o.value === current));

  // Latest props for the responder's callbacks (the responder itself is created once)
  const latest = useRef({ options, currentIndex, onCommit, disabled });
  useLayoutEffect(() => {
    latest.current = { options, currentIndex, onCommit, disabled };
  });

  // The callbacks read the refs only while a gesture runs, never during render
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      // Capture phase: take the touch over from the inner Pressable once it moves sideways
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !latest.current.disabled && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startIndex.current = latest.current.currentIndex;
        lastIndex.current = startIndex.current;
        setDragIndex(startIndex.current);
      },
      onPanResponderMove: (_, g) => {
        setDragDx(g.dx);
        const count = latest.current.options.length;
        const index = Math.max(0, Math.min(count - 1, startIndex.current - Math.round(g.dx / SCRUB_STEP_PX)));
        if (index !== lastIndex.current) {
          lastIndex.current = index;
          Haptics.selectionAsync();
          setDragIndex(index);
        }
      },
      onPanResponderRelease: () => {
        const { options: opts, onCommit: commit } = latest.current;
        if (lastIndex.current !== startIndex.current && opts[lastIndex.current]) commit(opts[lastIndex.current].value);
        setDragIndex(null);
        setDragDx(0);
      },
      onPanResponderTerminate: () => {
        setDragIndex(null);
        setDragDx(0);
      },
    }),
  );

  const dragging = dragIndex !== null;
  const shown = dragging ? options[dragIndex]?.label : (display ?? options[currentIndex]?.label ?? '--');
  const previous = dragging && dragIndex > 0 ? options[dragIndex - 1].label : '';
  const next = dragging && dragIndex < options.length - 1 ? options[dragIndex + 1].label : '';

  return (
    <View {...responder.panHandlers} style={style}>
      <Pressable
        style={({ pressed }) => [styles.cell, compact && styles.cellCompact, pressed && styles.cellPressed, disabled && styles.disabled]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} ${shown}`}
        accessibilityHint="좌우로 쓸어서 바꾸고, 눌러서 목록을 여세요"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (step === 0) return onPress();
          const target = options[currentIndex + step];
          if (target) onCommit(target.value);
        }}>
        <Text style={[styles.label, compact && styles.labelCompact]} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.value, compact && styles.valueCompact, dragging && styles.valueActive]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}>
          {shown}
        </Text>
        {dragging && (
          <>
            <Text style={[styles.neighbour, styles.neighbourLeft]} numberOfLines={1}>
              {previous}
            </Text>
            <Text style={[styles.neighbour, styles.neighbourRight]} numberOfLines={1}>
              {next}
            </Text>
          </>
        )}
        {!disabled && <DialTicks active={dragging} shift={dragDx} />}
      </Pressable>
    </View>
  );
}

/**
 * A few ruler ticks under a value, hinting that it turns like a dial; while dragging they light up
 * and slide with the finger.
 */
function DialTicks({ active, shift }: { active: boolean; shift: number }) {
  const spacing = 6;
  // Slide within one tick spacing so the ruler seems to scroll past endlessly
  const offset = ((((shift / SCRUB_STEP_PX) * spacing) % spacing) + spacing) % spacing;
  return (
    <View style={styles.ticks} pointerEvents="none">
      <View style={[styles.tickRow, { transform: [{ translateX: active ? offset - spacing / 2 : 0 }] }]}>
        {Array.from({ length: 9 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.tick,
              i === 4 && styles.tickCenter,
              active && styles.tickActive,
              { opacity: active ? 1 - Math.abs(i - 4) * 0.2 : 0.55 - Math.abs(i - 4) * 0.12 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/** Zoom lever as one capsule: tele and wide halves, zooming while held. */
export function ZoomRocker({
  onZoom,
  onTarget,
  fraction,
  disabled,
  vertical,
}: {
  onZoom: (direction: 'tele' | 'wide' | 'stop') => void;
  /** Zoom to a position (0 widest .. 1 longest); given, a slider sits between W and T. */
  onTarget?: (fraction: number) => void;
  /** Current zoom position, 0 .. 1. */
  fraction?: number;
  disabled?: boolean;
  vertical?: boolean;
}) {
  const half = (direction: 'tele' | 'wide', text: string) => (
    <HoldButton
      label={direction === 'tele' ? '줌 망원' : '줌 광각'}
      onStart={() => onZoom(direction)}
      onStop={() => onZoom('stop')}
      disabled={disabled}
      style={vertical ? styles.rockerHalfVertical : styles.rockerHalf}
      pressedStyle={styles.rockerPressed}>
      <Text style={styles.rockerText}>{text}</Text>
    </HoldButton>
  );
  const divider = <View style={vertical ? styles.rockerDividerVertical : styles.rockerDivider} />;
  return (
    <View style={[styles.rocker, vertical && styles.rockerVertical, disabled && styles.disabled]}>
      {vertical ? half('tele', 'T') : half('wide', 'W')}
      {divider}
      {onTarget && (
        <>
          <ZoomSlider fraction={fraction ?? 0} onTarget={onTarget} vertical={vertical} disabled={disabled} />
          {divider}
        </>
      )}
      {vertical ? half('wide', 'W') : half('tele', 'T')}
    </View>
  );
}

/** While dragging, the zoom target is sent at most this often (the lens follows on its own). */
const ZOOM_SEND_MS = 250;
const ZOOM_TRACK = 110;

/**
 * Zoom position slider: drag (or tap) to where the zoom should be. The camera drives the lens
 * there itself, so the phone's latency doesn't make it overshoot like holding W / T does.
 * Vertical sliders have tele at the top.
 */
function ZoomSlider({
  fraction,
  onTarget,
  vertical,
  disabled,
}: {
  fraction: number;
  onTarget: (fraction: number) => void;
  vertical?: boolean;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const lastSent = useRef(0);
  const target = useRef(onTarget);
  useLayoutEffect(() => {
    target.current = onTarget;
  });

  // As in ScrubChip: the callbacks read the refs only while a gesture runs, never during render
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => move(e.nativeEvent, true),
      onPanResponderMove: (e) => move(e.nativeEvent, false),
      onPanResponderRelease: (e) => {
        const f = position(e.nativeEvent);
        target.current(f);
        setDragging(null);
      },
      onPanResponderTerminate: () => setDragging(null),
    })
  );

  // Finger position along the track, 0 = widest
  function position(ev: { locationX: number; locationY: number }) {
    const along = vertical ? 1 - ev.locationY / ZOOM_TRACK : ev.locationX / ZOOM_TRACK;
    return Math.max(0, Math.min(1, along));
  }

  function move(ev: { locationX: number; locationY: number }, start: boolean) {
    const f = position(ev);
    setDragging(f);
    const now = Date.now();
    if (start || now - lastSent.current > ZOOM_SEND_MS) {
      lastSent.current = now;
      target.current(f);
    }
  }

  const shown = Math.max(0, Math.min(1, dragging ?? fraction));
  return (
    <View
      {...(disabled ? {} : responder.panHandlers)}
      style={vertical ? styles.zoomTrackVertical : styles.zoomTrack}
      accessibilityRole="adjustable"
      accessibilityLabel="줌 위치"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}>
      <View pointerEvents="none" style={vertical ? styles.zoomLineVertical : styles.zoomLine} />
      <View
        pointerEvents="none"
        style={[
          styles.zoomThumb,
          dragging !== null && styles.zoomThumbActive,
          vertical ? { bottom: shown * (ZOOM_TRACK - 14) } : { left: shown * (ZOOM_TRACK - 14) },
        ]}
      />
    </View>
  );
}

/** Calls onStart when pressed and onStop when released, like the camera's zoom lever. */
export function HoldButton({
  children,
  onStart,
  onStop,
  disabled,
  style,
  pressedStyle,
  label,
}: {
  children: ReactNode;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  /** Replaces the default round button look. */
  style?: ViewStyle;
  pressedStyle?: ViewStyle;
  label: string;
}) {
  const active = useRef(false);
  return (
    <Pressable
      style={({ pressed }) => [style ?? styles.round, pressed && (pressedStyle ?? styles.roundPressed), disabled && styles.disabled]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        active.current = true;
        onStart();
      }}
      onPressOut={() => {
        if (active.current) {
          active.current = false;
          onStop();
        }
      }}>
      {children}
    </Pressable>
  );
}

/** Like HoldButton, but repeats {@code onRepeat} every {@code intervalMs} while held. */
export function RepeatButton({
  children,
  onRepeat,
  intervalMs = 120,
  disabled,
  style,
  label,
}: {
  children: ReactNode;
  onRepeat: () => void;
  intervalMs?: number;
  disabled?: boolean;
  style?: ViewStyle;
  label: string;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <HoldButton
      label={label}
      disabled={disabled}
      style={style}
      onStart={() => {
        onRepeat();
        timer.current = setInterval(onRepeat, intervalMs);
      }}
      onStop={stop}>
      {children}
    </HoldButton>
  );
}

/** Thin track with a knob at {@code fraction} (0..1). */
export function PositionBar({ fraction, left, right }: { fraction: number; left: string; right: string }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{left}</Text>
      <View style={styles.track}>
        <View style={[styles.knob, { left: `${clamped * 100}%` }]} />
      </View>
      <Text style={styles.barLabel}>{right}</Text>
    </View>
  );
}

export const controlStyles = StyleSheet.create({
  roundLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
});

const styles = StyleSheet.create({
  // Settings read like an exposure display: small label, large tabular value, no boxes
  cell: { alignItems: 'center', justifyContent: 'center', paddingTop: 16, paddingBottom: 12, paddingHorizontal: 4 },
  cellCompact: { paddingTop: 6, paddingBottom: 5 },
  cellPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  disabled: { opacity: 0.32 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: '500', letterSpacing: 0.2 },
  labelCompact: { fontSize: 10 },
  value: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
    marginTop: 3,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  valueCompact: { fontSize: 15, marginTop: 1 },
  valueActive: { color: colors.accent },
  neighbour: { position: 'absolute', top: '46%', color: colors.textDim, fontSize: 11, opacity: 0.6, maxWidth: '30%' },
  neighbourLeft: { left: 4 },
  neighbourRight: { right: 4, textAlign: 'right' },
  ticks: { height: 8, marginTop: 5, width: 54, overflow: 'hidden', alignItems: 'center' },
  tickRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 8 },
  tick: { width: 1, height: 4, backgroundColor: colors.textDim },
  tickCenter: { height: 7 },
  tickActive: { backgroundColor: colors.accent },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.panelBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundPressed: { backgroundColor: '#1d1d1f' },
  rocker: {
    flexDirection: 'row',
    borderRadius: 22,
    backgroundColor: colors.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  rockerVertical: { flexDirection: 'column' },
  zoomTrack: { width: ZOOM_TRACK, height: 40, justifyContent: 'center' },
  zoomTrackVertical: { width: 48, height: ZOOM_TRACK, alignItems: 'center' },
  zoomLine: { position: 'absolute', left: 7, right: 7, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  zoomLineVertical: { position: 'absolute', top: 7, bottom: 7, width: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  zoomThumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: colors.text },
  zoomThumbActive: { backgroundColor: colors.accent, transform: [{ scale: 1.3 }] },
  rockerHalf: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
  rockerHalfVertical: { width: 48, height: 46, alignItems: 'center', justifyContent: 'center' },
  rockerPressed: { backgroundColor: 'rgba(243,152,0,0.35)' },
  rockerDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 8 },
  rockerDividerVertical: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 8 },
  rockerText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.panelBorder },
  knob: {
    position: 'absolute',
    top: -6,
    width: 3,
    height: 15,
    marginLeft: -1.5,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
