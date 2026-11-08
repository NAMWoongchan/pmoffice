<script setup>
import { ref } from 'vue'
import { call } from './pms-client.js'

const props = defineProps({ project: { type: Object, required: true } })
const emit = defineEmits(['saved', 'cancel'])
const title = ref(props.project.title)
const description = ref(props.project.description || '')
const version = ref(props.project.version)
const busy = ref(false)
const error = ref('')

async function save() {
  if (busy.value || !title.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const project = await call('nexpharm_update_project', {
      p_slug: props.project.slug,
      p_version: version.value,
      p_title: title.value.trim(),
      p_description: description.value,
    })
    emit('saved', project)
  } catch (reason) { error.value = reason.message }
  finally { busy.value = false }
}
</script>

<template>
  <form class="nex-project-editor" @submit.prevent="save">
    <h2>프로젝트 정보 수정</h2>
    <label>프로젝트 이름<input v-model="title" maxlength="160" required :disabled="busy"></label>
    <label>프로젝트 설명<textarea v-model="description" maxlength="1000" rows="3" :disabled="busy"></textarea></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <div><button type="submit" :disabled="busy || !title.trim()">정보 저장</button>
      <button type="button" :disabled="busy" @click="$emit('cancel')">닫기</button></div>
  </form>
</template>

<style scoped>
.nex-project-editor{padding:18px;border:1px solid #d6e1ef;border-radius:10px;background:#fff;margin:14px 0}
h2{font-size:19px;font-weight:700}label{display:block;margin-top:10px;font-weight:600}
input,textarea{display:block;width:100%;border:1px solid #b9cbdc;border-radius:6px;padding:8px 10px;margin:5px 0;font-weight:400}
div{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
button{padding:8px 14px;border:1px solid #b9cbdc;border-radius:7px;font-weight:650}
button[type=submit]{background:#1d52a3;color:white;border-color:#1d52a3}button:disabled{opacity:.55}
[role=alert]{color:#9a2529}
</style>
