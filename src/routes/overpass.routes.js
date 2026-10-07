const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');

// Overpass mirrors in preference order
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function postToOverpass(url, body, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const postData = Buffer.from(body, 'utf8');
    const timer = setTimeout(function() { req.destroy(); reject(new Error('timeout')); }, timeoutMs);

    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length,
        'User-Agent': 'PawBook/1.0 (pawbook-api-cquc.onrender.com)'
      }
    }, function(res) {
      clearTimeout(timer);
      if(res.statusCode !== 200) { return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk){ data += chunk; });
      res.on('end', function(){
        try { resolve(JSON.parse(data)); }
        catch(e){ reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', function(e){ clearTimeout(timer); reject(e); });
    req.write(postData);
    req.end();
  });
}

// POST /api/v1/overpass
// Body: { query: "..." }
router.post('/', async function(req, res) {
  const { query } = req.body;
  if(!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required' });
  }
  if(query.length > 8000) {
    return res.status(400).json({ error: 'query too long' });
  }

  let lastErr = null;
  for(const mirror of MIRRORS) {
    try {
      const data = await postToOverpass(mirror, 'data=' + encodeURIComponent(query), 30000);
      return res.json(data);
    } catch(err) {
      lastErr = err;
      console.warn('Overpass mirror failed:', mirror, err.message);
    }
  }
  console.error('All Overpass mirrors failed:', lastErr?.message);
  res.status(502).json({ error: 'All OSM servers unavailable', elements: [] });
});

module.exports = router;
