/**
 * Payment Server for X402
 * Serves the payment page on /pay route
 * This integrates with ElizaOS server on the main port
 */

import { logger } from '@elizaos/core';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Default apple-touch-icon as base64 PNG (180x180 simple icon)
// This is a simple placeholder - replace APPLE_TOUCH_ICON_URL env var with your icon
const DEFAULT_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAACXBIWXMAAAsTAAALEwEAmpwYAAAF0WlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxNDUgNzkuMTYzNDk5LCAyMDE4LzA4LzEzLTE2OjQwOjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ0MgMjAxOSAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjUtMTItMDJUMTQ6MDA6MDArMDk6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDI1LTEyLTAyVDE0OjAwOjAwKzA5OjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDI1LTEyLTAyVDE0OjAwOjAwKzA5OjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo4YjA5YjA5YS0wYjA5LTRiMDktOGIwOS1iMDlhMGIwOWIwOWEiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6OGIwOWIwOWEtMGIwOS00YjA5LThiMDktYjA5YTBiMDliMDlhIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6OGIwOWIwOWEtMGIwOS00YjA5LThiMDktYjA5YTBiMDliMDlhIj4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo4YjA5YjA5YS0wYjA5LTRiMDktOGIwOS1iMDlhMGIwOWIwOWEiIHN0RXZ0OndoZW49IjIwMjUtMTItMDJUMTQ6MDA6MDArMDk6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCBDQyAyMDE5IChNYWNpbnRvc2gpIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PgKBxE4AAAQYSURBVHic7d3BbhoxFEDRpsr//3K7aCUEYexn+57TLbPBwNWTZYeZX1++ffsJgIi/Rx8A4J0EDaQIGkgRNJAiaCBF0ECKoIEUQQMpggZSBA2kCBpIETSQImggRdBAiqCBFEEDKYIGUgQNpAgaSBE0kCJoIEXQQIqggRRBAymCBlIEDaQIGkgRNJAiaCBF0ECKoIEUQQMpggZSBA2kCBpIETSQImggRdBAiqCBFEEDKYIGUgQNpAgaSBE0kCJoIEXQQIqggRRBAymCBlIEDaQIGkgRNJAiaCBF0ECKoIEUQQMpggZSBA2kCBpIETSQImggRdBAiqCBFEEDKYIGUgQNpAgaSBE0kCJoIEXQQIqggRRBAymCBlIEDaQIGkgRNJAiaCBF0ECKoIEUQQMpggZSBA2kCBpIETSQImggRdBAiqCBFEEDKYIGUgQNpAgaSBE0kCJoIEXQQIqggRRBAymCBlIEDaQIGkgRNJAiaCBF0ECKoIEUQQMpggZSBA2kCBpIETSQImggRdBAiqCBFEEDKYIGUgQNpAgaSPl39AHs7OvXr/98/vPnz0OO5LP4/v37y4+5u+OnOmJKn/4T+vHHj5cfMz6Lo6f0KYIGUgQNpAgaSHnpotCl3nM+8kLw6AvJZ3TkBeLRU/oUd2ggZfxz6E+5O9/FnXne9OI59VHndsQpfYqggRRBAymCBlLGX/K9ylEXhndx1IXhI0/tk26KCRpIETSQImggZfwl36scdWF4F0ddGD7y1D7pppiggRRBAymCBlLGX/K9ylEXhndx1IXhI0/tk26KCRpIETSQImggZfwl36scdWF4F0ddGD7y1D7pppiggRRBAymCBlLGX/K9ylEXhndx1IXhI0/tk26KCRpIETSQImggZfwl36scdWF4F0ddGD7y1D7pppiggRRBAymCBlLGX/K9ylEXhndx1IXhI0/tk26KCRpIETSQImggZfwl36scdWF4F0ddGD7y1D7pppiggRRBAymCBlLGX/K9ylEXhndx1IXhI0/tk26KCRpIETSQImggZfwl36scdWF4F0ddGD7y1D7pppiggRRBAymCBlIe+h8rHO3bt2//+dzFzXM+8r9leOQpfYo7NJAiaCBF0ECKoIGU8e9yeJYjLwzv4qgLw0ee2ifdFBM0kCJoIEXQQMr4dzmcxl2c5ZS+s6M/f598HHPv7tBfvnz558fd3YGTd1d0himd7ewpdefu0EDK+Eu+V3GXpuuoU/rUF9KPvEvvdpNT+hR3aCBF0ECKoIEUQQMp49/lcJYjLwzv4qgLw0ee2ifdFBM0kCJoIEXQQMr4dzmcxl0c+dS+w6l9ikfekXn2f6wAnuaIpvQP7tBAiqCBFEEDKYIGUn4DnYR+VvDqPDoAAAAASUVORK5CYII=';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read payment page HTML
let PAYMENT_PAGE_HTML = '';
try {
    // Try multiple possible paths (dist, src, root)
    const possiblePaths = [
        path.join(__dirname, '../payment-page/index.html'),           // From dist/
        path.join(__dirname, '../../payment-page/index.html'),        // From dist/src/
        path.join(process.cwd(), 'payment-page/index.html'),          // From project root
    ];

    let loaded = false;
    for (const paymentPagePath of possiblePaths) {
        if (fs.existsSync(paymentPagePath)) {
            PAYMENT_PAGE_HTML = fs.readFileSync(paymentPagePath, 'utf-8');
            logger.info(`✅ Payment page loaded from: ${paymentPagePath}`);
            loaded = true;
            break;
        }
    }

    if (!loaded) {
        throw new Error(`Payment page not found in any of: ${possiblePaths.join(', ')}`);
    }
} catch (error) {
    logger.error('❌ Failed to load payment page HTML:', error);
    PAYMENT_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Payment Page Error</title></head>
<body>
    <h1>Payment page not found</h1>
    <p>Please contact the administrator.</p>
    <p>Error: ${error instanceof Error ? error.message : String(error)}</p>
</body>
</html>`;
}

/**
 * Start payment server
 * Uses PAYMENT_PORT env var (default: 3001)
 * For Railway single-port deployment, set PAYMENT_PORT to same as main port (usually 3000)
 */
export function startPaymentServer() {
    const PORT = parseInt(process.env.PAYMENT_PORT || '3001', 10);

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Serve apple-touch-icon for iOS home screen
        if (req.method === 'GET' && (url.pathname === '/apple-touch-icon.png' || url.pathname === '/apple-touch-icon-precomposed.png')) {
            logger.info(`Apple touch icon requested: ${url.pathname}`);

            // Check for custom icon URL from environment
            const customIconUrl = process.env.APPLE_TOUCH_ICON_URL;
            if (customIconUrl) {
                // Redirect to custom icon URL
                res.writeHead(302, { 'Location': customIconUrl });
                res.end();
                return;
            }

            // Check for local icon file
            const localIconPaths = [
                path.join(__dirname, '../public/apple-touch-icon.png'),
                path.join(__dirname, '../../public/apple-touch-icon.png'),
                path.join(process.cwd(), 'public/apple-touch-icon.png'),
            ];

            for (const iconPath of localIconPaths) {
                if (fs.existsSync(iconPath)) {
                    const iconData = fs.readFileSync(iconPath);
                    res.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Cache-Control': 'public, max-age=86400'
                    });
                    res.end(iconData);
                    return;
                }
            }

            // Serve default base64 icon
            const iconBuffer = Buffer.from(DEFAULT_ICON_BASE64, 'base64');
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(iconBuffer);
            return;
        }

        // Serve payment page
        if (req.method === 'GET' && url.pathname === '/pay') {
            logger.info(`Payment page accessed: ${url.href}`);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(PAYMENT_PAGE_HTML);
            return;
        }

        // 404 for everything else
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.listen(PORT, '0.0.0.0', () => {
        logger.info(`🌐 Payment server running on http://0.0.0.0:${PORT}`);
        logger.info(`📄 Payment page available at: http://localhost:${PORT}/pay`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            logger.warn(`Port ${PORT} is already in use. Payment server not started.`);
        } else {
            logger.error('Payment server error:', error);
        }
    });

    return server;
}
