<script setup>
defineProps({post:{type:Object,required:true}});
</script>
<template>
  <article class="post">
    <RouterLink :to="'/users/'+post.authorId" class="avatar" :aria-label="post.author+'的主页'">{{post.author?.slice(0,1)}}</RouterLink>
    <div class="post-content">
      <div class="post-byline"><RouterLink :to="'/users/'+post.authorId" class="post-author">{{post.author}}</RouterLink><time v-if="post.publishedAt" class="post-date" :datetime="post.publishedAt">· {{new Date(post.publishedAt).toLocaleDateString('zh-CN',{month:'long',day:'numeric'})}}</time></div>
      <RouterLink :to="'/articles/'+post.id" class="post-story"><h2>{{post.title}}</h2><p>{{post.summary}}</p><img v-if="post.coverPath" :src="post.coverPath" alt="" loading="lazy"></RouterLink>
      <div class="post-actions"><RouterLink :to="'/articles/'+post.id+'#comments'" aria-label="查看评论"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 11.5a7.8 7.8 0 0 1-8 7.5 8.8 8.8 0 0 1-3-.5L4 20l1.3-4A7.2 7.2 0 0 1 4 11.5 7.8 7.8 0 0 1 12 4a7.8 7.8 0 0 1 8 7.5Z"/></svg><span>评论</span></RouterLink></div>
    </div>
  </article>
</template>
