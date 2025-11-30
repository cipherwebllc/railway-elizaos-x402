/**
 * Payment Server for X402
 * Serves the payment page on /pay route
 * This integrates with ElizaOS server on the main port
 */

import { logger } from '@elizaos/core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
 * Start payment server on port 3001
 * This runs alongside the main ElizaOS server
 */
export function startPaymentServer() {
    const PORT = 3001;

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
