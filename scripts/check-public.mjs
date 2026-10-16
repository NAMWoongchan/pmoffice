import fs from 'node:fs'
import path from 'node:path'
const root = process.argv.includes('--dist') ? 'docs/.vitepress/dist' : 'docs'
const privateMarkers = ['sources-and-writing', 'pmoffice-sources-writing', 'github.com/NAMWoongchan/pmoffice-wiki/', 'Source Policy', 'THREAD_REGISTRY', '인증 비밀']
const allowedPages = new Set(["admin/index.md","admin/callback.md","ai-edu/ai-pm-practice.md","ai-edu/microsoft-365-copilot.md","ai-edu/ai-agent-development.md","consulting/experience.md","ms-project/introduction.md","consulting/index.md","consulting/pm.md","consulting/scheduling.md","consulting/ai/index.md","consulting/ai/chatgpt.md","consulting/ai/copilot.md","about.md", "ai-edu/ai-rd-management.md", "ai-edu/copilot-for-microsoft-project.md", "ai-edu/index.md", "contact.md", "generative-ai.md", "index.md", "knowledge/index.md", "microsoft-project.md", "ms-project/core-practice.md", "ms-project/expert.md", "ms-project/index.md", "ms-project/template-development.md", "pc-management/README.md", "pc-management/high-performance-power.md", "pm-practice/agile-project.md", "pm-practice/index.md", "pm-practice/project-management.md", "pm-practice/risk-issue-management.md", "project-management.md", "project-management/paradigm-shift.md", "services.md"])
let files = 0
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!process.argv.includes('--dist') && ['cache', 'dist'].includes(entry.name)) continue
      scan(file)
    } else {
      const rel = path.relative(root, file).replaceAll('\\', '/')
      if (!process.argv.includes('--dist') && file.endsWith('.md') && !allowedPages.has(rel)) throw Error(`공개 허용 목록에 없는 문서: ${rel}`)
      if (/\.(md|html|js|json|xml|txt|ts|mts|vue|css)$/.test(file)) {
        const text = fs.readFileSync(file, 'utf8')
        for (const marker of privateMarkers) if (text.includes(marker)) throw Error(`비공개 정보 참조 발견: ${rel}: ${marker}`)
        files++
      }
    }
  }
}
scan(root)
if (process.argv.includes('--dist')) {
  const htmlFiles = []
  const collect = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) collect(file); else if (file.endsWith('.html')) htmlFiles.push(file) } }
  collect(root)
  let links = 0
  for (const file of htmlFiles) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      const href = match[1].replaceAll('&amp;', '&')
      if (/^(https?:|mailto:|tel:)/.test(href)) continue
      const url = new URL(href, `https://site.test/${path.relative(root, file).replaceAll('\\', '/')}`)
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '')
      const target = path.join(root, rel.endsWith('/') || !rel ? `${rel}index.html` : rel)
      if (!fs.existsSync(target)) throw Error(`문서 링크 대상 없음: ${file}: ${href}`)
      if (url.hash && target.endsWith('.html')) {
        const id = decodeURIComponent(url.hash.slice(1))
        if (!fs.readFileSync(target, 'utf8').includes(`id="${id}"`)) throw Error(`문서 목차 대상 없음: ${file}: ${href}`)
      }
      links++
    }
  }
  console.log(`Internal links and heading targets passed: ${links} links.`)
}
console.log(`Public isolation check passed: ${files} text files; private settings excluded.`)
