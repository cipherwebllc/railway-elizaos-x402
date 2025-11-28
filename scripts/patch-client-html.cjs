const fs = require('fs');
const path = require('path');

const clientHtmlPath = path.join(__dirname, '../node_modules/@elizaos/client/dist/index.html');

if (fs.existsSync(clientHtmlPath)) {
    let content = fs.readFileSync(clientHtmlPath, 'utf8');
    const iconTag = '<link rel="apple-touch-icon" href="https://dwebxr.xyz/images/coodao.png">';

    if (!content.includes('apple-touch-icon')) {
        content = content.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />${iconTag}`);
        fs.writeFileSync(clientHtmlPath, content);
        console.log('✅ Injected apple-touch-icon into @elizaos/client/dist/index.html');
    } else {
        console.log('ℹ️ apple-touch-icon already present in @elizaos/client/dist/index.html');
    }
} else {
    console.warn('⚠️ Could not find @elizaos/client/dist/index.html to patch');
}
