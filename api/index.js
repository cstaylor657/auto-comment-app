require('dotenv').config();
const { createServer } = require('http');
const { parse } = require('url');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const db = require('./db');
const { handleComment } = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_ID = process.env.APP_ID;
const APP_SECRET = process.env.APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: true
}));

// --- ROUTES ---

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dashboard
app.get('/dashboard', async (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Start OAuth
app.get('/auth/start', (req, res) => {
  const url = `https://www.facebook.com/v24.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}&scope=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_manage_comments&response_type=code&state=${req.session.id}`;
  res.redirect(url);
});

// OAuth Callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || state !== req.session.id) return res.status(400).send('Invalid state');

  try {
    // 1. Get user access token
    const tokenRes = await axios.get('https://graph.facebook.com/v24.0/oauth/access_token', {
      params: { client_id: APP_ID, client_secret: APP_SECRET, code, redirect_uri: REDIRECT_URI }
    });
    const userToken = tokenRes.data.access_token;

    // 2. Long-lived token
    const longRes = await axios.get('https://graph.facebook.com/v24.0/oauth/access_token', {
      params: { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: userToken }
    });
    const longUserToken = longRes.data.access_token;

    // 3. Get Pages
    const pagesRes = await axios.get('https://graph.facebook.com/v24.0/me/accounts', {
      params: { access_token: longUserToken }
    });

    let userId = req.session.userId;
    if (!userId) {
      const fbUserRes = await axios.get('https://graph.facebook.com/v24.0/me', { params: { access_token: longUserToken } });
      const fbUserId = fbUserRes.data.id;

      const row = await new Promise((resolve) => {
        db.get('SELECT id FROM users WHERE fb_user_id = ?', [fbUserId], (err, row) => resolve(row));
      });
      if (row) userId = row.id;
      else {
        const insert = await new Promise((resolve) => {
          db.run('INSERT INTO users (fb_user_id) VALUES (?)', [fbUserId], function(err) {
            resolve(this.lastID);
          });
        });
        userId = insert;
      }
      req.session.userId = userId;
    }

    // 4. Save accounts
    for (const page of pagesRes.data.data) {
      const pageTokenRes = await axios.get(`https://graph.facebook.com/v24.0/${page.id}`, {
        params: { fields: 'access_token', access_token: longUserToken }
      });
      const pageToken = pageTokenRes.data.access_token;

      // Check IG
      let igAccount = null;
      try {
        const igRes = await axios.get(`https://graph.facebook.com/v24.0/${page.id}`, {
          params: { fields: 'instagram_business_account', access_token: pageToken }
        });
        igAccount = igRes.data.instagram_business_account;
      } catch (e) {}

      // Save FB Page
      db.run(
        'INSERT OR IGNORE INTO accounts (user_id, platform, account_id, name, access_token) VALUES (?, ?, ?, ?, ?)',
        [userId, 'Facebook', page.id, page.name, pageToken]
      );

      // Save IG if linked
      if (igAccount) {
        db.run(
          'INSERT OR IGNORE INTO accounts (user_id, platform, account_id, name, access_token) VALUES (?, ?, ?, ?, ?)',
          [userId, 'Instagram', igAccount.id, igAccount.username, pageToken]
        );
      }
    }

    res.redirect('/dashboard');
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).send('Auth failed');
  }
});

// API: List accounts
app.get('/api/accounts', (req, res) => {
  if (!req.session.userId) return res.status(401).json([]);
  db.all('SELECT * FROM accounts WHERE user_id = ?', [req.session.userId], (err, rows) => {
    res.json(rows || []);
  });
});

// API: Toggle enable
app.post('/api/toggle', (req, res) => {
  const { accountId, enabled } = req.body;
  db.run('UPDATE accounts SET enabled = ? WHERE id = ? AND user_id = ?', [enabled ? 1 : 0, accountId, req.session.userId], () => {
    res.json({ success: true });
  });
});

// Webhook: Verify
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// Webhook: Receive comments
app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  if (!entry?.changes) return res.sendStatus(200);

  for (const change of entry.changes) {
    if (change.field === 'messages') {
      const value = change.value;
      const igUserId = entry.id;
      const commentId = value.comment_id || value.id;
      const postId = value.media?.id || value.id.split('_')[0]; // Fallback

      db.get(
        'SELECT access_token FROM accounts WHERE account_id = ? AND enabled = 1',
        [igUserId],
        async (err, row) => {
          if (row) {
            await handleComment(commentId, value.message, igUserId, row.access_token, postId);
          }
        }
      );
    }
  }
  res.sendStatus(200);
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Use ngrok: ngrok http ${PORT}`);
});

module.exports = app;