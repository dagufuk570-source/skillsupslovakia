import app from '../app.js';

// Export the Express app as the default handler for Vercel
export default function handler(req, res) {
  return app(req, res);
}
