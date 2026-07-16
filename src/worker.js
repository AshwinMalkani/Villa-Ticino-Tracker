function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// Store money as whole cents precision
function cents(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }

const json = (data, status = 200) => Response.json(data, { status });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      // --- Transactions ---

      if (pathname === '/api/transactions' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM transactions ORDER BY date DESC').all();
        return json(results);
      }

      if (pathname === '/api/transactions' && method === 'POST') {
        const { id, date, description, type, category, unit, amount, notes } = await request.json();
        if (!id || !date || !description || !type || !category || !unit || !amount) {
          return json({ error: 'Missing required fields' }, 400);
        }
        await env.DB.prepare(
          'INSERT INTO transactions (id, date, description, type, category, unit, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(id, date, description, type, category, unit, cents(amount), notes || '').run();
        return json({ ok: true });
      }

      const txDelete = pathname.match(/^\/api\/transactions\/([^/]+)$/);
      if (txDelete && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(decodeURIComponent(txDelete[1])).run();
        return json({ ok: true });
      }

      if (txDelete && method === 'PUT') {
        const { date, description, type, category, unit, amount, notes } = await request.json();
        if (!date || !description || !type || !category || !unit || !amount) {
          return json({ error: 'Missing required fields' }, 400);
        }
        await env.DB.prepare(
          'UPDATE transactions SET date = ?, description = ?, type = ?, category = ?, unit = ?, amount = ?, notes = ? WHERE id = ?'
        ).bind(date, description, type, category, unit, cents(amount), notes || '', decodeURIComponent(txDelete[1])).run();
        return json({ ok: true });
      }

      // --- Assets ---

      if (pathname === '/api/assets' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM assets ORDER BY year DESC').all();
        return json(results);
      }

      if (pathname === '/api/assets' && method === 'POST') {
        const { id, item, cost, year, method: depMethod, month } = await request.json();
        if (!id || !item || !cost || !year || !depMethod) {
          return json({ error: 'Missing required fields' }, 400);
        }
        await env.DB.prepare(
          'INSERT INTO assets (id, item, cost, year, method, month) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(id, item, cents(cost), year, depMethod, month || 1).run();
        return json({ ok: true });
      }

      const assetDelete = pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (assetDelete && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(decodeURIComponent(assetDelete[1])).run();
        return json({ ok: true });
      }

      // --- JSON backup export/import ---

      if (pathname === '/api/export' && method === 'GET') {
        const tx = await env.DB.prepare('SELECT * FROM transactions ORDER BY date DESC').all();
        const as = await env.DB.prepare('SELECT * FROM assets ORDER BY year DESC').all();
        return json({
          version: '1.0',
          exported: new Date().toISOString(),
          property: '626 Villa Ticino Drive, Manteca CA',
          transactions: tx.results,
          assets: as.results
        });
      }

      if (pathname === '/api/import' && method === 'POST') {
        const { transactions, assets } = await request.json();
        if (!Array.isArray(transactions)) return json({ error: 'Invalid format' }, 400);

        const stmts = [
          env.DB.prepare('DELETE FROM transactions'),
          env.DB.prepare('DELETE FROM assets')
        ];
        for (const t of transactions) {
          stmts.push(env.DB.prepare(
            'INSERT OR REPLACE INTO transactions (id, date, description, type, category, unit, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(t.id || uid(), t.date ?? null, (t.description || t.desc) ?? null, t.type ?? null, (t.category || t.cat) ?? null, t.unit ?? null, cents(t.amount) ?? null, t.notes || ''));
        }
        for (const a of (assets || [])) {
          stmts.push(env.DB.prepare(
            'INSERT OR REPLACE INTO assets (id, item, cost, year, method, month) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(a.id || uid(), a.item ?? null, a.cost ?? null, a.year ?? null, a.method ?? null, a.month || 1));
        }

        try {
          // D1 batches are transactional: any failure rolls back the whole batch
          await env.DB.batch(stmts);
        } catch (e) {
          return json({ error: 'Import failed, no data was changed: ' + ((e && e.message) || e) }, 400);
        }
        return json({ ok: true, imported: transactions.length });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: (e && e.message) || String(e) }, 500);
    }
  }
};
