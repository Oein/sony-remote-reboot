import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatExposure, type CameraClient, type PhotoDetails, type PhotoItem } from '@/lib/camera';
import { ThumbImage } from '@/components/ThumbImage';
import { useCamera } from '@/lib/CameraProvider';
import { canSaveToPhotos, megabytes, saveOriginal, type DownloadProgress } from '@/lib/save';
import { colors } from '@/lib/theme';

/** Photos listed for paging; the camera lists newest first, like the gallery. */
const LIST_LIMIT = 2000;
const STRIP_THUMB = 44;
/** Height of the bottom bar's thumbnail strip and toolbar (without the safe area). */
const BOTTOM_BAR_H = 8 + STRIP_THUMB + 8 + 44 + 8;
const SIDE_INFO_W = 200;
/** Past this zoom the full-size original is loaded for the page. */
const FULL_RES_ZOOM = 1.5;

/** Degrees to rotate the (unrotated) preview so it appears upright, from the EXIF orientation. */
function rotationFor(orientation: number) {
  switch (orientation) {
    case 3:
      return 180;
    case 6:
      return 90;
    case 8:
      return 270;
    default:
      return 0;
  }
}

/**
 * Photo viewer in the manner of the iOS Photos app: swipe between photos, pinch to zoom, tap to
 * show or hide the bars. Each page shows the gallery's (cached, upright) thumbnail at once, the
 * camera's large preview over it when loaded, and the full-size original once zoomed in.
 */
export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const startId = Number(id);
  const { client } = useCamera();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<PhotoItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [details, setDetails] = useState<Record<number, PhotoDetails>>({});
  const [chrome, setChrome] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const landscape = width > height;
  // The pages fill whatever the info panel leaves (beside the photo sideways, under it upright)
  const [box, setBox] = useState({ w: width, h: height });
  const indexRef = useRef(index);
  useLayoutEffect(() => {
    indexRef.current = index;
  });

  const pager = useRef<FlatList<PhotoItem>>(null);
  const strip = useRef<FlatList<PhotoItem>>(null);

  useEffect(() => {
    client.photos(0, LIST_LIMIT).then(
      (page) => {
        const start = Math.max(
          0,
          page.items.findIndex((p) => p.id === startId),
        );
        setIndex(start);
        setItems(page.items);
      },
      (e) => setError(String(e)),
    );
  }, [client, startId]);

  // Details (orientation, size, exposure) for the photo on screen and its neighbours
  useEffect(() => {
    if (!items) return;
    for (const i of [index, index + 1, index - 1]) {
      const item = items[i];
      if (item && !details[item.id]) {
        client.photo(item.id).then(
          (d) => setDetails((prev) => ({ ...prev, [item.id]: d })),
          () => {},
        );
      }
    }
  }, [client, items, index, details]);

  // Keep the thumbnail strip centered on the current photo
  useEffect(() => {
    if (items && items.length > 0) {
      strip.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }
  }, [index, items]);

  // Page width changed (rotation, info panel): stay on the same photo
  useEffect(() => {
    pager.current?.scrollToOffset({ offset: indexRef.current * box.w, animated: false });
  }, [box.w]);

  const onPageScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / box.w);
      if (items && next !== index && next >= 0 && next < items.length) {
        setIndex(next);
        setZoomed(false);
      }
    },
    [box.w, items, index],
  );

  const current = items?.[index];
  const currentDetails = current ? details[current.id] : undefined;
  const toggleChrome = useCallback(() => setChrome((c) => !c), []);

  const renderPage = useCallback(
    ({ item, index: i }: { item: PhotoItem; index: number }) => (
      <PhotoPage
        client={client}
        item={item}
        details={details[item.id]}
        width={box.w}
        height={box.h}
        active={i === index}
        onTap={toggleChrome}
        onZoomChange={setZoomed}
      />
    ),
    [client, details, box.w, box.h, index, toggleChrome],
  );

  if (error) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.status}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          // Sideways the system bar is too tall; a slim one of our own goes over the photo instead
          headerShown: chrome && !landscape,
          title: currentDetails?.name ?? '사진',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'rgba(0,0,0,0.55)' },
          contentStyle: { backgroundColor: '#000' },
        }}
      />
      <StatusBar hidden={!chrome || landscape} style="light" />
      <View style={[styles.body, landscape && styles.bodyRow]}>
        <View
          style={styles.pagerArea}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            if (w !== box.w || h !== box.h) setBox({ w, h });
          }}>
          {items === null ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.textDim} />
            </View>
          ) : (
            <FlatList
              key={landscape ? 'landscape' : 'portrait'}
              ref={pager}
              data={items}
              keyExtractor={(p) => String(p.id)}
              horizontal
              pagingEnabled
              scrollEnabled={!zoomed}
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={index}
              getItemLayout={(_, i) => ({ length: box.w, offset: box.w * i, index: i })}
              onMomentumScrollEnd={onPageScroll}
              renderItem={renderPage}
              extraData={index}
              windowSize={3}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
            />
          )}
        </View>
        {/* Info beside the photo when sideways, under it when upright; the photo never hides behind it */}
        {showInfo && currentDetails && (
          <View
            style={
              landscape
                ? // The screen edge's safe area comes on top of the panel's own width
                  [styles.sideInfo, { width: SIDE_INFO_W + insets.right, paddingTop: 16, paddingRight: insets.right }]
                : [styles.bottomInfo, { paddingBottom: (chrome ? BOTTOM_BAR_H : 0) + insets.bottom + 8 }]
            }>
            <InfoPanel details={currentDetails} narrow={landscape} />
          </View>
        )}
      </View>

      {chrome && landscape && (
        <View
          style={[
            styles.topBar,
            {
              right: showInfo && currentDetails ? SIDE_INFO_W + insets.right : 0,
              paddingLeft: insets.left + 8,
              paddingRight: (showInfo && currentDetails ? 0 : insets.right) + 8,
            },
          ]}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            {currentDetails?.name ?? ''}
          </Text>
        </View>
      )}

      {chrome && items && current && (
        <View
          style={[
            styles.bottomBar,
            landscape && styles.bottomBarCompact,
            landscape && showInfo && { right: SIDE_INFO_W + insets.right },
            { paddingBottom: landscape ? Math.max(4, insets.bottom - 14) : insets.bottom + 8 },
          ]}>
          {/* Sideways there's no height to spare for the strip */}
          {!landscape && (
            <FlatList
              ref={strip}
              data={items}
              horizontal
              keyExtractor={(p) => String(p.id)}
              showsHorizontalScrollIndicator={false}
              getItemLayout={(_, i) => ({ length: STRIP_THUMB + 2, offset: (STRIP_THUMB + 2) * i, index: i })}
              initialScrollIndex={index}
              contentContainerStyle={{ paddingHorizontal: width / 2 - STRIP_THUMB / 2 }}
              renderItem={({ item, index: i }) => (
                <Pressable
                  onPress={() => {
                    pager.current?.scrollToIndex({ index: i, animated: false });
                    setIndex(i);
                    setZoomed(false);
                  }}
                  accessibilityLabel={`${i + 1}번째 사진`}>
                  <ThumbImage client={client} item={item} style={[styles.stripThumb, i === index && styles.stripThumbCurrent]} />
                </Pressable>
              )}
            />
          )}
          <View style={[styles.toolbar, landscape && styles.toolbarCompact, landscape && { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
            <Pressable
              onPress={() => setShowInfo((v) => !v)}
              style={styles.toolButton}
              accessibilityRole="button"
              accessibilityLabel="사진 정보">
              <Ionicons name={showInfo ? 'information-circle' : 'information-circle-outline'} size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.counter}>
              {index + 1} / {items.length}
            </Text>
            {/* Keyed by photo: its progress and messages belong to that photo */}
            <SaveButton key={current.id} client={client} item={current} />
          </View>
        </View>
      )}
    </View>
  );
}

type PageProps = {
  client: CameraClient;
  item: PhotoItem;
  details: PhotoDetails | undefined;
  width: number;
  height: number;
  active: boolean;
  onTap: () => void;
  onZoomChange: (zoomed: boolean) => void;
};

/** One photo: thumbnail, then preview, then (zoomed in) the original, in a pinch-zoom view. */
const PhotoPage = memo(function PhotoPage({ client, item, details, width, height, active, onTap, onZoomChange }: PageProps) {
  const [wantFull, setWantFull] = useState(false);
  const zoom = useRef<ScrollView>(null);

  // Zoom back out when the page scrolls away
  useEffect(() => {
    if (!active) zoom.current?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: false });
  }, [active, width, height]);

  const rotation = details ? rotationFor(details.orientation) : 0;
  const sideways = rotation === 90 || rotation === 270;
  // The photo as it appears upright, fitted to the page
  const aspect = details ? (sideways ? details.height / details.width : details.width / details.height) : null;
  const boxW = aspect ? (width / aspect > height ? height * aspect : width) : width;
  const boxH = aspect ? boxW / aspect : height;

  return (
    <ScrollView
      ref={zoom}
      style={{ width, height }}
      contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
      maximumZoomScale={5}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={100}
      onScroll={(e) => {
        const scale = e.nativeEvent.zoomScale ?? 1;
        onZoomChange(scale > 1.01);
        if (scale > FULL_RES_ZOOM && !wantFull) setWantFull(true);
      }}>
      <Pressable onPress={onTap} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        {/* Already upright and in the thumbnail cache: shows at once */}
        <ThumbImage client={client} item={item} style={StyleSheet.absoluteFill} contentFit="contain" />
        {details && (
          <View style={{ width: boxW, height: boxH, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {/* The preview has no EXIF orientation: laid out unrotated, then turned */}
            <Image
              source={{ uri: client.previewUrl(item.id, item.date) }}
              style={{
                width: sideways ? boxH : boxW,
                height: sideways ? boxW : boxH,
                transform: [{ rotate: `${rotation}deg` }],
              }}
              contentFit="contain"
              transition={120}
              cachePolicy="memory"
              priority={active ? 'high' : 'normal'}
            />
            {wantFull && (
              // The original carries its EXIF orientation, which the decoder applies
              <Image
                source={{ uri: client.fullUrl(item.id) }}
                style={[StyleSheet.absoluteFill]}
                contentFit="contain"
                transition={200}
                cachePolicy="memory"
                priority="high"
              />
            )}
          </View>
        )}
      </Pressable>
    </ScrollView>
  );
});

/** Shooting details; {@code narrow} (the side panel) puts the values in two columns. */
function InfoPanel({ details, narrow }: { details: PhotoDetails; narrow?: boolean }) {
  const values = [formatExposure(details.exposureTime), `F${details.aperture}`, `ISO ${details.iso}`, `${Math.round(details.focalLength)}mm`];
  return (
    <View style={[styles.info, narrow && styles.infoNarrow]}>
      <Text style={[styles.infoDate, narrow && styles.infoDateNarrow]}>{details.date}</Text>
      <View style={[styles.exposure, narrow && styles.exposureNarrow]}>
        {values.map((v) => (
          <Text key={v} style={[styles.value, narrow && styles.valueNarrow]}>
            {v}
          </Text>
        ))}
      </View>
      <Text style={styles.meta}>{narrow ? `${details.folder}/${details.name}\n${details.width} × ${details.height}` : `${details.folder}/${details.name} · ${details.width} × ${details.height}`}</Text>
    </View>
  );
}

/** Downloads the original and adds it to the Photos library, showing how far along it is. */
function SaveButton({ client, item }: { client: CameraClient; item: PhotoItem }) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setMessage(null);
    try {
      if (!(await canSaveToPhotos())) {
        setMessage('사진 보관함 접근 권한이 필요해요');
        return;
      }
      setProgress({ written: 0, total: -1 });
      await saveOriginal(client, item.id, setProgress);
      setMessage('사진 앱에 저장했어요');
    } catch (e) {
      setMessage(`저장 실패: ${String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  const fraction = progress && progress.total > 0 ? progress.written / progress.total : 0;
  return (
    <View style={styles.saveWrap}>
      {progress ? (
        <View style={styles.progress} accessibilityLabel="원본 받는 중">
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {progress.total > 0 ? `${megabytes(progress.written)} / ${megabytes(progress.total)} MB` : '연결 중...'}
          </Text>
        </View>
      ) : message ? (
        <Pressable onPress={() => setMessage(null)}>
          <Text style={styles.saveMessage}>{message}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={save} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="원본을 사진 앱에 저장">
          <Ionicons name="download-outline" size={25} color={colors.text} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  body: { flex: 1 },
  bodyRow: { flexDirection: 'row' },
  pagerArea: { flex: 1 },
  sideInfo: { width: SIDE_INFO_W, backgroundColor: '#111', justifyContent: 'flex-start' },
  bottomInfo: { backgroundColor: '#111', paddingTop: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  status: { color: colors.textDim, textAlign: 'center', padding: 24 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingTop: 8,
    gap: 8,
  },
  stripThumb: { width: STRIP_THUMB, height: STRIP_THUMB, marginHorizontal: 1, opacity: 0.55, backgroundColor: colors.panel },
  stripThumbCurrent: { opacity: 1, borderWidth: 2, borderColor: colors.text },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 44 },
  toolbarCompact: { minHeight: 36 },
  bottomBarCompact: { paddingTop: 0, gap: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  // A band like the bottom bar's, so the title reads over bright photos
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  topTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center', marginRight: 46, textShadowColor: '#000', textShadowRadius: 4 },
  toolButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  counter: { color: colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  saveWrap: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  progress: { width: 150, gap: 4, alignItems: 'flex-end' },
  progressTrack: { width: '100%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  progressText: { color: colors.textDim, fontSize: 11, fontVariant: ['tabular-nums'] },
  saveMessage: { color: colors.textDim, fontSize: 12, maxWidth: 200, textAlign: 'right' },
  info: { paddingHorizontal: 16, gap: 4 },
  infoDate: { color: colors.text, fontSize: 15, fontWeight: '600' },
  exposure: { flexDirection: 'row', gap: 16 },
  infoNarrow: { paddingHorizontal: 14, gap: 8 },
  infoDateNarrow: { fontSize: 14 },
  exposureNarrow: { flexWrap: 'wrap', rowGap: 4, columnGap: 0 },
  valueNarrow: { width: '50%', fontSize: 14 },
  value: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textDim, fontSize: 12 },
});
