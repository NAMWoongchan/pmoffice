import { defineConfig } from 'vitepress'
import publicContent from './theme/content.json'
import aiEducation from './theme/ai-education.json'
import consulting from './theme/consulting.json'
import projectScreens from './theme/project-screens.json'
import education from './theme/education.json'
import experience from './theme/experience.json'
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
  sitemap: { hostname: 'https://pmoffice.co.kr/', transformItems: items => items.filter(item => !item.url.startsWith('admin/')) },
  transformPageData(pageData) {
    if (pageData.relativePath==='404.md') {pageData.frontmatter.head=[...(pageData.frontmatter.head||[]),['meta',{name:'robots',content:'noindex'}]];return}
    const relative=pageData.relativePath.replace(/index\.md$/,'').replace(/\.md$/,'.html')
    const canonical=new URL(relative,'https://pmoffice.co.kr/').href
    const title=pageData.frontmatter.title||pageData.title||'PMOffice 피엠오피스'
    if(String(title).includes('피엠오피스'))pageData.frontmatter.titleTemplate=false
    const description=pageData.frontmatter.description||pageData.description||'피엠오피스 교육·컨설팅'
    const image='https://pmoffice.co.kr/images/consulting/'+(relative.startsWith('ms-project/')?'gantt-screen.png':relative==='consulting/experience.html'?'original-weight.png':relative==='consulting/scheduling.html'?'excel-schedule.png':relative.startsWith('ai-edu/')?'report-dashboard.png':'consulting-og.png')
    const h:any[]=[['link',{rel:'canonical',href:canonical}],['meta',{property:'og:type',content:'website'}],['meta',{property:'og:site_name',content:'PMOffice 피엠오피스'}],['meta',{property:'og:title',content:title}],['meta',{property:'og:description',content:description}],['meta',{property:'og:url',content:canonical}],['meta',{property:'og:locale',content:'ko_KR'}],['meta',{property:'og:image',content:image}],['meta',{property:'og:image:alt',content:'프로젝트 공정표와 진도 보고'}],['meta',{name:'twitter:card',content:'summary_large_image'}],['meta',{name:'twitter:title',content:title}],['meta',{name:'twitter:description',content:description}],['meta',{name:'twitter:image',content:image}]]
    const org={'@type':'Organization','@id':'https://pmoffice.co.kr/#organization',name:'피엠오피스',alternateName:'PMOffice',url:'https://pmoffice.co.kr/',logo:'https://pmoffice.co.kr/images/pmoffice-logo.png',email:'nam@pmoffice.co.kr',telephone:'02-532-8060'}
    const graph:any[]=[org]
    if(relative==='consulting/experience.html') {
      graph.push({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'홈',item:'https://pmoffice.co.kr/'},{'@type':'ListItem',position:2,name:'회사 소개',item:'https://pmoffice.co.kr/about.html'},{'@type':'ListItem',position:3,name:'주요 수행 실적',item:canonical}]})
    }
    if(pageData.frontmatter.consultingKey) {
      graph.push({'@type':'Service','@id':canonical+'#service',name:title,description,url:canonical,provider:{'@id':org['@id']}})
      graph.push({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'피엠오피스',item:'https://pmoffice.co.kr/'},{'@type':'ListItem',position:2,name:'프로젝트 관리 컨설팅',item:'https://pmoffice.co.kr/consulting/'},...(relative==='consulting/'?[]:[{'@type':'ListItem',position:3,name:title,item:canonical}])]})
    }
    if(relative==='ms-project/introduction.html') graph.push({'@type':'WebPage',name:title,description,url:canonical,about:{'@type':'SoftwareApplication',name:'Microsoft Project',applicationCategory:'Project management',operatingSystem:'Windows'}})
    const course=education.courses.find(c=>relative===c.path+'.html'||relative===c.path.replace(/index$/,''))
    if(course && course.path!=='ms-project/index') graph.push({'@type':'Course','@id':canonical+'#course',name:course.title,description:course.subtitle,url:canonical,provider:{'@id':org['@id']}})
    const aiCourse=aiEducation.courses.find(c=>relative===c.path.slice(1)); if(aiCourse) graph.push({'@type':'Course','@id':canonical+'#course',name:aiCourse.title,description:aiCourse.summary,url:canonical,provider:{'@id':org['@id']}})
    if(['ms-project/','pm-practice/','ai-edu/','consulting/experience.html'].includes(relative))graph.push({'@type':'CollectionPage','@id':canonical+'#collection',name:title,description,url:canonical,isPartOf:{'@id':'https://pmoffice.co.kr/#website'}})
    if(relative.startsWith('ms-project/')||relative.startsWith('pm-practice/')) {
      const isMs=relative.startsWith('ms-project/');const parent=isMs?'MS Project 교육':'PM 실무 교육';const parentUrl='https://pmoffice.co.kr/'+(isMs?'ms-project/':'pm-practice/');
      graph.push({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'홈',item:'https://pmoffice.co.kr/'},{'@type':'ListItem',position:2,name:parent,item:parentUrl},...(canonical===parentUrl?[]:[{'@type':'ListItem',position:3,name:title,item:canonical}])]})
    }
    if(!pageData.frontmatter.consultingKey&&relative!=='consulting/experience.html'&&!relative.startsWith('ms-project/')&&!relative.startsWith('pm-practice/'))graph.push({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'피엠오피스',item:'https://pmoffice.co.kr/'},...(relative?[{'@type':'ListItem',position:2,name:title,item:canonical}]:[])]})
    if(!relative)graph.push({'@type':'WebSite','@id':'https://pmoffice.co.kr/#website',name:'피엠오피스',url:'https://pmoffice.co.kr/',publisher:{'@id':org['@id']}})
    h.push(['script' ,{type:'application/ld+json'},JSON.stringify({'@context':'https://schema.org','@graph':graph}).replace(/</g,'\\u003c')])
    pageData.frontmatter.head=[...(pageData.frontmatter.head||[]),...h]
  },
  head: [
    ['meta', { name: 'naver-site-verification', content: '0112a94f32f342770002c2c6f0c4844e67ecb6c1' }],
    ['meta', { name: 'google-site-verification', content: '2KwL-73r2J7M7jQ9o-w52Ntt4NSqYnBEm31rlS5KvQw' }],
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
          if(env.relativePath?.startsWith('admin/')) return ''
          const html = md.render(src, env)
          if (env.frontmatter?.layout !== 'page' && env.relativePath !== 'knowledge/index.md') return html
          const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
          const relative = env.relativePath || ''
          const deck = education.courses.find(c => relative === c.path + '.md')
          const aiPage=relative.startsWith('ai-edu/') ? (aiEducation.courses.find(c=>relative===c.path.slice(1).replace(/\.html$/,'.md'))||aiEducation) : null
          const pageContent = aiPage || (relative==='consulting/experience.md' ? experience : relative==='ms-project/introduction.md' ? projectScreens.categories : relative.startsWith('consulting/') ? {page:consulting.pages[env.frontmatter.consultingKey],membership:consulting.membership} : deck || (relative.startsWith('pm-practice') ? education.courses.filter(c=>c.group==='pm') : null) || (relative.includes('copilot-for') ? publicContent.copilot : relative.includes('ai-rd') ? publicContent.rd : relative.startsWith('services') ? publicContent.services : relative.startsWith('ai-edu') ? [publicContent.rd, publicContent.copilot] : env.frontmatter?.description))
          const flatten = (value: any): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(flatten).join(' ') : value && typeof value === 'object' ? Object.entries(value).filter(([key])=>!['source','source_name','source_file','source_path','sourceSlides','source_slide','slides','referencePeriod','reviewedAt','sources'].includes(key)).map(([,entry])=>flatten(entry)).join(' ') : ''
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


