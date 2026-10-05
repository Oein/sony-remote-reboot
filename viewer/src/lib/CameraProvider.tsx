import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createCameraClient, DEFAULT_HOST, type CameraClient, type CameraInfo } from './camera';

const HOST_KEY = 'cameraHost';
/** Dev convenience: EXPO_PUBLIC_CAMERA_HOST=127.0.0.1 (mock server) or the camera's Station-mode address. */
const INITIAL_HOST = process.env.EXPO_PUBLIC_CAMERA_HOST || DEFAULT_HOST;
const PING_INTERVAL_MS = 3000;

type CameraContextValue = {
  host: string;
  setHost: (host: string) => void;
  client: CameraClient;
  /** Latest /api/info, or null while the camera can't be reached. */
  info: CameraInfo | null;
  connected: boolean;
};

const CameraContext = createContext<CameraContextValue | null>(null);

/** Holds the camera address (persisted) and keeps checking whether the camera answers. */
export function CameraProvider({ children }: { children: ReactNode }) {
  const [host, setHostState] = useState(INITIAL_HOST);
  const [info, setInfo] = useState<CameraInfo | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HOST_KEY).then((saved) => {
      if (saved) setHostState(saved);
    });
  }, []);

  const setHost = useCallback((next: string) => {
    setHostState(next);
    setInfo(null);
    AsyncStorage.setItem(HOST_KEY, next);
  }, []);

  const client = useMemo(() => createCameraClient(host), [host]);

  useEffect(() => {
    let cancelled = false;
    const ping = () =>
      client.info().then(
        (result) => !cancelled && setInfo(result),
        () => !cancelled && setInfo(null),
      );
    ping();
    const timer = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client]);

  const value = useMemo(
    () => ({ host, setHost, client, info, connected: info !== null }),
    [host, setHost, client, info],
  );
  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useCamera() {
  const value = useContext(CameraContext);
  if (!value) throw new Error('useCamera must be used inside CameraProvider');
  return value;
}
