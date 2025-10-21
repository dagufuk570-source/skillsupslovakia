// Vercel serverless handler for Express app
// Note: We use dynamic import to avoid top-level await issues in Vercel

export default async function handler(req, res) {
  console.log('[Vercel] Handler invoked:', req.method, req.url);
  
  try {
    // Lazy-load the Express app on each request (Vercel caches module between invocations)
    const { default: app } = await import('../app.js');
    console.log('[Vercel] App loaded, passing request to Express');
    
    // Let Express handle the request
    return app(req, res);
  } catch (error) {
    console.error('[Vercel] Handler error:', error.message, error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Server initialization failed', 
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}
