# PMOffice 피엠오피스

프로젝트 관리 교육·컨설팅·PMS 개발과 AI 실무 교육 홈페이지입니다. 기존 지식 문서는 지식 공간에서 제공합니다.

**[홈페이지 열기](https://pmoffice.co.kr/)**

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


## 홈페이지 콘텐츠 운영
사업과 교육 콘텐츠는 docs/.vitepress/theme/content.json 및 MarketingPage.vue에서 관리합니다. 지식 게시글은 기존 Markdown 경로를 유지하고 새 문서 추가 시 공개 허용 목록·분류 목록·목차를 함께 갱신합니다. 다운로드 소개서는 docs/public/downloads에 저장합니다. 원본·작업 기록은 공개 소스에 포함하지 않습니다.


## 교육 메뉴와 경로
AI 교육은 `/ai-edu/`, MS Project는 `/ms-project/`, PM 실무는 `/pm-practice/`를 사용합니다. 제목 링크는 그룹 소개로 이동하며 펼침 버튼·마우스·키보드로 하위 과정을 엽니다. 교육 내용은 `education.json`, 기존 AI 과정은 `content.json`에서 관리합니다. 새 자료 추가 후 공개 허용 목록·검색·내용 검증을 실행합니다.
