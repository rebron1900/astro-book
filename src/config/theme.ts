export interface ThemeConfig {
    name: string;
    desc: string;
    type: 'light' | 'dark' | 'auto';
    info?: string;
}

export const themes: ThemeConfig[] = [
    { name: 'light', desc: '月牙白', type: 'light' },
    { name: 'dark', desc: '极夜黑', type: 'dark' },
    { name: 'yayu', desc: '雅余黄', type: 'dark', info: '<a href="https://yayu.net/" target="_blank" >💖来自雅余，一位喜欢极简生活的博主！</a>' },
    { name: 'yuhang', desc: '昱行粉', type: 'dark', info: '<a href="https://yuhang.ch/" target="_blank">💖来自陈昱行，一位极简博主！</a>' },
    { name: 'herblue', desc: '她的蓝', type: 'dark', info: '<a href="https://wind.ink/" target="_blank">💖来自风清，一位摄影博主，博客「她的蓝」！</a>' },
    { name: 'onojyun', desc: '莫比乌斯', type: 'light', info: '<a  href="https://onojyun.com/" target="_blank">💖来自莫比乌斯，一位文字工作者！</a>' },
    { name: 'dbushell', desc: '香草绿', type: 'dark', info: '<a  href="https://dbushell.com/" target="_blank">💖来自dbushell！</a>' },
    { name: 'auto', desc: '自适应', type: 'auto' }
];
