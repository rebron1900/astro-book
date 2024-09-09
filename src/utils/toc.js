import * as cheerio from 'cheerio';

function tocGen(html) {
    if (!html) return;

    const $ = cheerio.load(html);
    let tocStr = '<ul>';
    let currentH2 = null;
    let currentH3 = null;

    let els = $('h2, h3, h4');

    if (els.length == 0) {
        return;
    }

    $('h2, h3, h4').each((i, el) => {
        const tagName = $(el).prop('tagName');
        const id = $(el).attr('id');
        const title = $(el).text();

        if (tagName === 'H2') {
            if (currentH2) {
                if (currentH3) {
                    tocStr += '</ul></li>';
                    currentH3 = null;
                }
                tocStr += '</ul></li>';
            }
            tocStr += `<li><a href="#${id}">${title}</a><ul>`;
            currentH2 = id;
        } else if (tagName === 'H3') {
            if (currentH3) {
                tocStr += '</ul></li>';
            }
            tocStr += `<li><a href="#${id}">${title}</a><ul>`;
            currentH3 = id;
        } else if (tagName === 'H4') {
            tocStr += `<li><a href="#${id}">${title}</a></li>`;
        }
    });

    if (currentH3) {
        tocStr += '</ul></li>';
    }
    if (currentH2) {
        tocStr += '</ul></li>';
    }
    tocStr += '</ul>';

    return tocStr;
}

export default tocGen;
