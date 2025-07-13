const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;


app.use(cors());
app.use(bodyParser.json());


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'healthy', timestamp: new Date(), database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});


app.post('/api/signup', async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
      [name, email, hash, role]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });

    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(403).json({ error: 'Invalid credentials' });

    res.json({
      message: 'Login successful',
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/requests', async (req, res) => {
  const { name, purchase, vendor, tax_amount, approved, items, user_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO purchase_requests (name, purchase, vendor, tax_amount, approved, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, purchase, vendor, tax_amount, approved || false, user_id]
    );

    const requestId = result.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO items (request_id, item_no, legal_entity) VALUES ($1, $2, $3)',
        [requestId, item.item_no, item.legal_entity]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Request created', requestId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


app.get('/api/requests', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pr.*, u.name as user_name,
        json_agg(json_build_object('item_no', i.item_no, 'legal_entity', i.legal_entity)) AS items
      FROM purchase_requests pr
      JOIN users u ON pr.user_id = u.id
      LEFT JOIN items i ON pr.id = i.request_id
      GROUP BY pr.id, u.name
      ORDER BY pr.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;

  try {
    await pool.query(
      'UPDATE purchase_requests SET approved = $1 WHERE id = $2',
      [approved, id]
    );
    res.json({ message: `Request ${approved ? 'approved' : 'rejected'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/', (req, res) => {
  res.send('API is running');
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
