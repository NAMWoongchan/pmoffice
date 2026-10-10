# PMOffice Wiki

프로젝트 관리와 실무 도구를 위한 공개 지식 공간입니다.

**[홈페이지 열기](https://namwoongchan.github.io/pmoffice-wiki-site/)**

| 분야 | 문서 |
|---|---|
| 프로젝트 관리 | [분야 안내](docs/project-management.md) |
| MS Project | [분야 안내](docs/microsoft-project.md) |
| 실전 AI | [분야 안내](docs/generative-ai.md) |
| 테크 | [분야 안내](docs/pc-management/README.md) · [고성능 전원 관리](docs/pc-management/high-performance-power.md) |

분야 안내는 초안이며, 기술 문서는 본문에 명시한 출처와 검증 한계를 확인하십시오.

## 문서와 홈페이지 갱신

`docs`의 공개 문서를 수정하면 `main` 반영 후 GitHub Actions가 홈페이지를 갱신합니다.

VitePress 1.6.4 · Node.js 22 · pnpm 11.25.0 · `pnpm install --frozen-lockfile` · `pnpm run docs:build` · `pnpm run docs:preview`.

빌드 전후에 공개 문서 허용 목록과 제외 대상 참조를 검사합니다. 빌드는 이 저장소의 파일만 사용합니다.

작업 기록은 제작 환경의 Root AGENTS.md '대화·작업 진행 TXT 기록 규칙 v1.4'를 따르며 공개 소스에 포함하지 않습니다.

관련 근거: [VitePress 문서](https://vitepress.dev/) · [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
