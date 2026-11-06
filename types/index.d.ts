/** 상위 프로세스 한 건입니다. 메모리는 top이 준 글자 그대로(예: 2266M-)입니다. */
export type Proc = { pid: number; command: string; cpu: number; mem: string };

/** 그래프에 쓰는 한 시점의 사용률(%)입니다. */
export type Sample = { cpu: number; mem: number };

/** 패널이 그리는 값 전부입니다. */
export type Snapshot = {
  /** 첫 측정이 끝났는지입니다. */
  isReady: boolean;
  /** 마지막으로 값을 받은 시각(ms)입니다. */
  at: number;
  cores: number;
  cpu: { user: number; sys: number; idle: number };
  load: [number, number, number];
  mem: { usedGb: number; totalGb: number; wiredGb: number; compressedGb: number };
  /** `memory_pressure`가 알려 주는 시스템 전체 메모리 여유율(%)입니다. 읽지 못하면 null입니다. */
  freePercent: number | null;
  procs: Proc[];
  history: Sample[];
  /** 마지막 측정이 실패했다면 이유입니다. */
  error: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'mac-load': { snapshot: Shaped<Snapshot> };
  }
}
