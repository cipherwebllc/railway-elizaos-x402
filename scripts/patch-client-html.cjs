const fs = require('fs');
const path = require('path');

// Paths
const clientDistPath = path.join(__dirname, '../node_modules/@elizaos/client/dist');
const clientHtmlPath = path.join(clientDistPath, 'index.html');
const serverDistPath = path.join(__dirname, '../node_modules/@elizaos/server/dist/client');

// Default 180x180 apple-touch-icon as base64 PNG (simple blue gradient with "C" letter)
const DEFAULT_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAACXBIWXMAAAsTAAALEwEAmpwYAAAEsklEQVR4nO3dW5LbIBAF0Mxq8v/LnlQ+xLEMSLzafc5XypYl0xdoQMN/AwDk8nf0AQBMEWigSKCBIoEGigQaKBJooEigYd7D79+/jz4GmPT4f/9++DHDP4aHw/8O/xoe/ufw8P+L8fD/D/hweAh9/xgebn55OBLoD/z6/PnPNb98+XLYcdxL/f7+/e+/3/74JfQdf/2L8fD/D/jInyNPaZjy0Evoh7u+/O7hYfMXI/vvIRKf0rfhvoeXz59v/u7u3+PHXp8bPy79V/D796+bv+u4h4O+hw+Xoek69BH6Gz9e1+/vP958LP2u9Y56/s+s+uX0//X9I/v3t39++/+OwNdwz48P7wN5+OHh0K8f/nrm/+HQPN7T44qHu/y/h/4++v2/e2/h8fBX6A8euQc8xsOhM/3wOx7+xyF/H/XhLj+u9P3h4e4v0B947O/xI9J/vvnhw//3wR+f4u7ho/95UO4OvYcej/3f4VmHh/7h7j+uu4cP/7+Hu/97+LDP3+GJXx/+4SF+nOrhYT77/MHhf37Y4bP+hNKHl/Lh0Lw89Md1xK8Pj73Dofn87vCU+37kKf3D4/7cC/Bw17f/+fDfQ++h/8ghh/5Hux/+5/Dhn08Nf0N+C/1wuHv4x4d7Hh6SyG/0+tPDofmy+8N/Pu7u4e7//T30D4fn6z3cPdztwx2/73H3cPfw0N/n8fN/Dw//9+G/h/v8/3APDw//c/gfHv7zw10OT+fPPe7+4UPv8PD/HO7y4xI/HPo9vAR+C3cPj/fLof8cfvhH/Bz+8D+Hhz/8P08N//+h3cPhf/73cPcPD/c4fA8P/X38e7j74cPew93//u7hR/78D3f/+a7fPdz9x/18ub+HB4f+8H/u/uHhbn/+ex/+8T8Pd/9xlx+n+4fe4e4fHnJIDn/3cPfP/3C4678Pfx/uHu7u4UPy8I84PPQPd/95d/+44O7h7p//4e7/fvgQO+764V6H7u7hbu/h7uHuH+4e7v7hwx7u+uFuhwdp6Pd56A93+/C4h3d5aN49POL3kUN/uPu/H+7uH+524e4fHnro//+h0V2f7uHu3+/hwR/6w93//e7h0B8OzeHh/4e7/Pj3cPdw93D3D/+Iw3+4+/d3Dw9xeO664y4f7vHhkD/uuOuvD/d8uke760887u7hIYb+cPf/d7j74bvn7h8O8cPu4eFuhz/E3T/c6/DdPtz9/+964XEP7/bhYYcn7k/0cJcPD/l0t5/u/vNd/njEoTvc/d8P/XD3n+/+4xLfL/fdfnm4l4fn/XCXH+944S5/vMf3c5cf9zg8JIdHerrzjwsdnvDpUf/3sM/d7/7hwz4Pd/9xhx9X/HBoDnf/+E4P/+Oh/+/u/+7+4U6Hu4fH/Xnkh/+5+4cPfbjbhzt+usePu3x4xIdD/rjUh0N8uNuHu/t4qcOjPtzjwz1+3OPDh+ThyX+5y4e7fLjT04c/0sNdPtzjw73u+uGe3+7+4V1+vPvhuTs89OGen+7+73Y5/F2H/37o//tw148bPu/h0T/c8du93++hf1zxyx4eHvJxjw/3unie4y7/d/f30D/u8v+O+P9Df7j7x7v+e+0Pd/n2bgfv/v0ODw/9cLcPj/i422/3eOjP7/7hbo7hPw/+cNcPd/3xkR/u9d89HvLH3X7cz5d7+vBO//3hf+7ufz/8/z/cxe8e7v7hLh+ey4f//e4f7vLhEYfn/ukPh/7wSIe7f/wOD/+Df9z1yz0+/CPu/vGuH+7l4z08JIfv/OMuHx7x3z0e+uO7P9zlw10//MgPd/txjx/v+uH/HB76420O/3r3f/+Rh3/94e5/3+3DM3542IPJf73b9zs8/ON/uPvHu334R9z1xz0+3P3D3T/c48Pz+XL3n//y4Z6vfLjbh3f5dI8Ph/hwlw93+/A+P/6Rh/7wv+/+/d0+3OXbOzz0wx0f7uXjAx/+94c/3OXD3T/c/b97+Mcd3kN/uPu/d/f+Hh/u8u3dPtzlv9c+fK8fn/5xj0/3/HG3D+9yyM+b+M+Hu3y4+8N5ynv4cPd/v+OXu3140B8f9eFeH+7l46M+POrDu/z4qA93+/CuP+7y4bPD3T/c5b8f+uFuh7t/+Mcd/vuH/3roD3c53P3jLh++6493+/H+Pjzig90+3O2/F/Ptnv+8x393+XA3//vQP97jwz0/HOLhHh/u+nB33+/y4S4f7vJ99dv9fdQPDz3c7cc9/runf7i7h7t+eMSHO/75QYf/8uH/3N2/38PHQx/u/u93v/u/2907/HnXh7t/eJcf7/Jwt58e+fBfP9ztwz0+3PXhrof+cPcPz+fLff+3f37n57t8eMiHOz/c88Pdfr7Hfx/04V4f7uXh7h/u5cP7/Pj3D/f47y4f7vrhnj/u5eMeHu7l410+/MPH/+/hX4e7fbj7h3v+eI8P93L4u8uPdzy8+8e7fLjnj3f/8C4Pd/1wyA/3+PFuH+724d4+3u3hLh/u5eEdP9zrw73+cLcP9/pxl/9e8fBdPtz9w11/uNu3u3u4y39f9PBFf3z3D3f/8C4f7v7hbh/u9eFePjzqw73+cLc/3+XDvX5c8cO7fHi3P+/2434O/+PD3X7c88O7Hh764+4f7vbjLh/e/cO9/niXD+/64V0/vNsfd/m/D/1w9w/v+uFOH+7l4y5/vtOHuz3c9eN3//BuH+7140M/vNuHd/tx5cMD/u/hHh/u+uHuP+72334u+7jD4W4O//PDnT/c48P7PLzjwz1/eMSHe/1494/38t+jvt/jwzt+uJeHu/341x/u5fv9+fBOf77rn3f/8K4f7vrh3T8c4se7/3j3D3f9cO8f9/Thnj/c/cd7/HD3D/dy+Lufr3R46IcLX+n2cLeH+3i4l8MjP9z9u3v4eIgf7/bhbg93+3D3hzt/uJf/fuiHe/1wL4dHfbjrw90+3OPH3X/c3cO9HB754e4/3OXD3X+424d7fbjnj3f9cLcPd/twL4d7e7jLh3v6cPcP9/hwl4e7/flO/+9wHw/v/uFdHu7pw90+3OXhnT7czcO9fbibh3v6cC//fd+Hd/1wz4e7/7inw91+uJePd/3znT7c3ce7f7jHh7s5vMuH+zn81w93/+Fd/n/3n+/64V0+3N3D3T/c44d7erj7h3t5uKfD3R7u6fCeHu7t4Z4+3O3D3R7u4eHd/rz74e4e7unhnh7u+nD3D/fycE+Hu3u4p4e7Otztw90e7u7hHh/u6eGeHu7u4e4/3uvDvX24u8M9PdzTwz093NPD3R7u6eHuDnf7cC8P9/JwN4e7e7j7w718uKeHuzvc7eFdPtzLwz083OXhHg739HAvD3d5uMvDPR3u9nC3h7s93N3hLg93+XBPD3d7uMvD3R7u8nB3h7t+uJeHd3u424e7e7iXh3t6uLuHe/pwLw/39HCXh7s73OXh7h/u6eFuD3f58K4f7u3h7h7u5eFu/vzQD3d7uJfD3R7u7uFuD3f3cE8P93K4x4d7erjLw90d7u7hbh/u8uFeHu7u4d4e7uHhXh7u8uHdHu7p4Z4+3N3DvTzc08O9PNzbw90+3OPDvTzc28O9PNzrw70+3OvD3T7c48O7fHiXD/f6cG8P7/Jwtw/v8uGePtzTw709vMuHez3c3cO9PNzT4e4e7vXh3h7u9XB3D/f4cI8P9/Zw7w/v9uFdPrzLh3t9uNeHe3x4xw/38nCvD/f28C4f3uXDu364x8O7fLjHh3t9uNeHe3u424d3+XB3D+/y4V4+3OvD3T3c68O9Ptzjw70+3OPDvT7c28O9PNz94d0+3OPDu3y414d7fLjnh7t9uJeHe3u4x4d7fbi7h3t9uNeHe324t4e7e7inh3t9uNeHe3245w/39nCPD/f8cM8f7vHhXh/u8eFeH+714V4f7v3D3T3c68O9Ptzrw70+vMuHd/3wjg/3+HCvD/f48I4P7/zh3h/u+cM9P9z7wz0/3PvDvT/c+8O9f7j3h3v+8O4f7v3h3h/u/eHeH+75w70/3PvDPX+414d7fbjXh3v9cM8f7vnDvT/c88O9P9z7wz1/uPeHe/5w7w/3/OHeH+714V4f7vXhXh/u+cO9P9zzh3v/cM8P9/5w7x/u+cO9f7j3D/f+cM8f7v3h3h/u/cM9f7jnD/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4f7v3D3T/c+4d7/3DvH+75wz1/uPcP9/7h3j/c+8O9f7jnD/f+4d4/3PuHe/9w7x/u/cM9f7jnD/f+4d4/3PuHe/5wzx/u/cO9f7j3D/f84d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuHe/9w7x/u/cO9f7j3D/f+4d4/3PuH/x8nNPi/4xMfAAAAAElFTkSuQmCC';

// Create icon buffer from base64
function getIconBuffer() {
    return Buffer.from(DEFAULT_ICON_BASE64, 'base64');
}

// Copy icon to destination folder
function copyIconTo(destPath) {
    try {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.writeFileSync(destPath, getIconBuffer());
        console.log(`✅ Created apple-touch-icon at: ${destPath}`);
        return true;
    } catch (error) {
        console.warn(`⚠️ Could not create icon at ${destPath}: ${error.message}`);
        return false;
    }
}

// Patch HTML to include apple-touch-icon
function patchHtml(htmlPath, iconPath = '/apple-touch-icon.png') {
    if (!fs.existsSync(htmlPath)) {
        console.warn(`⚠️ HTML file not found: ${htmlPath}`);
        return false;
    }

    let content = fs.readFileSync(htmlPath, 'utf8');

    // CooDAO icon URL - use external URL for apple-touch-icon
    const coodaoIconUrl = 'https://dwebxr.xyz/images/coodao.png';

    // iOS PWA meta tags for better home screen experience
    const pwaTags = `
    <link rel="apple-touch-icon" sizes="180x180" href="${coodaoIconUrl}">
    <link rel="apple-touch-icon-precomposed" sizes="180x180" href="${coodaoIconUrl}">
    <link rel="icon" type="image/png" href="${coodaoIconUrl}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Coo">`;

    if (!content.includes('apple-touch-icon')) {
        // Try different injection points
        if (content.includes('<meta charset="UTF-8" />')) {
            content = content.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />${pwaTags}`);
        } else if (content.includes('<meta charset="UTF-8">')) {
            content = content.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">${pwaTags}`);
        } else if (content.includes('</head>')) {
            content = content.replace('</head>', `${pwaTags}\n</head>`);
        } else {
            console.warn('⚠️ Could not find injection point in HTML');
            return false;
        }

        fs.writeFileSync(htmlPath, content);
        console.log(`✅ Injected apple-touch-icon into: ${htmlPath}`);
        return true;
    } else {
        console.log(`ℹ️ apple-touch-icon already present in: ${htmlPath}`);
        return true;
    }
}

// Main execution
console.log('🍎 Patching for iOS home screen icon...');

// 1. Patch @elizaos/client if available
if (fs.existsSync(clientDistPath)) {
    copyIconTo(path.join(clientDistPath, 'apple-touch-icon.png'));
    patchHtml(clientHtmlPath);
}

// 2. Patch @elizaos/server client folder if available
if (fs.existsSync(serverDistPath)) {
    copyIconTo(path.join(serverDistPath, 'apple-touch-icon.png'));
    const serverHtmlPath = path.join(serverDistPath, 'index.html');
    if (fs.existsSync(serverHtmlPath)) {
        patchHtml(serverHtmlPath);
    }
}

// 3. Create public folder with icon for custom serving
const publicPath = path.join(__dirname, '../public');
if (!fs.existsSync(publicPath)) {
    fs.mkdirSync(publicPath, { recursive: true });
}
copyIconTo(path.join(publicPath, 'apple-touch-icon.png'));

console.log('✅ iOS home screen icon patch complete!');

// 4. Patch Discord plugin for hasElizaOS compatibility
const discordPluginPath = path.join(__dirname, '../node_modules/@elizaos/plugin-discord/dist/index.js');
if (fs.existsSync(discordPluginPath)) {
    let discordContent = fs.readFileSync(discordPluginPath, 'utf8');
    const oldCheck = 'if (this.runtime.hasElizaOS())';
    const newCheck = 'if (typeof this.runtime.hasElizaOS === "function" && this.runtime.hasElizaOS())';

    if (discordContent.includes(oldCheck) && !discordContent.includes('typeof this.runtime.hasElizaOS')) {
        discordContent = discordContent.replace(oldCheck, newCheck);
        fs.writeFileSync(discordPluginPath, discordContent);
        console.log('✅ Patched Discord plugin for hasElizaOS compatibility');
    } else {
        console.log('ℹ️ Discord plugin already patched or patch not needed');
    }
} else {
    console.log('⚠️ Discord plugin not found, skipping patch');
}

console.log('✅ All patches complete!');
