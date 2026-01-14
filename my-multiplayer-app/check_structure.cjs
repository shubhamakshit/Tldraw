const fs = require('fs');
const content = fs.readFileSync('test_page_1.svg', 'utf8');

// Find defs section
const defsMatch = content.match(/<defs>([\s\S]*?)<\/defs>/);
if (defsMatch) {
    const defsContent = defsMatch[1];
    const imagesInDefs = (defsContent.match(/<image/g) || []).length;
    console.log('Images inside <defs>:', imagesInDefs);
}

// Find images outside defs
const withoutDefs = content.replace(/<defs>[\s\S]*?<\/defs>/g, '');
const imagesOutside = (withoutDefs.match(/<image/g) || []).length;
console.log('Images outside <defs>:', imagesOutside);

// List all image IDs
const imagePattern = /<image[^>]*id="([^"]*)"[^>]*/g;
let m;
console.log('\nAll images:');
while ((m = imagePattern.exec(content)) !== null) {
    const inDefs = defsMatch && defsMatch[0].includes(m[0]);
    console.log(' -', m[1], inDefs ? '(in defs)' : '(outside)');
}
