const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database('./links.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
    // Create tables
    db.run(`CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      original_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      clicks INTEGER DEFAULT 0,
      last_clicked DATETIME
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS click_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT,
      clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT,
      user_agent TEXT,
      referrer TEXT,
      FOREIGN KEY (link_id) REFERENCES links(id)
    )`);
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Create short link
app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  const shortId = nanoid(8);
  
  db.run(
    'INSERT INTO links (id, original_url) VALUES (?, ?)',
    [shortId, url],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create short link' });
      }
      
      const baseUrl = req.protocol + '://' + req.get('host');
      res.json({
        shortUrl: `${baseUrl}/${shortId}`,
        shortId: shortId,
        originalUrl: url
      });
    }
  );
});

// Redirect short link
app.get('/:id', (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT * FROM links WHERE id = ?', [id], (err, row) => {
    if (err || !row) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
    
    // Update click count
    db.run(
      'UPDATE links SET clicks = clicks + 1, last_clicked = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
    
    // Log click
    db.run(
      'INSERT INTO click_logs (link_id, ip_address, user_agent, referrer) VALUES (?, ?, ?, ?)',
      [id, req.ip, req.get('user-agent'), req.get('referrer')]
    );
    
    // Show interstitial page with ads before redirect
    res.sendFile(path.join(__dirname, 'public', 'interstitial.html'));
  });
});

// Get redirect URL (called from interstitial page)
app.get('/api/redirect/:id', (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT original_url FROM links WHERE id = ?', [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    res.json({ url: row.original_url });
  });
});

// Get link stats
app.get('/api/stats/:id', (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT * FROM links WHERE id = ?', [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    db.get(
      'SELECT COUNT(*) as total_clicks FROM click_logs WHERE link_id = ?',
      [id],
      (err, countRow) => {
        res.json({
          ...row,
          detailedClicks: countRow ? countRow.total_clicks : 0
        });
      }
    );
  });
});

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`LinkPulse server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
