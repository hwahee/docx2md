# CLAUDE.md

이 저장소에서 작업하는 AI 에이전트용 고정 전제입니다. 사람을 위한 설명은 [README.md](README.md)에 있습니다.

## 검증

- 변경 후에는 `bun run check`를 돌립니다 (prettier → eslint → tsc → knip → test, CI와 동일).

## 확정된 원칙

- `.docx`가 진실의 원천이고 Markdown은 diff를 보기 위한 생성물입니다. 출력은 **결정적**이어야 합니다: 같은 입력이면
  같은 바이트. 시각, 실행 순서, 플랫폼, 절대 경로가 출력에 들어가지 않습니다.
- 출력 규칙은 **diff가 작게 나오는 쪽**으로 정합니다(예: 표 칸 폭을 맞추지 않음). 렌더링이 예쁜 것보다 우선합니다.
- 헤더가 없는 Markdown은 덮어쓰거나 지우지 않고, `.assets`에서는 내용 해시 이름의 파일만 지웁니다(`src/sync.ts`).
- mammoth/turndown은 `src/convert/mammoth-adapter.ts`에서만 import합니다(ESLint가 막음). 라이브러리와 무관하게
  지켜야 할 것은 `src/convert/core.ts`에 둡니다.

## 출력 형식 버전

- 같은 `.docx`의 출력이 달라지는 변경(변환 규칙, 정규화, 헤더, 그림 이름, mammoth/turndown 업데이트)은 모두
  `FORMAT_VERSION`(`src/layout.ts`)을 올립니다. `src/convert/format.test.ts`가 실패하면 그런 변경입니다:
  번호를 올리고, 새 해시를 **추가**하고(옛 항목은 고치지 않음), README의 "출력 형식 버전" 표에 한 줄을 씁니다.
- 출력이 그대로인 변경에서는 번호를 올리지 않습니다. 올리면 다운스트림의 모든 생성 파일이 바뀝니다.
- mammoth와 turndown은 `package.json`에서 정확한 버전(`^` 없음)으로 고정합니다.
