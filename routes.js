// routes.js — منطق الأعمال لكل نقطة نهاية (API endpoint)
const { load, save } = require('./db');

function ok(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function fail(res, code, message) {
  ok(res, code, { error: message });
}

// ===== المنتجات (المخزون) =====
function listProducts(req, res) {
  const data = load();
  ok(res, 200, data.products);
}

function createProduct(req, res, body) {
  const data = load();
  const newId = data.products.length ? Math.max(...data.products.map(p => p.id)) + 1 : 1;
  const product = {
    id: newId,
    name: body.name,
    barcode: body.barcode || '',
    buy: Number(body.buy) || 0,
    sell: Number(body.sell) || 0,
    qty: Number(body.qty) || 0,
    min: Number(body.min) || 5,
    unit: body.unit || 'قطعة',
  };
  if (!product.name) return fail(res, 400, 'اسم المنتج مطلوب');
  data.products.push(product);
  save(data);
  ok(res, 201, product);
}

function updateProduct(req, res, body, id) {
  const data = load();
  const product = data.products.find(p => p.id === id);
  if (!product) return fail(res, 404, 'المنتج غير موجود');
  Object.assign(product, {
    name: body.name ?? product.name,
    barcode: body.barcode ?? product.barcode,
    buy: body.buy !== undefined ? Number(body.buy) : product.buy,
    sell: body.sell !== undefined ? Number(body.sell) : product.sell,
    qty: body.qty !== undefined ? Number(body.qty) : product.qty,
    min: body.min !== undefined ? Number(body.min) : product.min,
    unit: body.unit ?? product.unit,
  });
  save(data);
  ok(res, 200, product);
}

function deleteProduct(req, res, id) {
  const data = load();
  const exists = data.products.some(p => p.id === id);
  if (!exists) return fail(res, 404, 'المنتج غير موجود');
  data.products = data.products.filter(p => p.id !== id);
  save(data);
  ok(res, 200, { deleted: true });
}

// ===== العملاء والموردين =====
function listCustomers(req, res) {
  const data = load();
  ok(res, 200, data.customers);
}
function listSuppliers(req, res) {
  const data = load();
  ok(res, 200, data.suppliers);
}

// ===== فاتورة بيع — القلب الأساسي للمنطق =====
function createSalesInvoice(req, res, body) {
  const data = load();
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return fail(res, 400, 'الفاتورة لا تحتوي على أصناف');

  // فحص توفر الكمية لكل صنف قبل أي تعديل
  for (const it of items) {
    const product = data.products.find(p => p.id === Number(it.productId));
    if (!product) return fail(res, 400, `المنتج رقم ${it.productId} غير موجود`);
    if (Number(it.qty) > product.qty) {
      return fail(res, 400, `الكمية المطلوبة من "${product.name}" أكبر من المتوفر بالمخزون (${product.qty})`);
    }
  }

  // تنفيذ العملية: خصم المخزون + حساب الإجمالي
  let totalAmount = 0;
  const lineItems = [];
  for (const it of items) {
    const product = data.products.find(p => p.id === Number(it.productId));
    const qty = Number(it.qty);
    const unitPrice = Number(it.price) || product.sell;
    product.qty -= qty;
    totalAmount += qty * unitPrice;
    lineItems.push({ productId: product.id, productName: product.name, qty, unitPrice, total: qty * unitPrice });

    data.stockMovements.push({
      id: data.stockMovements.length + 1,
      productId: product.id,
      type: 'out',
      qty,
      reason: 'sale',
      date: new Date().toISOString(),
    });
  }

  const paidAmount = Number(body.paidAmount) || 0;
  const remaining = Math.max(totalAmount - paidAmount, 0);
  const status = remaining === 0 ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid');

  // تحديث دين العميل لو فيه متبقي
  let customer = null;
  if (body.customerId) {
    customer = data.customers.find(c => c.id === Number(body.customerId));
    if (customer && remaining > 0) {
      customer.debt = Number((customer.debt + remaining).toFixed(2));
    }
  }

  const invoice = {
    id: data.counters.salesInvoice++,
    customerId: customer ? customer.id : null,
    customerName: customer ? customer.name : 'عميل نقدي',
    date: body.date || new Date().toISOString().slice(0, 10),
    items: lineItems,
    totalAmount: Number(totalAmount.toFixed(2)),
    paidAmount: Number(paidAmount.toFixed(2)),
    remainingAmount: Number(remaining.toFixed(2)),
    status,
  };
  data.salesInvoices.unshift(invoice);
  save(data);
  ok(res, 201, invoice);
}

function listSalesInvoices(req, res) {
  const data = load();
  ok(res, 200, data.salesInvoices);
}

// ===== فاتورة شراء — تزيد المخزون وتزيد دينك للمورد =====
function createPurchaseInvoice(req, res, body) {
  const data = load();
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return fail(res, 400, 'الفاتورة لا تحتوي على أصناف');

  for (const it of items) {
    if (!it.productId && !it.newProduct) return fail(res, 400, 'كل صنف يحتاج منتج موجود أو منتج جديد');
  }

  let totalAmount = 0;
  const lineItems = [];

  for (const it of items) {
    const qty = Number(it.qty);
    const unitCost = Number(it.price) || 0;
    let product;

    if (it.newProduct) {
      // منتج جديد يُضاف للمخزون لأول مرة عبر فاتورة الشراء
      const newId = data.products.length ? Math.max(...data.products.map(p => p.id)) + 1 : 1;
      product = {
        id: newId,
        name: it.newProduct.name,
        barcode: it.newProduct.barcode || '',
        buy: unitCost,
        sell: Number(it.newProduct.sell) || unitCost,
        qty: 0,
        min: Number(it.newProduct.min) || 5,
        unit: it.newProduct.unit || 'قطعة',
      };
      data.products.push(product);
    } else {
      product = data.products.find(p => p.id === Number(it.productId));
      if (!product) return fail(res, 400, `المنتج رقم ${it.productId} غير موجود`);
      product.buy = unitCost; // تحديث سعر الشراء الأخير
    }

    product.qty += qty;
    totalAmount += qty * unitCost;
    lineItems.push({ productId: product.id, productName: product.name, qty, unitPrice: unitCost, total: qty * unitCost });

    data.stockMovements.push({
      id: data.stockMovements.length + 1,
      productId: product.id,
      type: 'in',
      qty,
      reason: 'purchase',
      date: new Date().toISOString(),
    });
  }

  const paidAmount = Number(body.paidAmount) || 0;
  const remaining = Math.max(totalAmount - paidAmount, 0);
  const status = remaining === 0 ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid');

  let supplier = null;
  if (body.supplierId) {
    supplier = data.suppliers.find(s => s.id === Number(body.supplierId));
    if (supplier && remaining > 0) {
      supplier.debt = Number((supplier.debt + remaining).toFixed(2));
    }
  }

  const invoice = {
    id: data.counters.purchaseInvoice++,
    supplierId: supplier ? supplier.id : null,
    supplierName: supplier ? supplier.name : 'مورد غير محدد',
    date: body.date || new Date().toISOString().slice(0, 10),
    items: lineItems,
    totalAmount: Number(totalAmount.toFixed(2)),
    paidAmount: Number(paidAmount.toFixed(2)),
    remainingAmount: Number(remaining.toFixed(2)),
    status,
  };
  data.purchaseInvoices.unshift(invoice);
  save(data);
  ok(res, 201, invoice);
}

function listPurchaseInvoices(req, res) {
  const data = load();
  ok(res, 200, data.purchaseInvoices);
}

// ===== الدفعات (تسديد الديون) =====
function createPayment(req, res, body) {
  const data = load();
  const amount = Number(body.amount) || 0;
  if (amount <= 0) return fail(res, 400, 'المبلغ يجب أن يكون أكبر من صفر');

  let entity = null;
  let type = body.type; // 'from_customer' | 'to_supplier'

  if (type === 'from_customer') {
    entity = data.customers.find(c => c.id === Number(body.customerId));
  } else if (type === 'to_supplier') {
    entity = data.suppliers.find(s => s.id === Number(body.supplierId));
  } else {
    return fail(res, 400, 'نوع الدفعة غير صحيح');
  }
  if (!entity) return fail(res, 404, 'الجهة غير موجودة');

  const applied = Math.min(amount, entity.debt);
  entity.debt = Number(Math.max(entity.debt - amount, 0).toFixed(2));

  const payment = {
    id: data.counters.payment++,
    type,
    name: entity.name,
    amount: applied,
    date: new Date().toISOString().slice(0, 10),
  };
  data.payments.unshift(payment);
  save(data);
  ok(res, 201, { payment, remainingDebt: entity.debt });
}

function listPayments(req, res) {
  const data = load();
  ok(res, 200, data.payments);
}

// ===== ملخص الديون =====
function debtsSummary(req, res) {
  const data = load();
  const totalCustomerDebt = data.customers.reduce((s, c) => s + c.debt, 0);
  const totalSupplierDebt = data.suppliers.reduce((s, s2) => s + s2.debt, 0);
  ok(res, 200, {
    customers: data.customers,
    suppliers: data.suppliers,
    totalCustomerDebt: Number(totalCustomerDebt.toFixed(2)),
    totalSupplierDebt: Number(totalSupplierDebt.toFixed(2)),
    netPosition: Number((totalCustomerDebt - totalSupplierDebt).toFixed(2)),
  });
}

module.exports = {
  listProducts, createProduct, updateProduct, deleteProduct,
  listCustomers, listSuppliers,
  createSalesInvoice, listSalesInvoices,
  createPurchaseInvoice, listPurchaseInvoices,
  createPayment, listPayments,
  debtsSummary,
  fail, ok,
};
