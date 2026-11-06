# claude-mod-mac-load

로컬 맥의 CPU·메모리 부하를 실시간으로 보여 주는 Claude Code mod(`mac-load`)입니다.
세션 옆에 창을 하나 띄워 두고, 2초마다 값을 다시 읽어 그립니다.

## 보여 주는 것

- **CPU**: 사용률 막대, 사용자·시스템·유휴 비율, 최근 약 3분의 추이 그래프
- **메모리**: 사용률 막대와 추이 그래프. 막대는 `memory_pressure`가 알려 주는 여유율을 기준으로 `100 - 여유율`을 그립니다.
- **부하 평균**: 1·5·15분 값과 코어 수
- **CPU 상위 프로세스**: CPU를 가장 많이 쓰는 5개와 각각의 메모리

값은 macOS의 `top`, `memory_pressure`, `sysctl` 출력에서 읽으므로 **macOS에서만** 동작합니다.

## 설치

Claude Code 터미널 세션의 프롬프트에서:

```
/plugin install mac-load --marketplace baboleevan/claude-mod-mac-load
```

셸에서:

```
claude plugin install mac-load --marketplace baboleevan/claude-mod-mac-load
```

데스크톱 앱에서는 프롬프트 상자 옆의 + 를 누르고 Plugins, Add marketplace에 `baboleevan/claude-mod-mac-load`를 넣은 뒤 Add plugin을 누릅니다.

처음에는 마켓플레이스를 추가할지 묻습니다. `y`로 답하고 범위(scope)를 고르면 `Installed mac-load.`가 보이고, 그 세션부터 바로 켜집니다.

## 사용

- 세션이 시작되면 창이 자동으로 열립니다.
- 터미널이 좁으면 자동으로 열린 창이 바로 보이지 않을 수 있습니다. 그럴 때나 창을 닫았을 때는 `/mac-load`를 입력하면 열립니다.
- 창은 세션이 켜져 있는 동안에만 값을 읽습니다. 세션을 닫으면 측정도 멈춥니다.

## 개발

```
claude --plugin-dir <이 폴더>   # 폴더에서 바로 불러와 실행
claude plugin validate <이 폴더>
claude plugin test <이 폴더>    # hooks/top.test.ts 실행
```

- `hooks/register.tsx`: 명령 등록, 측정 주기, 화면 그리기
- `hooks/top.ts`: `top`·`memory_pressure` 출력을 읽는 순수 함수 (엔진에 의존하지 않음)
- `types/index.d.ts`: 저장하는 값의 타입

## 알아 둘 점

- macOS 전용입니다. Linux·Windows에서는 측정에 실패했다는 문구가 보입니다.
- macOS의 `top`은 파일 캐시까지 "사용 중"으로 세어 메모리가 늘 가득 차 보입니다. 그래서 메모리 막대는 `top`의 사용량이 아니라 `memory_pressure`의 여유율을 쓰고, 여유율을 읽지 못할 때만 `top` 값으로 대신합니다.
- 화면 문구는 한국어입니다.
