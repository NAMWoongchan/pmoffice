import DefaultTheme from 'vitepress/theme'
import Home from './Home.vue'
import KnowledgeHome from './KnowledgeHome.vue'
import MarketingPage from './MarketingPage.vue'
import BrandNav from './BrandNav.vue'
import EducationPage from './EducationPage.vue'
import PageStatus from './PageStatus.vue'
import { h } from 'vue'
import './style.css'
import './brand.css'
import './education.css'
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-before': () => h(PageStatus), 'nav-bar-content-after': () => h(BrandNav) }),
  enhanceApp({ app }) { app.component('WikiHome', Home); app.component('KnowledgeHome', KnowledgeHome); app.component('MarketingPage', MarketingPage); app.component('EducationPage', EducationPage) }
}


