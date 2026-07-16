function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// Store money as whole cents precision
function cents(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }

async function buildExport(env) {
  const tx = await env.DB.prepare('SELECT * FROM transactions ORDER BY date DESC').all();
  const as = await env.DB.prepare('SELECT * FROM assets ORDER BY year DESC').all();
  return {
    version: '1.0',
    exported: new Date().toISOString(),
    property: '626 Villa Ticino Drive, Manteca CA',
    transactions: tx.results,
    assets: as.results
  };
}

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

      // --- Documents (R2) ---

      if (pathname === '/api/docs' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC').all();
        return json(results);
      }

      if (pathname === '/api/docs' && method === 'POST') {
        const url = new URL(request.url);
        const name = (url.searchParams.get('name') || 'document').replace(/[^\w.\- ()]/g, '_');
        const category = url.searchParams.get('category') || 'other';
        const transactionId = url.searchParams.get('transaction_id') || null;
        const body = await request.arrayBuffer();
        if (!body.byteLength) return json({ error: 'Empty file' }, 400);
        if (body.byteLength > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
        const id = uid();
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        await env.DOCS.put('docs/' + id + '/' + name, body, { httpMetadata: { contentType } });
        await env.DB.prepare(
          'INSERT INTO documents (id, name, category, size, content_type, transaction_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(id, name, category, body.byteLength, contentType, transactionId).run();
        return json({ ok: true, id, name, category, size: body.byteLength, transaction_id: transactionId });
      }

      const docMatch = pathname.match(/^\/api\/docs\/([^/]+)$/);
      if (docMatch && method === 'GET') {
        const id = decodeURIComponent(docMatch[1]);
        const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'Not found' }, 404);
        const obj = await env.DOCS.get('docs/' + id + '/' + row.name);
        if (!obj) return json({ error: 'File missing from storage' }, 404);
        return new Response(obj.body, {
          headers: {
            'Content-Type': row.content_type || 'application/octet-stream',
            'Content-Disposition': 'inline; filename="' + row.name + '"'
          }
        });
      }

      if (docMatch && method === 'PUT') {
        const { category } = await request.json();
        if (!category || typeof category !== 'string' || category.length > 40) {
          return json({ error: 'Invalid category' }, 400);
        }
        await env.DB.prepare('UPDATE documents SET category = ? WHERE id = ?')
          .bind(category, decodeURIComponent(docMatch[1])).run();
        return json({ ok: true });
      }

      if (docMatch && method === 'DELETE') {
        const id = decodeURIComponent(docMatch[1]);
        const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
        if (row) {
          await env.DOCS.delete('docs/' + id + '/' + row.name);
          await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
        }
        return json({ ok: true });
      }

      // --- Settings ---

      if (pathname === '/api/settings' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
        return json(Object.fromEntries(results.map(r => [r.key, r.value])));
      }

      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await request.json();
        const stmts = Object.entries(body).map(([k, v]) =>
          env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, String(v))
        );
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true });
      }

      // --- JSON backup export/import ---

      if (pathname === '/api/export' && method === 'GET') {
        return json(await buildExport(env));
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
  },

  // Weekly database snapshot to R2, keeping the newest 12
  async scheduled(event, env) {
    const snapshot = await buildExport(env);
    const key = 'backups/villa-ticino-' + new Date().toISOString().split('T')[0] + '.json';
    await env.DOCS.put(key, JSON.stringify(snapshot), {
      httpMetadata: { contentType: 'application/json' }
    });
    const list = await env.DOCS.list({ prefix: 'backups/' });
    const old = list.objects.sort((a, b) => b.key.localeCompare(a.key)).slice(12);
    for (const obj of old) await env.DOCS.delete(obj.key);
  }
};
