import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_HOST } from '@/lib/camera';
import { useCamera } from '@/lib/CameraProvider';
import { CACHE_SIZES_MB, clearThumbCache, setCacheLimitMB, useCacheInfo } from '@/lib/thumbCache';
import { colors } from '@/lib/theme';

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const sizeLabel = (mb: number) => (mb >= 1000 ? `${mb / 1000}GB` : `${mb}MB`);

export default function SettingsScreen() {
  const { host, setHost, connected, info } = useCamera();
  const [draft, setDraft] = useState(host);
  const cache = useCacheInfo();
  const fraction = Math.min(1, cache.used / (cache.limitMB * 1024 * 1024));
  // In landscape the notch is at a side: keep the content clear of it
  const insets = useSafeAreaInsets();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}>
      <Text style={styles.section}>카메라 주소</Text>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => setHost(draft.trim())}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        placeholder={DEFAULT_HOST}
        placeholderTextColor={colors.textDim}
      />
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={() => setHost(draft.trim())}>
          <Text style={styles.buttonText}>적용</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.secondary]}
          onPress={() => {
            setDraft(DEFAULT_HOST);
            setHost(DEFAULT_HOST);
          }}>
          <Text style={[styles.buttonText, styles.secondaryText]}>카메라 AP ({DEFAULT_HOST})</Text>
        </Pressable>
      </View>
      <Text style={styles.help}>
        카메라가 AP 모드면 폰을 카메라 Wi-Fi에 연결하고 {DEFAULT_HOST}를 쓰세요. Station 모드면 카메라 화면 위쪽에
        나오는 주소를 입력하세요.
      </Text>

      <Text style={styles.section}>상태</Text>
      <View style={styles.card}>
        <Text style={[styles.state, { color: connected ? colors.ok : colors.danger }]}>
          {connected ? '연결됨' : '연결 안 됨'}
        </Text>
        {info && (
          <Text style={styles.detail}>
            {info.model} · 펌웨어 {info.firmware} · 앱 {info.appVersion}
          </Text>
        )}
      </View>

      {/* Thumbnails only: previews and originals are never kept */}
      <Text style={styles.section}>썸네일 캐시</Text>
      <View style={styles.card}>
        <View style={styles.usageRow}>
          <Text style={styles.usageLabel}>사용 중</Text>
          <Text style={styles.usageValue}>
            {formatSize(cache.used)} / {sizeLabel(cache.limitMB)}
          </Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
        <Text style={styles.cardLabel}>최대 크기</Text>
        <View style={styles.sizes}>
          {CACHE_SIZES_MB.map((mb) => (
            <Pressable
              key={mb}
              onPress={() => setCacheLimitMB(mb)}
              style={[styles.size, mb === cache.limitMB && styles.sizeSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: mb === cache.limitMB }}>
              <Text style={[styles.sizeText, mb === cache.limitMB && styles.sizeTextSelected]}>{sizeLabel(mb)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.row}>
        <Pressable style={[styles.button, styles.secondary]} onPress={clearThumbCache}>
          <Text style={[styles.buttonText, styles.secondaryText]}>캐시 비우기</Text>
        </Pressable>
      </View>
      <Text style={styles.help}>
        갤러리 썸네일만 폰에 저장해서, 다시 볼 때 카메라에서 받지 않아요. 미리보기와 원본은 저장하지 않아요. 최대
        크기를 넘으면 오래 안 본 것부터 지워요.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  section: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 12 },
  input: {
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', gap: 10 },
  button: { height: 44, borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: 18, justifyContent: 'center' },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 15 },
  secondary: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder },
  secondaryText: { color: colors.text, fontWeight: '500' },
  help: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: colors.panel, borderRadius: 12, padding: 14, gap: 4 },
  state: { fontSize: 17, fontWeight: '700' },
  detail: { color: colors.textDim, fontSize: 13 },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  usageLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  usageValue: { color: colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden', marginTop: 8 },
  fill: { height: '100%', backgroundColor: colors.accent },
  cardLabel: { color: colors.textDim, fontSize: 12, marginTop: 14 },
  sizes: { flexDirection: 'row', gap: 6, marginTop: 4 },
  size: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  sizeSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  sizeText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  sizeTextSelected: { color: '#000' },
});
