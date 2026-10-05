import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';

import { colors } from '@/lib/theme';

export default function TabLayout() {
  const { width, height } = useWindowDimensions();
  const tabBarStyle = { backgroundColor: colors.panel, borderTopColor: colors.panelBorder };
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.text,
        tabBarStyle,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        sceneStyle: { backgroundColor: colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '촬영',
          headerShown: false,
          // Sideways the shooting screen goes full screen, like a camera app
          tabBarStyle: width > height ? { display: 'none' } : tabBarStyle,
          tabBarIcon: ({ color, size }) => <Ionicons name="camera-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: '갤러리',
          tabBarIcon: ({ color, size }) => <Ionicons name="images-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
