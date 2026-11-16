<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { call } from './pms-client.js'
import { cleanComment } from './nexpharm-center.js'

const props = defineProps({ project: Object })
const emit = defineEmits(['posted', 'close'])
const comments = computed(() => Boolean(props.project))
const title = ref('')
const body = ref('')
const editor = ref(null)
const entries = ref([])
const busy = ref(false)
const loading = ref(false)
const more = ref(false)
const error = ref('')
const notice = ref('')
const closeButton = ref(null)
const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })

async function read(older = false) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const params = older ? { p_before: entries.value.at(-1).id } : {}
    if (comments.value) params.p_slug = props.project.slug
    const result = await call(comments.value ? 'nexpharm_comments' : 'nexpharm_posts', params)
    entries.value = older ? [...entries.value, ...result] : result
    more.value = result.length === 25
  } catch (reason) { error.value = reason.message }
  finally { loading.value = false }
}

async function submit() {
  if (busy.value) return
  const content = comments.value ? cleanComment(editor.value.innerHTML) : null
  error.value = ''
  notice.value = ''
  if (comments.value && (!content.text || content.html.length > 12000)) {
    error.value = '코멘트 내용을 확인해 주세요. 서식을 포함해 최대 12,000자입니다.'
    return
  }
  if (!comments.value && (!title.value.trim() || !body.value.trim())) return
  busy.value = true
  try {
    if (comments.value) {
      await call('nexpharm_add_comment', { p_slug: props.project.slug, p_body: content.html })
      editor.value.innerHTML = ''
      emit('posted', props.project.slug, content.html)
    } else {
      await call('nexpharm_add_post', { p_title: title.value.trim(), p_body: body.value.trim() })
      title.value = ''
      body.value = ''
    }
    notice.value = '등록했습니다.'
    await read()
  } catch (reason) { error.value = reason.message }
  finally { busy.value = false }
}
function format(command) {
  editor.value.focus()
  document.execCommand(command, false)
}
function plainPaste(event) {
  document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
}
onMounted(async () => {
  if (comments.value) { await nextTick(); closeButton.value?.focus() }
  await read()
})
</script>

<template>
  <section class="nex-activity" :class="{ 'nex-drawer': comments }" :aria-label="comments ? '프로젝트 상세 정보' : '게시판 글 목록'"
    @keydown.esc="comments && emit('close')">
    <header v-if="comments" class="nex-activity-heading">
      <div><h2>프로젝트 상세 정보</h2><p>{{ project.title }}</p></div>
      <button ref="closeButton" class="nex-button" type="button" @click="emit('close')">닫기</button>
    </header>
    <form class="nex-compose" @submit.prevent="submit">
      <template v-if="comments">
        <h3 id="nex-comment-label">코멘트 추가</h3>
        <fieldset :disabled="busy" class="nex-format" aria-label="코멘트 서식">
          <button type="button" title="굵게" aria-label="굵게" @mousedown.prevent @click="format('bold')"><b>B</b></button>
          <button type="button" title="기울임" aria-label="기울임" @mousedown.prevent @click="format('italic')"><i>I</i></button>
          <button type="button" title="밑줄" aria-label="밑줄" @mousedown.prevent @click="format('underline')"><u>U</u></button>
          <button type="button" aria-label="글머리 기호" @mousedown.prevent @click="format('insertUnorderedList')">• 목록</button>
          <button type="button" aria-label="번호 목록" @mousedown.prevent @click="format('insertOrderedList')">1. 목록</button>
        </fieldset>
        <div ref="editor" class="nex-editor" :contenteditable="!busy" role="textbox" aria-multiline="true"
          aria-labelledby="nex-comment-label" @paste.prevent="plainPaste" @drop.prevent />
      </template>
      <template v-else>
        <h2>글 작성</h2>
        <label>제목<input v-model="title" maxlength="160" required :disabled="busy"></label>
        <label>내용<textarea v-model="body" maxlength="6000" rows="5" required :disabled="busy"></textarea></label>
      </template>
      <button class="nex-button nex-primary" :disabled="busy || loading" type="submit">
        {{ busy ? '등록 중…' : comments ? '코멘트 등록' : '글 등록' }}
      </button>
      <span v-if="notice" role="status">{{ notice }}</span>
    </form>
    <p v-if="error" class="nex-notice" role="alert">{{ error }} <button type="button" class="nex-button" @click="read()">다시 확인</button></p>
    <h3>{{ comments ? '코멘트' : '게시글' }}</h3>
    <p v-if="loading && !entries.length" role="status">불러오는 중…</p>
    <p v-else-if="!entries.length && !error">{{ comments ? '등록된 코멘트가 없습니다.' : '등록된 글이 없습니다.' }}</p>
    <article v-for="entry in entries" :key="entry.id" class="nex-entry">
      <h3 v-if="!comments">{{ entry.title }}</h3>
      <p class="nex-entry-meta"><strong>{{ entry.author }}</strong><time :datetime="entry.created_at">{{ date.format(new Date(entry.created_at)) }}</time></p>
      <div v-if="comments" class="nex-rich" v-html="cleanComment(entry.body).html" />
      <p v-else class="nex-plain">{{ entry.body }}</p>
    </article>
    <button v-if="more" class="nex-button" type="button" :disabled="loading || busy" @click="read(true)">이전 {{ comments ? '코멘트' : '글' }} 더 보기</button>
  </section>
</template>
