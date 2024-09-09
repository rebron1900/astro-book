import 'artalk/dist/Artalk.css';
import Artalk from 'artalk';
import { createSignal, onMount } from 'solid-js';

const Comments = () => {
    onMount(() => {
        const commentinfo = { type: 'artalk', name: "1900'Blog", server: 'https://artalk.1900.live', el: '.at-comments' };

        Artalk.init({
            el: commentinfo.el, // 绑定元素的 Selector
            server: commentinfo.server, // 后端地址
            site: commentinfo.name, // 你的站点名
            pageKey: document.location.pathname + '/'
        });
    });

    return (
        <div id='comments'>
            <div>
                <h3 id='join-comments'>加入评论</h3>
            </div>
            <div class='at-comments'></div>
        </div>
    );
};

export default Comments;
