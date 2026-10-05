import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PhotoItem } from '@/lib/camera';
import { ThumbImage } from '@/components/ThumbImage';
import { useCamera } from '@/lib/CameraProvider';
import { canSaveToPhotos, megabytes, saveOriginal, type DownloadProgress } from '@/lib/save';
import { colors } from '@/lib/theme';

const PAGE = 60;
const GAP = 2;
/** Target thumbnail size for the default column count: 3 across an upright phone, more sideways. */
const THUMB_TARGET = 125;
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 12;
/** How far two fingers must spread or pinch before the grid changes by one step. */
const PINCH_STEP = 1.3;
/** Dragging a selection this close to the top or bottom scrolls the grid. */
const AUTO_SCROLL_EDGE = 70;
const AUTO_SCROLL_STEP = 14;
const TOOLBAR_H = 52;

type Touches = { nativeEvent: { touches: readonly { pageX: number; pageY: number }[] } };

/** Distance between the first two fingers, or null with fewer than two down. */
function touchDistance(e: Touches) {
  const t = e.nativeEvent.touches;
  return t.length < 2 ? null : Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
}

type Saving = { done: number; count: number; file: DownloadProgress | null };

/**
 * The camera's photos in a grid, like the Photos app: pinch to change the grid size, "선택" to
 * pick photos by tapping or by sliding a finger across them, then save them to Photos.
 */
export default function GalleryScreen() {
  const { client, connected } = useCamera();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const [columnStep, setColumnStep] = useState(0);
  const pinchStart = useRef<number | null>(null);
  const pinchRatio = useRef(1);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [saving, setSaving] = useState<Saving | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // First page whenever the camera (re)appears; state is only set from the async callbacks
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    client.photos(0, PAGE).then(
      (page) => {
        if (cancelled) return;
        setTotal(page.total);
        setItems(page.items);
        setError(null);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [connected, client]);

  /** Pull-to-refresh (reset) and infinite scroll (append). */
  const load = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const page = await client.photos(reset ? 0 : items.length, PAGE);
        setTotal(page.total);
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [client, items.length],
  );

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // "선택" / "취소" in the title bar, and the selection toolbar in place of the tab bar
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={selecting ? stopSelecting : () => setSelecting(true)}
          disabled={!!saving || items.length === 0}
          style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}
          accessibilityRole="button">
          <Text style={styles.headerButtonText}>{selecting ? '취소' : '선택'}</Text>
        </Pressable>
      ),
      tabBarStyle: selecting ? { display: 'none' } : { backgroundColor: colors.panel, borderTopColor: colors.panelBorder },
    });
  }, [navigation, selecting, saving, items.length, stopSelecting]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));

  const saveSelected = async () => {
    if (selected.size === 0 || saving) return;
    setSaveMessage(null);
    if (!(await canSaveToPhotos())) {
      setSaveMessage('사진 보관함 접근 권한이 필요해요');
      return;
    }
    // In grid order (newest first), whatever order they were picked in
    const ids = items.filter((item) => selected.has(item.id)).map((item) => item.id);
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setSaving({ done: i, count: ids.length, file: null });
      try {
        await saveOriginal(client, ids[i], (file) => setSaving({ done: i, count: ids.length, file }));
      } catch {
        failed++;
      }
    }
    setSaving(null);
    setSaveMessage(failed === 0 ? `${ids.length}장을 사진 앱에 저장했어요` : `${ids.length - failed}장 저장, ${failed}장 실패`);
    if (failed === 0) stopSelecting();
  };

  const baseColumns = Math.max(3, Math.round(width / THUMB_TARGET));
  const columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, baseColumns + columnStep));
  const size = (width - GAP * (columns - 1)) / columns;

  // --- drag to select ----------------------------------------------------------------------
  // Like Photos: while selecting, a sideways slide from a photo selects (or, starting on a
  // selected one, deselects) everything between it and the finger, then may go up and down.
  const list = useRef<FlatList<PhotoItem>>(null);
  const grid = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0, height: 0 });
  const scrollY = useRef(0);
  const drag = useRef<{ start: number; add: boolean; base: ReadonlySet<number>; x: number; y: number } | null>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  const live = useRef({ selecting, items, columns, size, selected });
  useLayoutEffect(() => {
    live.current = { selecting, items, columns, size, selected };
  });

  const cellAt = (pageX: number, pageY: number) => {
    const { items: list, columns: cols, size: cell } = live.current;
    const x = pageX - gridOrigin.current.x;
    const y = pageY - gridOrigin.current.y + scrollY.current;
    const col = Math.max(0, Math.min(cols - 1, Math.floor(x / (cell + GAP))));
    const row = Math.max(0, Math.floor(y / (cell + GAP)));
    return Math.min(list.length - 1, row * cols + col);
  };

  const applyDrag = () => {
    const d = drag.current;
    if (!d) return;
    const { items: list } = live.current;
    const end = cellAt(d.x, d.y);
    const next = new Set(d.base);
    for (let i = Math.min(d.start, end); i <= Math.max(d.start, end); i++) {
      if (d.add) next.add(list[i].id);
      else next.delete(list[i].id);
    }
    setSelected(next);
  };

  const stopAutoScroll = () => {
    if (autoScroll.current) clearInterval(autoScroll.current);
    autoScroll.current = null;
  };

  const updateAutoScroll = () => {
    const d = drag.current;
    const { y, height } = gridOrigin.current;
    const direction = !d ? 0 : d.y < y + AUTO_SCROLL_EDGE ? -1 : d.y > y + height - AUTO_SCROLL_EDGE ? 1 : 0;
    if (direction === 0) return stopAutoScroll();
    if (autoScroll.current) return;
    autoScroll.current = setInterval(() => {
      const dragging = drag.current;
      const edge = gridOrigin.current;
      const dir = !dragging ? 0 : dragging.y < edge.y + AUTO_SCROLL_EDGE ? -1 : dragging.y > edge.y + edge.height - AUTO_SCROLL_EDGE ? 1 : 0;
      if (dir === 0) return stopAutoScroll();
      const offset = Math.max(0, scrollY.current + dir * AUTO_SCROLL_STEP);
      list.current?.scrollToOffset({ offset, animated: false });
      scrollY.current = offset;
      applyDrag();
    }, 16);
  };

  // The handlers only read refs, and only while a gesture runs (as in Controls' ScrubChip)
  // eslint-disable-next-line react-hooks/refs
  const [dragResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (e, g) =>
        live.current.selecting &&
        e.nativeEvent.touches.length === 1 &&
        Math.abs(g.dx) > 10 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        const start = cellAt(g.x0, g.y0);
        const { items: list, selected: current } = live.current;
        if (start < 0 || !list[start]) return;
        drag.current = { start, add: !current.has(list[start].id), base: current, x: g.moveX, y: g.moveY };
        applyDrag();
      },
      onPanResponderMove: (_, g) => {
        if (!drag.current) return;
        drag.current.x = g.moveX;
        drag.current.y = g.moveY;
        applyDrag();
        updateAutoScroll();
      },
      onPanResponderRelease: () => {
        drag.current = null;
        stopAutoScroll();
      },
      onPanResponderTerminate: () => {
        drag.current = null;
        stopAutoScroll();
      },
    }),
  );
  useEffect(() => stopAutoScroll, []);

  // Pinch: raw touches, so the grid keeps scrolling normally while two fingers move
  const pinchHandlers = {
    onTouchStart: (e: GestureResponderEvent) => {
      const d = touchDistance(e);
      if (d) {
        pinchStart.current = d;
        pinchRatio.current = 1;
      }
    },
    onTouchMove: (e: GestureResponderEvent) => {
      const d = touchDistance(e);
      if (d && pinchStart.current) pinchRatio.current = d / pinchStart.current;
    },
    onTouchEnd: () => {
      if (pinchStart.current === null) return;
      const ratio = pinchRatio.current;
      pinchStart.current = null;
      // One step per PINCH_STEP of spread; spreading means fewer, bigger thumbnails
      const steps = Math.round(Math.log(ratio) / Math.log(PINCH_STEP));
      if (steps !== 0) {
        setColumnStep((prev) => Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, baseColumns + prev - steps)) - baseColumns);
      }
    },
  };

  if (!connected && items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>카메라에 연결되면 사진이 여기에 나와요.</Text>
      </View>
    );
  }

  const progressFraction = saving
    ? (saving.done + (saving.file && saving.file.total > 0 ? saving.file.written / saving.file.total : 0)) / saving.count
    : 0;

  return (
    <View style={styles.screen}>
      <View
        ref={grid}
        style={styles.screen}
        onLayout={() =>
          grid.current?.measureInWindow((x, y, _w, height) => {
            gridOrigin.current = { x, y, height };
          })
        }
        {...pinchHandlers}
        {...dragResponder.panHandlers}>
        <FlatList
          ref={list}
          // numColumns can't change on a mounted list
          key={columns}
          style={styles.screen}
          data={items}
          numColumns={columns}
          keyExtractor={(item) => String(item.id)}
          columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
          contentContainerStyle={{ gap: GAP, paddingBottom: selecting ? TOOLBAR_H + insets.bottom : 0 }}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl refreshing={loading && items.length === 0} onRefresh={() => load(true)} tintColor={colors.text} />
          }
          onEndReachedThreshold={1.5}
          onEndReached={() => {
            if (total !== null && items.length < total) load(false);
          }}
          ListFooterComponent={
            loading && items.length > 0 ? (
              <ActivityIndicator style={styles.footer} color={colors.textDim} />
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : total !== null ? (
              <Text style={styles.count}>사진 {total}장</Text>
            ) : null
          }
          extraData={selected}
          renderItem={({ item }) => {
            const isSelected = selecting && selected.has(item.id);
            return (
              <Pressable
                onPress={() => (selecting ? toggle(item.id) : router.push(`/photo/${item.id}`))}
                onLongPress={() => {
                  // Long press starts selecting with this photo
                  if (!selecting) {
                    setSelecting(true);
                    setSelected(new Set([item.id]));
                  }
                }}>
                {/* "small" is already rotated upright by the camera, so a square crop is safe */}
                <ThumbImage client={client} item={item} style={{ width: size, height: size, backgroundColor: colors.panel }} />
                {item.raw && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>RAW</Text>
                  </View>
                )}
                {isSelected && (
                  <>
                    <View style={styles.selectedTint} pointerEvents="none" />
                    <View style={styles.check} pointerEvents="none">
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    </View>
                  </>
                )}
              </Pressable>
            );
          }}
        />
      </View>

      {selecting && (
        <View style={[styles.toolbar, { paddingBottom: insets.bottom, height: TOOLBAR_H + insets.bottom }]}>
          {saving ? (
            <View style={styles.saveProgress}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progressFraction * 100)}%` }]} />
              </View>
              <Text style={styles.toolbarText}>
                {saving.done + 1} / {saving.count}장 받는 중
                {saving.file && saving.file.total > 0 ? ` · ${megabytes(saving.file.written)} / ${megabytes(saving.file.total)} MB` : ''}
              </Text>
            </View>
          ) : (
            <>
              <Pressable
                onPress={saveSelected}
                disabled={selected.size === 0}
                style={({ pressed }) => [styles.toolButton, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="선택한 사진을 사진 앱에 저장">
                <Ionicons name="download-outline" size={24} color={selected.size === 0 ? colors.textDim : colors.accent} />
              </Pressable>
              <Text style={styles.toolbarTitle}>{selected.size > 0 ? `${selected.size}장의 사진이 선택됨` : '항목 선택'}</Text>
              <Pressable onPress={toggleAll} style={styles.toolButton} accessibilityRole="button">
                <Text style={styles.toolLink}>{allSelected ? '선택 해제' : '모두 선택'}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {saveMessage && !saving && (
        <Pressable
          style={[styles.toast, { bottom: (selecting ? TOOLBAR_H + insets.bottom : 0) + 12 }]}
          onPress={() => setSaveMessage(null)}>
          <Text style={styles.toastText}>{saveMessage}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  hint: { color: colors.textDim, fontSize: 15, textAlign: 'center' },
  count: { color: colors.textDim, fontSize: 13, padding: 20, textAlign: 'center' },
  footer: { padding: 20 },
  error: { color: colors.danger, padding: 16, textAlign: 'center' },
  headerButton: { marginRight: 12, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  headerButtonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  badge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  selectedTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.18)' },
  check: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.panelBorder,
  },
  toolButton: { minWidth: 44, height: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toolLink: { color: colors.accent, fontSize: 15 },
  toolbarText: { color: colors.textDim, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  saveProgress: { flex: 1, gap: 6, paddingHorizontal: 12 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(40,40,42,0.95)',
  },
  toastText: { color: colors.text, fontSize: 14 },
});
