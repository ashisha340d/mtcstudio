'use strict';

const escpos = require('escpos');
escpos.USB = require('escpos-usb');

const { dbGet } = require('../database/db');

function parseId(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const n = s.toLowerCase().startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function describeDevice(device) {
  const desc = device.deviceDescriptor || {};
  const vendorId = desc.idVendor;
  const productId = desc.idProduct;
  return {
    vendor_id: '0x' + (vendorId ?? 0).toString(16).padStart(4, '0'),
    product_id: '0x' + (productId ?? 0).toString(16).padStart(4, '0'),
    label: `USB Printer ${('0000' + (vendorId ?? 0).toString(16)).slice(-4)}:${('0000' + (productId ?? 0).toString(16)).slice(-4)}`,
  };
}

// List ESC/POS-class USB printers currently plugged in.
function listUsbPrinters() {
  const devices = escpos.USB.findPrinter() || [];
  return devices.map(describeDevice);
}

// Resolve the printer_config row (vendor_id/product_id/paper_width).
async function getPrinterConfig() {
  return dbGet(`SELECT printer_name, vendor_id, product_id, paper_width FROM printer_config WHERE id = 1`);
}

// Open the configured USB device, or the first detected ESC/POS printer if none configured.
function openDevice(vendorId, productId) {
  if (vendorId && productId) return new escpos.USB(vendorId, productId);
  const devices = escpos.USB.findPrinter();
  if (!devices || !devices.length) throw new Error('No USB printer detected. Check the cable/power and that it is an ESC/POS thermal printer.');
  return new escpos.USB(devices[0]);
}

// Send a raw ESC/POS byte buffer to the printer, optionally multiple times.
function printRaw(buffer, { vendorId, productId, copies = 1 } = {}) {
  return new Promise((resolve, reject) => {
    let device;
    try {
      device = openDevice(vendorId, productId);
    } catch (e) {
      return reject(e);
    }

    device.open((err) => {
      if (err) return reject(err);

      const printer = new escpos.Printer(device);
      for (let i = 0; i < Math.max(1, copies); i++) {
        printer.print(buffer);
      }
      printer.flush(() => {
        device.close(() => resolve());
      });
    });
  });
}

// Convenience: load printer_config from DB and print, used by all print endpoints.
async function printRawUsingConfig(buffer, copies = 1) {
  const pcfg = await getPrinterConfig();
  const vendorId = parseId(pcfg?.vendor_id);
  const productId = parseId(pcfg?.product_id);
  if (!vendorId || !productId) {
    // fall back to auto-detect if nothing configured yet
    return printRaw(buffer, { copies });
  }
  return printRaw(buffer, { vendorId, productId, copies });
}

module.exports = { listUsbPrinters, getPrinterConfig, printRaw, printRawUsingConfig, parseId };
