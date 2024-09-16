// 脚本来自 https://blowfish.page/

import cocoMessage from './coco-message';

var scriptBundle = document.getElementById('script-bundle');
var copyText = scriptBundle && scriptBundle.getAttribute('data-copy') ? scriptBundle.getAttribute('data-copy') : '复制';
var copiedText = scriptBundle && scriptBundle.getAttribute('data-copied') ? scriptBundle.getAttribute('data-copied') : '✔';

function createCopyButton(highlightDiv) {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.type = 'button';
    button.ariaLabel = copyText;
    button.innerText = copyText;
    button.addEventListener('click', () => copyCodeToClipboard(button, highlightDiv));
    addCopyButtonToDom(button, highlightDiv);
}

function createCopyButton2(highlightDiv) {
    const button = document.createElement('div');
    button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="book-icon"><use xlink:href="/icons.svg#copy"></use></svg>
    `;
    button.className = 'copy-button';
    button.type = 'button';
    button.ariaLabel = copyText;
    button.addEventListener('click', () => copyCodeToClipboard(button, highlightDiv));
    addCopyButtonToDom(button, highlightDiv);
}

function createFoldButton(highlightDiv) {
    const button = document.createElement('div');
    button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="book-icon"><use xlink:href="/icons.svg#fold"></use></svg><sm>展开</sm>
    `;
    button.className = 'fold-button';
    button.ariaLabel = '展开';
    button.addEventListener('click', function (evn) {
        highlightDiv.classList.toggle('limit-hight');
        let icons = highlightDiv.classList.contains('limit-hight') ? ['/icons.svg#fold', '展开'] : ['/icons.svg#collapse', '折叠'];
        evn.currentTarget.querySelector('svg use').setAttribute('xlink:href', icons[0]);
        evn.currentTarget.querySelector('sm').innerText = icons[1];
    });
    if (highlightDiv.scrollHeight > 400) {
        highlightDiv.classList.add('limit-hight');
        addCopyButtonToDom(button, highlightDiv);
    }
}

async function copyCodeToClipboard(button, highlightDiv) {
    const codeToCopy = highlightDiv.querySelector('code').innerText;
    try {
        result = await navigator.permissions.query({ name: 'clipboard-write' });
        if (result.state == 'granted' || result.state == 'prompt') {
            await navigator.clipboard.writeText(codeToCopy);
        } else {
            copyCodeBlockExecCommand(codeToCopy, highlightDiv);
        }
    } catch (_) {
        copyCodeBlockExecCommand(codeToCopy, highlightDiv);
    } finally {
        codeWasCopied(button);
    }
}

function copyCodeBlockExecCommand(codeToCopy, highlightDiv) {
    const textArea = document.createElement('textArea');
    textArea.contentEditable = 'true';
    textArea.readOnly = 'false';
    textArea.className = 'copy-textarea';
    textArea.value = codeToCopy;
    highlightDiv.insertBefore(textArea, highlightDiv.firstChild);
    const range = document.createRange();
    range.selectNodeContents(textArea);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    textArea.setSelectionRange(0, 999999);
    document.execCommand('copy');
    highlightDiv.removeChild(textArea);
}

function codeWasCopied(button) {
    cocoMessage.success('代码已复制 😊');
    button.blur();
    setTimeout(function () {}, 2000);
}

function addCopyButtonToDom(button, highlightDiv) {
    highlightDiv.insertBefore(button, highlightDiv.firstChild);
}

export function initCopyButton() {
    document.querySelectorAll('pre').forEach(function (highlightDiv) {
        createCopyButton2(highlightDiv);
        createFoldButton(highlightDiv);
    });
}
