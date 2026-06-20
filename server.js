// server.js — خادم Node.js أساسي بدون أي مكتبات خارجية (لا يحتاج npm install)
// تشغيل: node server.js   ثم افتح: http://localhost:3000

const http = require('http');
const url = require('url');
const routes = require('./routes');

const PORT = process.env.PORT || 3000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const segments = parsed.pathname.split('/').filter(Boolean); // ['api','products','3']

  try {
    // ===== المنتجات =====
    if (segments[0] === 'api' && segments[1] === 'products') {
      const id = segments[2] ? Number(segments[2]) : null;
      if (req.method === 'GET' && !id) return routes.listProducts(req, res);
      if (req.method === 'POST' && !id) {
        const body = await readBody(req);
        return routes.createProduct(req, res, body);
      }
      if (req.method === 'PUT' && id) {
        const body = await readBody(req);
        return routes.updateProduct(req, res, body, id);
      }
      if (req.method === 'DELETE' && id) return routes.deleteProduct(req, res, id);
    }

    // ===== العملاء والموردين =====
    if (segments[0] === 'api' && segments[1] === 'customers' && req.method === 'GET') {
      return routes.listCustomers(req, res);
    }
    if (segments[0] === 'api' && segments[1] === 'suppliers' && req.method === 'GET') {
      return routes.listSuppliers(req, res);
    }

    // ===== فواتير البيع =====
    if (segments[0] === 'api' && segments[1] === 'sales-invoices') {
      if (req.method === 'GET') return routes.listSalesInvoices(req, res);
      if (req.method === 'POST') {
        const body = await readBody(req);
        return routes.createSalesInvoice(req, res, body);
      }
    }

    // ===== فواتير الشراء =====
    if (segments[0] === 'api' && segments[1] === 'purchase-invoices') {
      if (req.method === 'GET') return routes.listPurchaseInvoices(req, res);
      if (req.method === 'POST') {
        const body = await readBody(req);
        return routes.createPurchaseInvoice(req, res, body);
      }
    }

    // ===== الدفعات =====
    if (segments[0] === 'api' && segments[1] === 'payments') {
      if (req.method === 'GET') return routes.listPayments(req, res);
      if (req.method === 'POST') {
        const body = await readBody(req);
        return routes.createPayment(req, res, body);
      }
    }

    // ===== ملخص الديون =====
    if (segments[0] === 'api' && segments[1] === 'debts' && segments[2] === 'summary' && req.method === 'GET') {
      return routes.debtsSummary(req, res);
    }

    return routes.fail(res, 404, 'المسار غير موجود');
  } catch (err) {
    return routes.fail(res, 500, 'خطأ في الخادم: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`✓ الخادم يعمل على http://localhost:${PORT}`);
});
