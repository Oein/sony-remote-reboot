/** Korean names, as the camera's own menus show them. */

const SCENE_MODES: Record<string, string> = {
  auto: '인텔리전트 자동',
  'program-auto': '프로그램 자동',
  'aperture-priority': '조리개 우선',
  'shutter-speed': '셔터 우선',
  'manual-exposure': '수동 노출',
  portrait: '인물',
  sports: '스포츠 동작',
  macro: '매크로',
  landscape: '풍경',
  sunset: '일몰',
  night: '야경',
  'night-portrait': '야경 인물',
  'hand-held-twilight': '손에 들고 야경',
  'anti-motion-blur': '움직임 흐림 방지',
};

/** Order of the camera's own mode list. */
const SCENE_ORDER = Object.keys(SCENE_MODES);

const MODE_BADGES: Record<string, string> = {
  auto: 'iA',
  'program-auto': 'P',
  'aperture-priority': 'A',
  'shutter-speed': 'S',
  'manual-exposure': 'M',
};

const WHITE_BALANCE: Record<string, string> = {
  auto: '자동 WB',
  daylight: '일광',
  shade: '그늘',
  'cloudy-daylight': '흐림',
  incandescent: '백열등',
  'fluorescent-coolwhite': '형광등: 온백색',
  'fluorescent-daywhite': '형광등: 주백색',
  'fluorescent-daylight': '형광등: 주광색',
  'warm-fluorescent': '형광등: 따뜻한 백색',
  flash: '플래시',
  custom: '사용자 정의',
  'color-temp': '색온도',
  'underwater-auto': '수중 자동',
};

const DRIVE_MODES: Record<string, string> = {
  single: '단일 촬영',
  burst: '연속 촬영',
  'speed-prior-burst': '속도 우선 연속 촬영',
  bracket: '브라케팅',
};

export const sceneModeName = (mode: string) => SCENE_MODES[mode] ?? mode;
export const modeBadge = (mode: string) => MODE_BADGES[mode] ?? 'SCN';
export const whiteBalanceName = (wb: string) => WHITE_BALANCE[wb] ?? wb;
export const driveModeName = (drive: string, selfTimer = 0) =>
  selfTimer > 0 ? `셀프 타이머: ${selfTimer}초` : (DRIVE_MODES[drive] ?? drive);

export function orderSceneModes(supported: string[]) {
  const known = SCENE_ORDER.filter((m) => supported.includes(m));
  return [...known, ...supported.filter((m) => !SCENE_ORDER.includes(m))];
}

/** Standard 1/3-stop shutter speeds, slowest first; the camera clamps to what the mode allows. */
export const SHUTTER_SPEEDS = [
  '30"', '25"', '20"', '15"', '13"', '10"', '8"', '6"', '5"', '4"', '3.2"', '2.5"', '2"', '1.6"', '1.3"', '1"',
  '0.8"', '0.6"', '0.5"', '0.4"', '1/3', '1/4', '1/5', '1/6', '1/8', '1/10', '1/13', '1/15', '1/20', '1/25',
  '1/30', '1/40', '1/50', '1/60', '1/80', '1/100', '1/125', '1/160', '1/200', '1/250', '1/320', '1/400',
  '1/500', '1/640', '1/800', '1/1000', '1/1250', '1/1600', '1/2000', '1/2500', '1/3200', '1/4000',
];

/** Standard 1/3-stop f-numbers; the lens clamps to its own range. */
export const APERTURES = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];

const FOCUS_MODES: Record<string, string> = { auto: 'AF', manual: 'MF', dmf: 'DMF' };
export const focusModeName = (mode: string, afMode?: string) =>
  mode === 'auto' && afMode ? afMode.toUpperCase() : (FOCUS_MODES[mode] ?? mode);
