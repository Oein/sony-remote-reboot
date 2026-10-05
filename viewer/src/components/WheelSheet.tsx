import { Picker } from '@react-native-picker/picker';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/lib/theme';

export type WheelOption = { value: string; label: string };
/** {@code flex}: relative column width when several wheels share the sheet (default 1). */
export type Wheel = { key: string; title?: string; options: WheelOption[]; value: string; flex?: number };

/**
 * Bottom sheet with one or more native spinning wheels, like the iOS Timer. Nothing is sent to
 * the camera while the wheels turn; "완료" applies the values that changed, once.
 */
export function WheelSheet({
  title,
  wheels,
  onDone,
  onClose,
}: {
  title: string;
  wheels: Wheel[];
  onDone: (changed: Record<string, string>) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Upright, more than two wheels go in rows of two; sideways there's width but no height to spare
  const perRow = width <= height && wheels.length > 2 ? 2 : wheels.length;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(wheels.map((w) => [w.key, w.value])),
  );

  const done = () => {
    const changed = Object.fromEntries(wheels.filter((w) => values[w.key] !== w.value).map((w) => [w.key, values[w.key]]));
    if (Object.keys(changed).length > 0) onDone(changed);
    onClose();
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancel}>취소</Text>
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={done} hitSlop={12}>
            <Text style={styles.done}>완료</Text>
          </Pressable>
        </View>
        {rowsOf(wheels, perRow).map((row) => (
          <View key={row.map((w) => w.key).join()} style={styles.wheels}>
            {row.map((wheel) => (
              <View key={wheel.key} style={{ flex: wheel.flex ?? 1 }}>
                {wheel.title && <Text style={styles.columnTitle}>{wheel.title}</Text>}
                <Picker
                  selectedValue={values[wheel.key]}
                  onValueChange={(value) => setValues((prev) => ({ ...prev, [wheel.key]: String(value) }))}
                  style={wheels.length > 2 ? styles.pickerCompact : undefined}
                  itemStyle={wheels.length > 2 ? styles.itemCompact : styles.item}
                  selectionColor="rgba(243,152,0,0.25)"
                  accessibilityLabel={wheel.title ?? title}>
                  {wheel.options.map((option) => (
                    <Picker.Item key={option.value} label={option.label} value={option.value} color={colors.text} />
                  ))}
                </Picker>
              </View>
            ))}
          </View>
        ))}
      </View>
    </Modal>
  );
}

function rowsOf<T>(items: T[], size: number) {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.panelBorder,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  cancel: { color: colors.textDim, fontSize: 16 },
  done: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  wheels: { flexDirection: 'row', paddingHorizontal: 8 },
  columnTitle: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 10 },
  item: { color: colors.text, fontSize: 21 },
  pickerCompact: { height: 170 },
  itemCompact: { color: colors.text, fontSize: 19, height: 170 },
});
