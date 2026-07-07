const escpos = require('escpos');
escpos.USB = require('escpos-usb');

const device = new escpos.USB(0x0416, 0x5011);

device.open((err) => {
  if (err) {
    console.error('OPEN ERROR:', err);
    return;
  }

  const printer = new escpos.Printer(device);
  printer
    .align('CT')
    .style('B')
    .size(1, 1)
    .text('MUNCH TIME CAFE')
    .text('Narayangarh, Chitwan')
    .text('-------------------------------')
    .align('LT')
    .text('Invoice #: TEST001')
    .text('Date: ' + new Date().toLocaleString())
    .text('-------------------------------')
    .tableCustom([
      { text: 'Burger', align: 'LEFT', width: 0.6 },
      { text: '2', align: 'CENTER', width: 0.1 },
      { text: '500', align: 'RIGHT', width: 0.3 }
    ])
    .tableCustom([
      { text: 'Coffee', align: 'LEFT', width: 0.6 },
      { text: '1', align: 'CENTER', width: 0.1 },
      { text: '180', align: 'RIGHT', width: 0.3 }
    ])
    .text('-------------------------------')
    .align('RT')
    .text('TOTAL: Rs 680')
    .text('')
    .align('CT')
    .text('DIRECT USB TEST')
    .text('')
    .cut()
    .close();
});
