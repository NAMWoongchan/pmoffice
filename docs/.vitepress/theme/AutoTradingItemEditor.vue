<script setup>
import {computed} from 'vue'
const model=defineModel({type:Object,required:true})
defineProps({busy:Boolean,error:String})
defineEmits(['save','cancel'])
const count=computed(()=>(model.value.description||'').length)
</script>
<template>
<form class="at-item-editor" :data-editor-for="model.id" @submit.prevent="$emit('save')">
<h3>이름 및 설명 변경</h3>
<label :for="'at-name-'+model.id">거래 이름</label><input :id="'at-name-'+model.id" v-model="model.name" name="name" maxlength="160" required :disabled="busy">
<label :for="'at-description-'+model.id">설명 <small>(200자 이내)</small></label><textarea :id="'at-description-'+model.id" v-model="model.description" name="description" maxlength="200" rows="3" :disabled="busy" :aria-describedby="'at-count-'+model.id"></textarea>
<p :id="'at-count-'+model.id" class="at-editor-count">{{count}} / 200자</p>
<p v-if="error" role="alert">{{error}}</p>
<button type="submit" :disabled="busy">{{busy?'저장 중…':'저장'}}</button><button type="button" :disabled="busy" @click="$emit('cancel')">취소</button>
</form>
</template>
<style scoped>
.at-item-editor{margin-top:20px;padding:18px;border:1px solid #a4b9cc;border-radius:10px;background:#fff;max-width:650px}.at-item-editor h3{margin:0 0 15px;font-size:18px}.at-item-editor label{display:block;font-weight:600;margin:14px 0 6px}.at-item-editor input,.at-item-editor textarea{box-sizing:border-box;display:block;width:100%;padding:10px;border:1px solid #9eb1c5;border-radius:6px;font:inherit;color:#172b41;background:#fff}.at-item-editor button{margin:6px 8px 0 0;padding:9px 16px;border:1px solid #94aac0;border-radius:7px;background:#eaf2fa;font:inherit;cursor:pointer}.at-item-editor button:disabled{opacity:.5;cursor:wait}.at-editor-count{font-size:12px;color:#52677e;text-align:right}.at-item-editor [role=alert]{color:#9c2444}
</style>
