/**
 * 「展开/折叠」按钮：对超过高度的 .atk-content 添加折叠按钮。
 * 支持整体调用（扫描所有 .atk-content）或对单个 dom 调用。
 */
export default function limitHight(dom: HTMLElement | null = null) {
    // 对单个 dom 调用时，若已无折叠按钮则补建
    if (dom) {
        if (!dom.querySelector('.fold-button')) {
            createFoldButton(dom);
        }
        return;
    }

    // 整体调用：扫描所有 .atk-content
    const atkBodies = document.querySelectorAll<HTMLElement>('.atk-content');
    atkBodies.forEach((highlightDiv) => {
        if (!highlightDiv.querySelector('.fold-button')) {
            createFoldButton(highlightDiv);
        }
    });

    // 监听 .atk-content 内图片加载，加载完成后重新评估是否需要折叠按钮
    document.querySelectorAll<HTMLImageElement>('.atk-content img').forEach((img) => {
        img.onload = () => {
            if (img.complete) {
                const parent = img.closest('.atk-content');
                if (parent) limitHight(parent as HTMLElement);
            }
            // 未来加载的图片
            img.onload = function () {
                const parent = img.closest('.atk-content');
                if (parent) limitHight(parent as HTMLElement);
            };
        };
        // 处理加载失败
        img.onerror = function () {
            console.error('Image failed to load:', img.src);
        };
    });
}

function createFoldButton(highlightDiv: HTMLElement) {
    if (highlightDiv.querySelector('.fold-button')) return;

    const button = document.createElement('div');
    button.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" class="book-icon"><use xlink:href="/icons.svg#fold"></use></svg><sm>展开</sm>
    `;
    button.className = 'fold-button';
    button.ariaLabel = '展开';

    button.addEventListener('click', function (evn) {
        highlightDiv.classList.toggle('limit-hight');
        const icons = highlightDiv.classList.contains('limit-hight') ? ['/icons.svg#fold', '展开'] : ['/icons.svg#collapse', '折叠'];
        const target = evn.currentTarget as HTMLElement;
        target.querySelector('svg use')?.setAttribute('xlink:href', icons[0]);
        const sm = target.querySelector<HTMLElement>('sm');
        if (sm) sm.innerText = icons[1];
    });

    if (highlightDiv.scrollHeight > 400) {
        highlightDiv.classList.add('limit-hight');
        highlightDiv.appendChild(button);
    }
}
