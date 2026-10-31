import { createApp } from 'vue';
import { createRouter,createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/',component:App},{path:'/articles',component:App},{path:'/articles/:id',component:App},{path:'/users/:id',component:App},{path:'/me/favorites',component:App},{path:'/login',component:App}],scrollBehavior(to,from,saved){if(saved)return saved;if(to.hash)return {el:to.hash,top:20};return {top:0}}});
createApp(App).use(router).mount('#app');
