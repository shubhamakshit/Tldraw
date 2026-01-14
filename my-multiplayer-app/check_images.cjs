const fs = require('fs');
const content = fs.readFileSync('test_page_1.svg', 'utf8');

// Find all image elements
const imagePattern = /<image[^>]*>/g;
let match;
let idx = 0;
while ((match = imagePattern.exec(content)) !== null) {
    const elem = match[0];
    const id = elem.match(/id="([^"]*)"/)?.[1] || 'no-id';
    const w = elem.match(/width="([^"]*)"/)?.[1] || '?';
    const h = elem.match(/height="([^"]*)"/)?.[1] || '?';
    const href = elem.match(/href="([^"]{0,50})/)?.[1] || '?';
    console.log(idx++, id, w+'x'+h, href.slice(0,40)+'...');
}
