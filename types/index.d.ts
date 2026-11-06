/** 상위 프로세스 한 건입니다. 메모리는 top이 준 글자 그대로(예: 2266M-)입니다. */
export type Proc = { pid: number; command: string; cpu: number; mem: string };

/** 그래프에 쓰는 한 시점의 사용률(%)입니다. */
export type Sample = { cpu: number; mem: number };

/** 패널이 그리는 값 전부입니다. */
export type Snapshot = {
  /** 첫 부하 측정이 끝났는지입니다. */
  isReady: boolean;
  /** CPU·메모리·부하 평균을 마지막으로 받은 시각(ms)입니다. */
  at: number;
  /** 마지막 두 번의 부하 측정 사이의 실제 간격(ms)입니다. 아직 모르면 0입니다. */
  stepMs: number;
  /** 프로세스 목록을 마지막으로 받은 시각(ms)입니다. 아직 못 받았으면 0입니다. */
  procsAt: number;
  cores: number;
  cpu: { user: number; sys: number; idle: number };
  load: [number, number, number];
  /** top이 알려 주는 메모리 양입니다. 프로세스 목록과 함께 갱신됩니다. */
  mem: { usedGb: number; totalGb: number; wiredGb: number; compressedGb: number };
  /** `memory_pressure`가 알려 주는 시스템 전체 메모리 여유율(%)입니다. 읽지 못하면 null입니다. */
  freePercent: number | null;
  /** CPU를 많이 쓰는 상위 프로세스입니다. */
  procs: Proc[];
  /** 메모리를 많이 쓰는 상위 프로세스입니다. */
  memProcs: Proc[];
  history: Sample[];
  /** 마지막 부하 측정이 실패했다면 이유입니다. */
  error: string | null;
  /** 마지막 프로세스 목록 측정이 실패했다면 이유입니다. */
  procsError: string | null;
};

/**
 * 화면에서 바꾸는 설정입니다.
 * 이름을 `Settings`로 두면 아래 `declare module 'claude-code'` 안에서 엔진이 이미 쓰는 같은 이름의 타입으로 읽혀 값의 타입이 사라집니다.
 */
export type Prefs = {
  /** 값을 새로 읽는 주기(ms)입니다. 2000·1000·500 중 하나이며, 고르는 쪽(parseInterval)이 지킵니다. */
  intervalMs: number;
  /** 접어 두었는지입니다. 접으면 한 줄 요약만 보이고 프로세스 목록 측정도 멈춥니다. */
  isCollapsed: boolean;
  /** 보여 주는 자리입니다. `pane`은 창(보통 오른쪽), `band`는 프롬프트 위의 띠(아래쪽), `off`는 띠를 닫아 아무것도 안 보이는 상태입니다. */
  position: 'pane' | 'band' | 'off';
};

declare module 'claude-code' {
  interface PluginState {
    'mac-load': { snapshot: Shaped<Snapshot>; prefs: Shaped<Prefs> };
  }
}
