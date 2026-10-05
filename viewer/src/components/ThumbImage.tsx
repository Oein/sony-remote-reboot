import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';

import type { CameraClient, PhotoItem } from '@/lib/camera';
import { useThumb } from '@/lib/thumbCache';

/** A photo's small thumbnail from the phone's thumbnail cache (downloaded into it if needed). */
export function ThumbImage({
  client,
  item,
  style,
  contentFit = 'cover',
}: {
  client: CameraClient;
  item: PhotoItem;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain';
}) {
  const uri = useThumb(client, item);
  // The file is the cache: expo-image keeps it in memory only
  return <Image source={uri ? { uri } : null} style={style} contentFit={contentFit} cachePolicy="memory" recyclingKey={String(item.id)} />;
}
