// Vercel serverless handler for Express app
// Cache the app module to avoid re-importing on every request

let cachedApp = null;

export default async function handler(req, res) {
  console.log('[Vercel] Handler START:', req.method, req.url);
  console.log('[Vercel] Environment:', {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    hasDatabase: !!process.env.DATABASE_URL,
    vercel: process.env.VERCEL
  });
  
  try {
    // Load app once and cache it
    if (!cachedApp) {
      console.log('[Vercel] Loading app.js for the first time...');
      const appModule = await import('../app.js');
      cachedApp = appModule.default;
      console.log('[Vercel] App loaded successfully, type:', typeof cachedApp);
    } else {
      console.log('[Vercel] Using cached app');
    }
    
    if (typeof cachedApp !== 'function') {
      throw new Error(`App is not a function, got: ${typeof cachedApp}`);
    }
    
    console.log('[Vercel] Passing request to Express...');
    return cachedApp(req, res);
    
  } catch (error) {
    console.error('[Vercel] CRASH:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    
    // Always return a response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Function crashed', 
        message: error.message,
        code: error.code,
        type: error.name
      });
    }
  }
}
