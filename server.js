const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'tracker.db');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const backupPath = DB_PATH + '.' + new Date().toISOString().split('T')[0] + '.bak';
    if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, fileBuffer);
    db = new SQL.Database(fileBuffer);
    console.log('Loaded existing database from tracker.db');
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    amount REAL NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    item TEXT NOT NULL,
    cost REAL NOT NULL,
    year INTEGER NOT NULL,
    method TEXT NOT NULL,
    month INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  try { db.run('ALTER TABLE assets ADD COLUMN month INTEGER DEFAULT 1'); } catch (e) { /* column already exists */ }

  saveToDisk();
}

function saveToDisk() {
  const data = db.export();
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, Buffer.from(data));
  fs.renameSync(tmpPath, DB_PATH);
}

// --- Transactions ---

app.get('/api/transactions', (req, res) => {
  const result = db.exec('SELECT * FROM transactions ORDER BY date DESC');
  if (!result.length) return res.json([]);
  const [{ columns, values }] = result;
  res.json(values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]]))));
});

app.post('/api/transactions', (req, res) => {
  const { id, date, description, type, category, unit, amount, notes } = req.body;
  if (!id || !date || !description || !type || !category || !unit || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    db.run(
      `INSERT INTO transactions (id, date, description, type, category, unit, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, date, description, type, category, unit, amount, notes || '']
    );
    saveToDisk();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/transactions/:id', (req, res) => {
  db.run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  saveToDisk();
  res.json({ ok: true });
});

app.put('/api/transactions/:id', (req, res) => {
  const { date, description, type, category, unit, amount, notes } = req.body;
  if (!date || !description || !type || !category || !unit || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    db.run(
      `UPDATE transactions SET date = ?, description = ?, type = ?, category = ?, unit = ?, amount = ?, notes = ? WHERE id = ?`,
      [date, description, type, category, unit, amount, notes || '', req.params.id]
    );
    saveToDisk();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Assets ---

app.get('/api/assets', (req, res) => {
  const result = db.exec('SELECT * FROM assets ORDER BY year DESC');
  if (!result.length) return res.json([]);
  const [{ columns, values }] = result;
  res.json(values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]]))));
});

app.post('/api/assets', (req, res) => {
  const { id, item, cost, year, method, month } = req.body;
  if (!id || !item || !cost || !year || !method) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    db.run(
      `INSERT INTO assets (id, item, cost, year, method, month) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, item, cost, year, method, month || 1]
    );
    saveToDisk();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assets/:id', (req, res) => {
  db.run('DELETE FROM assets WHERE id = ?', [req.params.id]);
  saveToDisk();
  res.json({ ok: true });
});

// --- JSON backup export/import ---

app.get('/api/export', (req, res) => {
  const txResult = db.exec('SELECT * FROM transactions ORDER BY date DESC');
  const asResult = db.exec('SELECT * FROM assets ORDER BY year DESC');

  const mapResult = r => r.length ? r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]]))) : [];

  res.json({
    version: '1.0',
    exported: new Date().toISOString(),
    property: '626 Villa Ticino Drive, Manteca CA',
    transactions: mapResult(txResult),
    assets: mapResult(asResult)
  });
});

app.post('/api/import', (req, res) => {
  const { transactions, assets } = req.body;
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Invalid format' });

  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM transactions');
    db.run('DELETE FROM assets');

    for (const t of transactions) {
      db.run(
        `INSERT OR REPLACE INTO transactions (id, date, description, type, category, unit, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id || uid(), t.date, t.description || t.desc, t.type, t.category || t.cat, t.unit, t.amount, t.notes || '']
      );
    }
    for (const a of (assets || [])) {
      db.run(
        `INSERT OR REPLACE INTO assets (id, item, cost, year, method, month) VALUES (?, ?, ?, ?, ?, ?)`,
        [a.id || uid(), a.item, a.cost, a.year, a.method, a.month || 1]
      );
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    return res.status(400).json({ error: 'Import failed, no data was changed: ' + ((e && e.message) || e) });
  }

  saveToDisk();
  res.json({ ok: true, imported: transactions.length });
});

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n Villa Ticino Tracker running at http://localhost:${PORT}\n`);
  });
});
