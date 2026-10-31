# 피엠오피스 E-book 생성기

Vue 회원·관리자 앱, Cloudflare Pages 보호 API, Supabase 추가 마이그레이션, 수동 실행 PowerPoint 변환 프로그램입니다. 고객 자료는 공개 코드와 분리한 **비공개 GitHub 저장소**에 보관합니다.

고객 공개는 기본 차단입니다. 실제 대표 자료·무료 한도·운영 인증·부하 시험을 통과한 뒤 관리자가 한도를 확정해야 합니다. 코드 빌드나 로컬 모의 시험은 운영 검증이 아닙니다.

## 설치와 검사

Node.js 22 이상, pnpm 11.25.0을 사용합니다. 저장소 Root에서:

```powershell
pnpm --dir ebook-app install --frozen-lockfile
pnpm --dir ebook-app run build
pnpm --dir ebook-app test
python -m unittest discover -s ebook-app/converter -p 'test_*.py'
```

DB 시험은 이 저장소의 기존 회원 fixture·마이그레이션을 실제 PGlite에 적용합니다. `tests/ui.smoke.mjs`는 Playwright가 준비된 개발 환경에서 화면과 PDF.js를 검사하며 API는 시험 fixture입니다. `?demo=1` 예시는 localhost에서만 활성화됩니다.

화면만 확인하려면 빌드 후 

```powershell
node ebook-app/scripts/start-preview.mjs
```

Windows에서는 `미리보기_시작.cmd`를 실행해도 됩니다. 독립 프로세스로 시작하고 HTTP 상태 확인 후 주소를 안내합니다. 창을 닫아도 계속 실행되지만 PC 재시작 후에는 다시 시작해야 합니다. 시작 앱·상시 서비스·방화벽 설정은 변경하지 않습니다. 작업 실행 환경에서만 열리는 서버를 고객에게 안내하지 않도록 실제 사용자 주소와 독립 실행 유지 검사를 함께 수행합니다.

표시된 localhost 주소의 예시 데이터 화면을 사용합니다. 실제 회원·저장 API가 연결된 운영 서비스는 아닙니다.

## 운영 연결 순서

Cloudflare 로그인은 운영자가 앱과 보호 API를 자신의 계정에 배포하도록 연결하는 절차입니다. 고객의 회원 로그인은 기존 Supabase가 담당하며 고객에게 Cloudflare 계정은 필요하지 않습니다. GitHub는 코드·비공개 파일 보관, Supabase는 회원·그룹·권한, Cloudflare Pages/Functions는 서비스 실행을 맡습니다. 로컬 미리보기는 Cloudflare 로그인 없이 동작합니다. 현재 구성에서 선택한 호스팅이 Cloudflare이며 모든 이북 서비스에 반드시 필요한 유일한 제품이라는 뜻은 아닙니다.

연결 명령은 `wrangler login --scopes account:read user:read pages:write`입니다. 실제 로그인·권한 허용은 운영자가 직접 완료하고, 인증 URL·비밀번호·코드를 작업 기록에 저장하지 않습니다.

1. **회원 DB**: 기존 회원·그룹 마이그레이션 적용 여부와 백업을 확인한 뒤 `supabase/migrations/202610310001_ebooks.sql`만 추가 적용합니다. 기존 마이그레이션을 다시 실행하지 않습니다. 신규 테이블은 `pmoffice_private`에 있고 직접 접근은 차단됩니다.
2. **비공개 저장소**: `NAMWoongchan/pmoffice-ebook-data`를 Private·README 포함·기본 브랜치 main으로 준비합니다. 기존 저장소를 공개로 전환하거나 고객 파일을 홈페이지 저장소에 넣지 않습니다. `scripts/provision-data.mjs`는 안전한 환경변수로 인증을 제공했을 때 점검하며 `--apply`가 있어야 생성합니다. 토큰을 채팅·소스·로그에 붙여 넣지 않습니다.
3. **Cloudflare Pages**: GitHub 검토 완료 코드에 연결합니다. Root directory=`ebook-app`, build command=`pnpm install --frozen-lockfile && pnpm run build`, output directory=`dist`입니다. Free 플랜을 사용하며 자동 유료 전환을 설정하지 않습니다.
4. **서버 환경변수**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_DATA_REPO`, `GITHUB_DATA_TOKEN`, `CONVERTER_TOKEN`을 Cloudflare 서버 설정에 등록합니다. 데이터 토큰에는 해당 비공개 저장소의 Contents 읽기/쓰기만 부여합니다. 저장소 생성용 토큰을 서비스 운영 토큰으로 재사용하지 않습니다.
5. **로그인**: 기존 Supabase Google 설정은 유지하고 `https://ebooks.pmoffice.co.kr/auth/callback`만 허용 복귀 주소로 추가합니다. 홈페이지 로그인 연결은 기존 회원 세션을 정확히 해당 이북 origin에 `postMessage`로 전달하며 토큰을 URL·로그에 넣지 않습니다. 홈페이지 변경과 실제 Google·이메일 실계정 시험이 필요합니다.
6. **하위 도메인**: Pages에서 발급한 실제 프로젝트 주소를 확인한 뒤 `ebooks` CNAME만 추가합니다. 기존 apex·www·MX·TXT·이름 서버는 변경하지 않습니다. Cloudflare Custom domain 연결·인증서·직접 새로고침을 검사합니다. 실제 DNS 제공자가 달라 적용이 불가능하면 변경을 보류합니다.

## PC 변환 프로그램

Windows의 적법하게 사용 가능한 데스크톱 PowerPoint, Python과 `converter/requirements.txt`의 라이브러리가 필요합니다. 사용자 로그인 세션에서 직접 실행하며 서버형 무인 Office 서비스의 지원·사용권을 보장하지 않습니다.

```powershell
python -m pip install -r ebook-app/converter/requirements.txt
python ebook-app/converter/converter.py convert TEST.pdf --out LOCAL_RESULT
python ebook-app/converter/converter.py run
```

네트워크 처리에는 안전한 프로세스 환경으로 `EBOOK_API_URL`과 `EBOOK_CONVERTER_TOKEN`을 제공합니다. `converter/변환프로그램_시작.cmd`도 실행할 수 있습니다. 시작 앱·예약 작업·상시 서비스를 등록하지 않습니다. 실행 중인 동안만 15초 간격으로 대기 작업을 가져옵니다.

- 원본 50 MiB, 200쪽, 회원당 활성 10권을 검사합니다. 영구 자료는 GitHub에 남으며 PC 작업 폴더는 작업 종료 때 정리됩니다.
- 원본은 매크로·ActiveX·OLE·외부 연결·압축 폭탄을 먼저 검사합니다. 지원하지 않는 문서는 원본을 수정한 뒤 재업로드해야 합니다.
- PowerPoint 정적 PDF와 슬라이드별 MP4를 만들고, 페이지별 PDF·썸네일·검색 텍스트를 생성합니다. 클릭 진행 효과는 선형 자동 진행으로 변환합니다. 기록된 타이밍을 우선하고 미지정 슬라이드는 5초입니다.
- 원본의 애니메이션·내장 영상·음성·글꼴을 검토한 뒤 소유자 또는 관리자가 검토 완료를 선택해야 공유할 수 있습니다. 클릭 분기·대화형 슬라이드 쇼·발표자 노트·OCR은 지원하지 않습니다.
- 처리 임대는 15분이며 45초마다 갱신합니다. PC 중단 후 만료된 작업은 재시도하고, 3회 반복 중단은 실패로 전환합니다. 내용이 달라진 재시도 결과는 덮어쓰지 않고 오류로 남깁니다.
- 사용자에게 열려 있던 프레젠테이션은 닫지 않으며, 임시 보안 설정은 복원합니다. 변환 프로그램은 고객 업로드를 실행 가능한 코드로 취급하지 않습니다.

보호 파일은 1 MiB 저장 조각과 최대 8 MiB 범위 요청으로 전달합니다. 무료 Worker의 하위 요청 수를 넘기지 않도록 브라우저와 PC가 범위를 나누어 받으며, 인코딩에는 nodejs_compat의 Buffer를 사용합니다. 무료 CPU 한도 적합성은 실제 Cloudflare 배포 후 측정해야 합니다.

## 관리자·공유·사용량

정상 회원은 기본 허용이며 기존 PMS 그룹에 deny가 하나라도 있으면 차단합니다. 소유자의 그룹 차단·정지·탈퇴·계정 무효화 후 공개·공유 이북도 신규 요청을 차단합니다. 익명 링크/공개 열람과 원본 다운로드는 별도 권한입니다.

원본은 소유자·시스템 관리자만 다운로드합니다. 독자는 파생 페이지·영상만 열람합니다. 이미 전달한 데이터나 화면 캡처를 회수하는 DRM은 아닙니다.

관리자는 전체 자료·URL·상태·그룹·감사 이력을 봅니다. 삭제는 관리자 보관함으로 이동하며 물리 삭제가 아닙니다. Git 이력과 보관 자료도 용량에 영향을 줍니다.

출시 전 `max_storage_bytes`, `max_daily_jobs`, `max_daily_delivery_bytes`를 측정 후 확정합니다. 0이면 신규 처리 또는 전달을 차단합니다. 전송량에는 변환 프로그램의 원본 수신도 포함됩니다. `released=false`이면 관리자 외 고객 접근을 차단합니다. 100명 동시 열람은 실제 GitHub·Cloudflare의 인증·범위 전송·오류율·요청량으로 검증해야 하며 로컬 mock 결과를 대체 근거로 사용하지 않습니다.

## 복구

장애 시 관리자에서 `released=false`로 전환하고 PC 변환 프로그램을 종료합니다. 홈페이지는 이전 커밋으로 복구하고 이북 하위 도메인의 새 CNAME만 이전 상태로 되돌립니다. 신규 DB 테이블을 급히 삭제하지 말고 백업·보존 자료를 확인합니다. 기존 홈페이지·PMS·회원 테이블과 메일 설정은 그대로 유지합니다.

## 공식 참고

- [PDF.js](https://mozilla.github.io/pdf.js/): 페이지 렌더링.
- [PowerPoint CreateVideo](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentation.createvideo): 영상 생성 API.
- [GitHub 파일 한도](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github): 자료 보관 제약.
- [Cloudflare Pages 고급 모드](https://developers.cloudflare.com/pages/functions/advanced-mode/): `_worker.js` 배포.

제작·검증 기록에는 제작 환경 Root AGENTS.md의 진행 TXT 정책을 적용하며 고객 데이터와 함께 공개 소스에 포함하지 않습니다.

## 고객 주소와 전체 화면

고객 화면과 공유 링크는 https://pmoffice.co.kr/ebooks/view.html을 사용합니다. ebooks.pmoffice.co.kr은 DNS 연결 후 추가 주소로 사용할 수 있습니다. DNS와 HTTPS 활성화를 확인한 후 서버 CANONICAL_HOST=ebooks.pmoffice.co.kr을 설정하면 Pages 기본 주소의 화면 요청은 같은 경로의 고객 주소로 이동합니다. DNS가 준비되기 전에는 설정하지 않습니다. 전체 화면 버튼 또는 F로 읽기 화면을 넓히고 Esc로 돌아옵니다. 지원하지 않는 브라우저는 창 안에서 읽기 화면을 확대합니다.

## 홈페이지 내 서비스 주소

홈페이지의 이북 메뉴는 /ebooks/view.html로 연결합니다. 브라우저 앱은 홈페이지에서 제공하며 /ebook-app 아래에는 공개 클라이언트 파일만 복사합니다. 보호 API는 정확한 https://pmoffice.co.kr Origin에만 CORS를 허용하며 기존 회원/자료 권한을 계속 검사합니다. 빌드 전에 pnpm --dir ebook-app install --frozen-lockfile을 실행합니다. DNS 미연결 상태에서도 이 경로로 앱을 열 수 있지만 실제 파일 처리 개방 조건은 유지합니다.
