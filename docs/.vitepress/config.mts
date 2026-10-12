import { defineConfig } from 'vitepress'
import publicContent from './theme/content.json'
import education from './theme/education.json'
import { textbookSidebar } from './textbook-sidebar'
const sectionLink = (page: string, heading: string) => `${page}#${heading.normalize('NFKD')}`

export default defineConfig({
  appearance: false,
  title: 'PMOffice 피엠오피스',
  description: '프로젝트 관리 교육·컨설팅·PMS 개발과 생성형 AI 실무 교육',
  lang: 'ko-KR',
  base: '/',
  cleanUrls: false,
  lastUpdated: true,
  sitemap: { hostname: 'https://pmoffice.co.kr/' },
  head: [
    ['meta', { name: 'theme-color', content: '#ffffff' }],
    ['link', { rel: 'icon', href: '/pmoffice.svg', type: 'image/svg+xml' }]
  ],
  themeConfig: {
    logo: {src:'/images/pmoffice-logo.png',alt:'피엠오피스 PM OFFICE 프로젝트 관리 업그레이드'},

    nav: [],
    siteTitle: false,
    sidebar: {
      '/project-management/paradigm-shift': textbookSidebar,
      '/': [
      { text: '지식 공간', link: '/knowledge/index' },
      { text: '프로젝트 관리', link: '/project-management', collapsed: false,
        items: [{ text: '분야 안내', link: '/project-management' }, { text: '프로젝트 관리 패러다임 시프트', link: '/project-management/paradigm-shift' }, { text: '작성 전 확인', link: sectionLink('/project-management', '작성-전-확인') }] },
      { text: 'MS Project', link: '/microsoft-project', collapsed: true,
        items: [{ text: '분야 안내', link: '/microsoft-project' }, { text: '적용 범위와 검증', link: sectionLink('/microsoft-project', '적용-범위와-검증') }] },
      { text: '실전 AI', link: '/generative-ai', collapsed: true,
        items: [{ text: '분야 안내', link: '/generative-ai' }, { text: '작성과 검토', link: sectionLink('/generative-ai', '작성과-검토') }] },
      { text: '테크', link: '/pc-management/README', collapsed: false,
        items: [{ text: '분야 안내', link: '/pc-management/README' }, { text: '고성능 전원 관리', link: '/pc-management/high-performance-power' }] }
    ]
    },
    outline: { level: [2, 3], label: '이 문서의 목차' },
    docFooter: { prev: '이전 문서', next: '다음 문서' },
    lastUpdated: { text: '문서 변경일', formatOptions: { dateStyle: 'medium', timeZone: 'Asia/Seoul' } },
    darkModeSwitchLabel: '화면 테마', darkModeSwitchTitle: '어두운 화면으로 전환', lightModeSwitchTitle: '밝은 화면으로 전환',
    sidebarMenuLabel: '메뉴', returnToTopLabel: '맨 위로',
    search: {
      provider: 'local',
      options: {
        _render(src, env, md) {
          const html = md.render(src, env)
          if (env.frontmatter?.layout !== 'page' && env.relativePath !== 'knowledge/index.md') return html
          const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
          const relative = env.relativePath || ''
          const deck = education.courses.find(c => relative === c.path + '.md')
          const pageContent = deck || (relative.startsWith('pm-practice') ? education.courses.filter(c=>c.group==='pm') : null) || (relative.includes('copilot-for') ? publicContent.copilot : relative.includes('ai-rd') ? publicContent.rd : relative.startsWith('services') ? publicContent.services : relative.startsWith('ai-edu') ? [publicContent.rd, publicContent.copilot] : env.frontmatter?.description)
          const flatten = (value: any): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(flatten).join(' ') : value && typeof value === 'object' ? Object.values(value).map(flatten).join(' ') : ''
          return `<h1 id="page-title">${escape(env.frontmatter?.title || 'PMOffice')}<a class="header-anchor" href="#page-title"></a></h1><p>${escape(flatten(pageContent))}</p>`
        },

        miniSearch: {
          options: {
            tokenize(text: string) {
              const words = text.toLocaleLowerCase('ko-KR').match(/[\p{L}\p{N}]+/gu) || []
              return [...new Set(words.flatMap(word => /^[가-힣]+$/.test(word)
                ? [word, ...Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2))]
                : [word]))]
            }
          },
          searchOptions: { prefix: true, fuzzy: 0.2 }
        },
        translations: {
          button: { buttonText: '문서 검색', buttonAriaLabel: '문서 검색' },
          modal: { displayDetails: '상세 결과 표시', resetButtonTitle: '검색어 지우기', backButtonTitle: '검색 닫기', noResultsText: '검색 결과가 없습니다.',
            footer: { selectText: '선택', selectKeyAriaLabel: 'Enter', navigateText: '이동', navigateUpKeyAriaLabel: '위쪽 화살표', navigateDownKeyAriaLabel: '아래쪽 화살표', closeText: '닫기', closeKeyAriaLabel: 'Esc' } }
        }
      }
    }
  }
})


