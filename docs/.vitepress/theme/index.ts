import MemberPortal from './MemberPortal.vue'
import MemberKnowledge from './MemberKnowledge.vue'
import PmsPortal from './PmsPortal.vue'
import PmsAdmin from './PmsAdmin.vue'
import InquiryAdmin from './InquiryAdmin.vue'
import AiEducation from './AiEducation.vue'
import './ai-education.css'
import MainLanding from './MainLanding.vue'
import CoreServices from './CoreServices.vue'
import ExperiencePage from './ExperiencePage.vue'
import ExperienceProof from './ExperienceProof.vue'
import InquiryPanel from './InquiryPanel.vue'
import AiLearning from './AiLearning.vue'
import EducationSupport from './EducationSupport.vue'
import './release.css'
import ProjectIntroduction from './ProjectIntroduction.vue'
import './project-intro.css'
import ConsultingPage from './ConsultingPage.vue'
import ConsultingTeaser from './ConsultingTeaser.vue'
import './consulting.css'
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
  enhanceApp({ app }) { app.component('MemberPortal',MemberPortal); app.component('MemberKnowledge',MemberKnowledge); app.component('PmsPortal',PmsPortal); app.component('PmsAdmin',PmsAdmin); app.component('InquiryAdmin',InquiryAdmin); app.component('AiEducation',AiEducation); app.component('MainLanding',MainLanding); app.component('CoreServices',CoreServices); app.component('ExperiencePage',ExperiencePage); app.component('ExperienceProof',ExperienceProof); app.component('InquiryPanel',InquiryPanel); app.component('AiLearning',AiLearning); app.component('EducationSupport',EducationSupport); app.component('ProjectIntroduction', ProjectIntroduction); app.component('ConsultingPage', ConsultingPage); app.component('ConsultingTeaser', ConsultingTeaser); app.component('WikiHome', Home); app.component('KnowledgeHome', KnowledgeHome); app.component('MarketingPage', MarketingPage); app.component('EducationPage', EducationPage) }
}



import './academy-redesign.css'
import './member.css'
