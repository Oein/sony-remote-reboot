import { Directory, File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

import type { CameraClient } from '@/lib/camera';

export type DownloadProgress = { written: number; total: number };

/** Asks for (add-only) Photos access; false if the user declined. */
export async function canSaveToPhotos() {
  const permission = await requestPermissionsAsync(true);
  return permission.granted;
}

/**
 * Downloads a photo's original JPEG from the camera and adds it to the Photos library.
 * {@code total} in the progress is -1 until the camera reports the size.
 */
export async function saveOriginal(client: CameraClient, id: number, onProgress?: (p: DownloadProgress) => void) {
  // A folder of its own: the file takes the name the camera sends (_DSC1234.JPG)
  const dir = new Directory(Paths.cache, 'originals', String(id));
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  try {
    const task = File.createDownloadTask(client.fullUrl(id), dir, {
      onProgress: ({ bytesWritten, totalBytes }) => onProgress?.({ written: bytesWritten, total: totalBytes }),
    });
    const file = await task.downloadAsync();
    if (!file) throw new Error('다운로드가 취소됐어요');
    await Asset.create(file.uri);
  } finally {
    dir.delete();
  }
}

export function megabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}
