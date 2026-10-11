import DefaultTheme from 'vitepress/theme'
import Home from './Home.vue'
import PageStatus from './PageStatus.vue'
import AnchorNavigation from './AnchorNavigation.vue'
import { h } from 'vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-before': () => h(PageStatus), 'layout-bottom': () => h(AnchorNavigation) }),
  enhanceApp({ app }) { app.component('WikiHome', Home) }
}
