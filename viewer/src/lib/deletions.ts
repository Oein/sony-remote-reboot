import { useEffect, useRef } from 'react';

import type { CameraClient } from '@/lib/camera';

// Photos deleted on one screen (the viewer) leave the others' lists (the gallery) too

const listeners = new Set<(ids: number[]) => void>();

/** Deletes photos on the camera; tells every open list which ones went. */
export async function deletePhotos(client: CameraClient, ids: number[]) {
  const result = await client.deletePhotos(ids);
  if (result.deleted.length) listeners.forEach((l) => l(result.deleted));
  return result;
}

export function usePhotosDeleted(onDeleted: (ids: number[]) => void) {
  const handler = useRef(onDeleted);
  useEffect(() => {
    handler.current = onDeleted;
  });
  useEffect(() => {
    const listener = (ids: number[]) => handler.current(ids);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

/** "이 사진을" / "3장의 사진을" */
export function deleteQuestion(count: number) {
  return `${count === 1 ? '이 사진을' : `${count}장의 사진을`} 카메라에서 삭제할까요?`;
}
export const DELETE_DETAIL = 'JPEG와 RAW 파일이 모두 지워지고 되돌릴 수 없어요.';
