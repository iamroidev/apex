const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || (function() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'apex_classroom_default_stable_fallback_secret_key') {
    console.warn('WARNING: JWT_SECRET is not set or using default. Generate a secure secret with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
  }
  return process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
})();

function generateToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    exp: Date.now() + 1000 * 60 * 60 * 24 // 24 hours
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(payloadB64);
  const signature = hmac.digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  
  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(payloadB64);
  const expectedSignature = hmac.digest('base64url');
  if (signature !== expectedSignature) return null;
  
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const parts = cookie.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    if (key) acc[key] = value;
    return acc;
  }, {});
  return cookies[name] || null;
}

function setSessionCookie(res, req, token, maxAge = 86400) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureFlag = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `apex_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`);
}

function clearSessionCookie(res, req) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureFlag = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `apex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`);
}

function authenticate(req, res, next) {
  const token = getCookie(req, 'apex_session');
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  getCookie,
  setSessionCookie,
  clearSessionCookie,
  authenticate,
  JWT_SECRET
};
