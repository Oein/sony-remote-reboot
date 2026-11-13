import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { formatDuration, type CameraClient, type MovieItem } from '@/lib/camera';
import { colors } from '@/lib/theme';

const GAP = 2;
/** Target thumbnail width: 2 across an upright phone, more sideways. */
const THUMB_TARGET = 180;

/** The camera's MP4 movies, newest first; a tap plays one. */
export function MovieGrid({ client, connected, width }: { client: CameraClient; connected: boolean; width: number }) {
  const [items, setItems] = useState<MovieItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A short list, so it is loaded whole
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await client.movies(0, 500);
      setItems(page.items);
      setTotal(page.total);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    client.movies(0, 500).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setError(null);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [client, connected]);

  const columns = Math.max(2, Math.round(width / THUMB_TARGET));
  const cellWidth = (width - GAP * (columns - 1)) / columns;
  const cellHeight = (cellWidth * 9) / 16;

  if (items === null) {
    return (
      <View style={styles.center}>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.textDim} />}</View>
    );
  }

  return (
    <FlatList
      key={columns}
      style={styles.list}
      data={items}
      numColumns={columns}
      keyExtractor={(item) => String(item.id)}
      columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
      contentContainerStyle={{ gap: GAP }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
      ListFooterComponent={
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.count}>{total > 0 ? `동영상 ${total}개` : '동영상이 없어요'}</Text>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/movie/[id]',
              params: { id: String(item.id), name: item.name },
            })
          }
          style={({ pressed }) => pressed && { opacity: 0.7 }}
          accessibilityRole="button"
          accessibilityLabel={`${item.name} 재생`}>
          {/* The camera's thumbnail is 4:3 with the 16:9 picture letterboxed in it: show just the picture */}
          <View
            style={{
              width: cellWidth,
              height: cellHeight,
              overflow: 'hidden',
              backgroundColor: colors.panel,
            }}>
            <Image
              source={{ uri: client.movieThumbUrl(item) }}
              style={{
                width: cellWidth,
                height: (cellWidth * 3) / 4,
                marginTop: -(cellWidth * 3) / 4 / 2 + cellHeight / 2,
              }}
              recyclingKey={String(item.id)}
            />
          </View>
          <View style={styles.play} pointerEvents="none">
            <View style={styles.playTriangle} />
          </View>
          {item.duration > 0 && (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{formatDuration(item.duration)}</Text>
            </View>
          )}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  count: {
    color: colors.textDim,
    fontSize: 13,
    padding: 20,
    textAlign: 'center',
  },
  error: { color: colors.danger, padding: 16, textAlign: 'center' },
  play: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    marginLeft: 3,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#fff',
  },
  badge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
