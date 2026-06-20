// db.js — طبقة تخزين بسيطة باستخدام ملف JSON
// لاحقاً يمكن استبدال هذا الملف بالكامل بطبقة MySQL باستخدام نفس الجداول
// الموجودة في database_schema.sql بدون تغيير أي شيء في server.js أو routes.js

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function load() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { load, save };
