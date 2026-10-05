import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';

import { CameraProvider } from '@/lib/CameraProvider';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <CameraProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.panel },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="photo/[id]" options={{ title: '사진' }} />
      </Stack>
    </CameraProvider>
  );
}
