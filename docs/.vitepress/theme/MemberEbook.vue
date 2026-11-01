<script setup>
import EbookApp from '../../../ebook-app/src/App.vue'
import {memberClient} from './member-service.js'
</script>
<template><section class="pmoffice-ebook-service" aria-label="피엠오피스 회원 전용 이북 서비스"><ClientOnly><EbookApp embedded :shared-auth="memberClient()" /><template #fallback><p class="ebook-loading">피엠오피스 회원 서비스를 연결하고 있습니다.</p></template></ClientOnly></section></template>
<style>
section.pmoffice-ebook-service{font-family:var(--vp-font-family-base);box-sizing:border-box;min-height:calc(100dvh - var(--vp-nav-height));background:#f5f7fa;color:#17283d}
section.pmoffice-ebook-service .app-shell{min-height:calc(100dvh - var(--vp-nav-height))}
section.pmoffice-ebook-service .sidebar{top:var(--vp-nav-height);height:calc(100dvh - var(--vp-nav-height));overflow:auto;z-index:10}
section.pmoffice-ebook-service .workspace{min-width:0}
section.pmoffice-ebook-service .topbar{display:none}
section.pmoffice-ebook-service .member-service-label{font-size:13px;font-weight:750;color:#245c91;margin:0 0 24px;line-height:1.8}
section.pmoffice-ebook-service .reading-expanded{top:var(--vp-nav-height);z-index:20;height:calc(100dvh - var(--vp-nav-height))}
section.pmoffice-ebook-service .reading-expanded>.workspace{min-height:calc(100dvh - var(--vp-nav-height))}
section.pmoffice-ebook-service .reading-expanded main{min-height:calc(100dvh - var(--vp-nav-height))}
section.pmoffice-ebook-service .reading-expanded .page-scroll{max-height:calc(100dvh - var(--vp-nav-height) - 160px)}
section.pmoffice-ebook-service .page-scroll{overscroll-behavior:contain}
.ebook-loading{padding:50px 30px}
@media(max-width:700px){section.pmoffice-ebook-service .sidebar{position:relative;top:auto;height:auto;overflow:visible}section.pmoffice-ebook-service .member-service-label{margin:0;font-size:12px}section.pmoffice-ebook-service .reading-expanded .page-scroll{max-height:calc(100dvh - var(--vp-nav-height) - 230px)}}
</style>
