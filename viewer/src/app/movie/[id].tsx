import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCamera } from '@/lib/CameraProvider';
import { setMoviePlaying } from '@/lib/playback';
import { canSaveToPhotos, megabytes, saveMovie, type DownloadProgress } from '@/lib/save';
import { colors } from '@/lib/theme';

/**
 * Plays a movie straight from the camera: it serves byte ranges, so playback starts and seeks
 * while the file streams. The live view pauses meanwhile, leaving the Wi-Fi to the movie.
 */
export default function MovieScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { client } = useCamera();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(client.movieUrl(Number(id)), (p) => p.play());
  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });

  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMoviePlaying(true);
    return () => setMoviePlaying(false);
  }, []);

  const save = async () => {
    if (saving) return;
    setMessage(null);
    if (!(await canSaveToPhotos())) {
      setMessage('사진 보관함 접근 권한이 필요해요');
      return;
    }
    setSaving(true);
    setProgress(null);
    try {
      await saveMovie(client, Number(id), setProgress);
      setMessage('사진 앱에 저장했어요');
    } catch (e) {
      setMessage(`저장 실패: ${String(e)}`);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name ?? '동영상',
          headerRight: () =>
            saving ? (
              <ActivityIndicator color={colors.accent} style={styles.headerSpinner} />
            ) : (
              <Pressable
                onPress={save}
                style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="동영상을 사진 앱에 저장">
                <Ionicons name="download-outline" size={22} color={colors.accent} />
              </Pressable>
            ),
        }}
      />
      <VideoView style={styles.video} player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />
      {status === 'loading' && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.text} />
        </View>
      )}
      {status === 'error' && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.error}>재생할 수 없어요{error?.message ? `\n${error.message}` : ''}</Text>
        </View>
      )}
      {(saving || message) && (
        <Pressable style={[styles.toast, { bottom: insets.bottom + 70 }]} onPress={() => setMessage(null)}>
          <Text style={styles.toastText}>
            {saving
              ? progress && progress.total > 0
                ? `받는 중 · ${megabytes(progress.written)} / ${megabytes(progress.total)} MB`
                : '받는 중'
              : message}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    padding: 24,
  },
  headerButton: {
    paddingHorizontal: 8,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpinner: { marginHorizontal: 8 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(40,40,42,0.95)',
  },
  toastText: {
    color: colors.text,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
});
