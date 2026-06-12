export function renderTestConsole() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nexa UAT Test Console</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0f172a; color: #e5e7eb; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 18px 56px; }
    h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 44px); letter-spacing: -0.04em; }
    p { color: #94a3b8; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 24px; }
    section { background: #111827; border: 1px solid #243041; border-radius: 18px; padding: 18px; box-shadow: 0 20px 60px rgb(0 0 0 / 0.25); }
    h2 { margin: 0 0 12px; font-size: 18px; }
    label { display: grid; gap: 6px; margin: 10px 0; color: #cbd5e1; font-size: 13px; }
    input, textarea { width: 100%; box-sizing: border-box; border-radius: 10px; border: 1px solid #334155; background: #020617; color: #e5e7eb; padding: 10px 11px; font: inherit; }
    textarea { min-height: 120px; resize: vertical; }
    button { border: 0; border-radius: 999px; padding: 10px 14px; background: linear-gradient(135deg, #7c3aed, #06b6d4); color: white; font-weight: 700; cursor: pointer; margin-top: 8px; }
    button.secondary { background: #334155; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #1e293b; border-radius: 14px; padding: 14px; min-height: 180px; color: #bfdbfe; }
    .wide { grid-column: 1 / -1; }
    .table { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border-bottom: 1px solid #243041; padding: 8px; text-align: left; }
    tr.selected { background: #1e3a8a55; }
  </style>
</head>
<body>
  <main>
    <h1>Nexa UAT Test Console</h1>
    <p>Consola local para probar health, bootstrap, token por credito, webhook simulado y polling manual. No guarda secretos fuera del navegador.</p>

    <section>
      <h2>Configuracion</h2>
      <label>Base URL <input id="baseUrl" value="http://localhost:7010" /></label>
      <label>INTERNAL_API_KEY <input id="internalApiKey" value="dev-secret" /></label>
      <label>Webhook flowId <input id="flowId" value="local-flow" /></label>
      <label>Webhook bearer <input id="webhookBearer" value="local-webhook-token" /></label>
    </section>

    <div class="grid">
      <section>
        <h2>1. Health</h2>
        <button data-action="health">GET /health</button>
      </section>

      <section>
        <h2>2. Bootstrap token</h2>
        <p>POST /admin/tokens/bootstrap</p>
        <button data-action="bootstrap">Crear token general</button>
      </section>

      <section>
        <h2>3. Token por credito</h2>
        <label>Credito ID <input id="creditoId" type="number" placeholder="123" /></label>
        <label>Descripcion <input id="description" placeholder="Credito 123" /></label>
        <label>DPI/CUI <input id="nationalId" placeholder="1234567890101" /></label>
        <button data-action="tokenUser">POST /admin/token-users</button>
      </section>

      <section>
        <h2>3b. Cartera mock</h2>
        <label>Credito ID <input id="mockCreditoId" type="number" placeholder="123" /></label>
        <label>Cliente <input id="borrowerName" value="Cliente prueba" /></label>
        <label>Saldo inicial <input id="initialBalance" type="number" value="1000" /></label>
        <label>Cuota <input id="installmentAmount" type="number" value="250" /></label>
        <button data-action="mockCredit">Crear/actualizar credito mock</button>
      </section>

      <section>
        <h2>4. Tokens creados</h2>
        <button data-action="loadTokens">Cargar tokens</button>
        <p id="selectedToken">Sin token seleccionado.</p>
        <div class="table"><table><thead><tr><th>Credito</th><th>Identifier</th><th>Token</th><th></th></tr></thead><tbody id="tokenRows"></tbody></table></div>
      </section>

      <section>
        <h2>5. Webhook simulado</h2>
        <label>Notification ID <input id="webhookId" value="7293" /></label>
        <label>Reference <input id="reference" value="4617307" /></label>
        <label>Token seleccionado <input id="token" placeholder="Selecciona un token arriba" /></label>
        <label>Monto <input id="amount" type="number" value="50" /></label>
        <button data-action="webhook">Fingir pago</button>
      </section>

      <section>
        <h2>6. Polling manual</h2>
        <label>Fecha <input id="pollDate" type="date" /></label>
        <button data-action="poll">POST /admin/poll/:date</button>
      </section>

      <section class="wide">
        <h2>Resultado</h2>
        <button class="secondary" data-action="clear">Limpiar</button>
        <pre id="output">Listo.</pre>
      </section>

      <section class="wide">
        <h2>Estado de cuenta local</h2>
        <button data-action="loadTransactions">Cargar estado de cuenta</button>
        <div class="table"><table><thead><tr><th>Credito</th><th>Cliente</th><th>Cuota</th><th>Saldo inicial</th><th>Pagado</th><th>Saldo actual</th></tr></thead><tbody id="creditRows"></tbody></table></div>
        <h2>Movimientos tecnicos</h2>
        <div class="table"><table><thead><tr><th>Reference</th><th>Monto</th><th>Token</th><th>Estado</th><th>Payment ID</th><th>Error</th></tr></thead><tbody id="transactionRows"></tbody></table></div>
      </section>
    </div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const output = $('output');
    let selectedToken = '';
    $('pollDate').valueAsDate = new Date();

    function config() {
      return {
        baseUrl: $('baseUrl').value.replace(/\\\/$/, ''),
        internalApiKey: $('internalApiKey').value,
        flowId: $('flowId').value,
        webhookBearer: $('webhookBearer').value,
      };
    }

    async function call(label, path, init = {}) {
      const response = await fetch(config().baseUrl + path, init);
      const text = await response.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      output.textContent = label + '\\n' + response.status + ' ' + response.statusText + '\\n\\n' + body;
      return { response, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
    }

    async function loadTokens() {
      const result = await call('GET /admin/token-users', '/admin/token-users', {
        headers: { Authorization: 'Bearer ' + config().internalApiKey },
      });
      const rows = result.json?.tokenUsers ?? [];
      $('tokenRows').innerHTML = rows.map((row) => '<tr data-token="' + row.token + '"><td>' + row.creditoId + '</td><td>' + row.identifier + '</td><td>' + row.token + '</td><td><button data-action="selectToken" data-token="' + row.token + '">Seleccionar</button></td></tr>').join('');
    }

    async function loadTransactions() {
      const result = await call('GET /admin/transactions', '/admin/transactions', {
        headers: { Authorization: 'Bearer ' + config().internalApiKey },
      });
      const rows = result.json?.transactions ?? [];
      $('transactionRows').innerHTML = rows.map((row) => '<tr><td>' + row.reference + '</td><td>' + row.amount + '</td><td>' + row.token + '</td><td>' + row.processingStatus + '</td><td>' + (row.carteraPaymentId ?? '') + '</td><td>' + (row.failureReason ?? '') + '</td></tr>').join('');
      await loadMockCredits();
    }

    async function loadMockCredits() {
      const result = await call('GET /admin/mock-credits', '/admin/mock-credits', {
        headers: { Authorization: 'Bearer ' + config().internalApiKey },
      });
      const rows = result.json?.credits ?? [];
      $('creditRows').innerHTML = rows.map((row) => '<tr><td>' + row.creditoId + '</td><td>' + row.borrowerName + '</td><td>' + row.installmentAmount + '</td><td>' + row.initialBalance + '</td><td>' + row.totalPaid + '</td><td>' + row.currentBalance + '</td></tr>').join('');
    }

    function selectToken(token) {
      selectedToken = token;
      $('token').value = token;
      $('selectedToken').textContent = 'Seleccionado: ' + token;
      document.querySelectorAll('#tokenRows tr').forEach((row) => row.classList.toggle('selected', row.dataset.token === token));
    }

    function nextReference() {
      return String(Date.now()).slice(-9);
    }

    document.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      try {
        if (action === 'clear') output.textContent = 'Listo.';
        if (action === 'loadTokens') await loadTokens();
        if (action === 'loadTransactions') await loadTransactions();
        if (action === 'mockCredit') await call('POST /admin/mock-credits', '/admin/mock-credits', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + config().internalApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ creditoId: Number($('mockCreditoId').value), borrowerName: $('borrowerName').value, initialBalance: Number($('initialBalance').value), installmentAmount: Number($('installmentAmount').value) }),
        });
        if (action === 'selectToken') selectToken(event.target.dataset.token);
        if (action === 'health') await call('GET /health', '/health');
        if (action === 'bootstrap') await call('POST /admin/tokens/bootstrap', '/admin/tokens/bootstrap', {
          method: 'POST', headers: { Authorization: 'Bearer ' + config().internalApiKey },
        });
        if (action === 'tokenUser') await call('POST /admin/token-users', '/admin/token-users', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + config().internalApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ creditoId: Number($('creditoId').value), description: $('description').value, nationalId: $('nationalId').value }),
        });
        if (action === 'tokenUser') await loadTokens();
        if (action === 'webhook') {
          if (!$('reference').value) $('reference').value = nextReference();
          if (selectedToken && !$('token').value) $('token').value = selectedToken;
          await call('POST /webhook/v1/payment-token', '/webhook/v1/payment-token', {
          method: 'POST',
          headers: { flowId: config().flowId, Authorization: 'Bearer ' + config().webhookBearer, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: $('webhookId').value, reference: $('reference').value, token: $('token').value, amount: Number($('amount').value), originAccount: '19451958', originBank: 'INDLGTGC', comments: 'Test transaction', currency: 'GTQ', originAccountName: 'Cuenta origen' }),
          });
          await loadTransactions();
          $('reference').value = nextReference();
        }
        if (action === 'poll') await call('POST /admin/poll/:date', '/admin/poll/' + $('pollDate').value, {
          method: 'POST', headers: { Authorization: 'Bearer ' + config().internalApiKey },
        });
      } catch (error) {
        output.textContent = String(error?.stack ?? error);
      }
    });
  </script>
</body>
</html>`;
}
