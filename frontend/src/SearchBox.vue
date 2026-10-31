<script setup>
import {ref,onMounted,onUnmounted,watch} from 'vue';
const props=defineProps({value:{type:String,default:''}}),emit=defineEmits(['search']);
const query=ref(props.value),open=ref(false),history=ref([]),root=ref(null);
watch(()=>props.value,v=>query.value=v);
function read(){try{const data=JSON.parse(localStorage.getItem('onlycampus.search')||'[]');history.value=Array.isArray(data)?data.filter(v=>typeof v==='string').slice(0,10):[]}catch{history.value=[]}}
function persist(){try{localStorage.setItem('onlycampus.search',JSON.stringify(history.value))}catch{}}
function search(term=query.value){term=term.trim().slice(0,100);if(term){history.value=[term,...history.value.filter(v=>v!==term)].slice(0,10);persist()}query.value=term;open.value=false;emit('search',term)}
function remove(term){history.value=history.value.filter(v=>v!==term);persist()}
function outside(e){if(!root.value?.contains(e.target))open.value=false}
onMounted(()=>{read();document.addEventListener('pointerdown',outside)});onUnmounted(()=>document.removeEventListener('pointerdown',outside));
</script>
<template><div ref="root" class="search-box" @keydown.esc="open=false" @focusout="e=>{if(!root.contains(e.relatedTarget))open=false}"><form class="search-input-wrap" @submit.prevent="search()"><input v-model="query" maxlength="100" placeholder="搜索 OnlyCampus" aria-label="搜索文章" :aria-expanded="open" @focus="read();open=true"><button type="submit" aria-label="提交搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg></button></form><section v-if="open" class="search-history" aria-label="最近搜索"><header><strong>最近搜索</strong><button v-if="history.length" @click="history=[];persist()">清空</button></header><p v-if="!history.length">暂无搜索记录</p><div v-for="term in history" :key="term" class="history-row"><button @click="search(term)">{{term}}</button><button :aria-label="'删除搜索 '+term" @click="remove(term)">×</button></div></section></div></template>
