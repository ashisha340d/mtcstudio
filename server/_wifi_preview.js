// Preview harness — mounts ONLY the wifi portal. No SMS, no printers, no POS.
// Safe to delete when you're done looking.
require('dotenv').config();
const express = require('express');
const { networkInterfaces } = require('os');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use('/public', express.static(__dirname + '/public'));
app.use('/favicon.ico', express.static(__dirname + '/../favicon.ico'));
app.use('/wifi', require('./routes/wifi'));
app.get('/', (req, res) => res.redirect('/wifi'));

const PORT = 3999;
app.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const iface of Object.values(networkInterfaces()))
    for (const a of iface) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  console.log('');
  console.log('  Wi-Fi portal preview');
  console.log(`  Desktop →  http://localhost:${PORT}/wifi`);
  ips.forEach(ip => console.log(`  Phone   →  http://${ip}:${PORT}/wifi`));
  console.log('');
});
