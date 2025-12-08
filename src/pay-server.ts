/**
 * Payment Server for X402
 * Redirects to external payment page
 * This integrates with ElizaOS server on the main port
 */

import { logger } from '@elizaos/core';
import http from 'http';

// External payment page URL
const EXTERNAL_PAYMENT_PAGE = process.env.PAYMENT_PAGE_URL || 'https://x402payment.vercel.app';

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

            // Redirect to CooDAO icon (or custom from environment)
            const iconUrl = process.env.APPLE_TOUCH_ICON_URL || 'https://dwebxr.xyz/images/coodao.png';
            res.writeHead(302, {
                'Location': iconUrl,
                'Cache-Control': 'public, max-age=86400'
            });
            res.end();
            return;
        }

        // Redirect to external payment page
        if (req.method === 'GET' && url.pathname === '/pay') {
            const queryString = url.search || '';
            const redirectUrl = `${EXTERNAL_PAYMENT_PAGE}/pay${queryString}`;
            logger.info(`Redirecting to external payment page: ${redirectUrl}`);
            res.writeHead(302, {
                'Location': redirectUrl,
                'Cache-Control': 'no-cache'
            });
            res.end();
            return;
        }

        // 404 for everything else
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.listen(PORT, '0.0.0.0', () => {
        logger.info(`🌐 Payment server running on http://0.0.0.0:${PORT}`);
        logger.info(`📄 Payment redirects to: ${EXTERNAL_PAYMENT_PAGE}/pay`);
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
