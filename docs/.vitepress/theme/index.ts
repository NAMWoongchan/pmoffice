import DefaultTheme from 'vitepress/theme'
import Home from './Home.vue'
import KnowledgeHome from './KnowledgeHome.vue'
import MarketingPage from './MarketingPage.vue'
import PageStatus from './PageStatus.vue'
import { h } from 'vue'
import './style.css'
import './brand.css'
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-before': () => h(PageStatus) }),
  enhanceApp({ app }) { app.component('WikiHome', Home); app.component('KnowledgeHome', KnowledgeHome); app.component('MarketingPage', MarketingPage) }
}
