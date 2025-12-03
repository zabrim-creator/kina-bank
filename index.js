const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ====== CONFIG – TEST ENVIRONMENT ======
const CONFIG = {
  merchant: '000000099999004',    // TEST merchant (hosted payment page)
  terminal: '99999004',           // TEST terminal (hosted payment page)
  currency: 'PGK',
  merchName: 'Colygoweh',
  merchUrl: 'https://www.colygoweh.com', // your Wix site URL
  country: 'PG',
  merchGmt: '+1000',              // optional; adjust if needed
  email: 'you@example.com',       // put your email here
  // TEST secret key from Kina doc:
  secretHex: 'debdd135e436905c7a02f20c56c83a4c501adf555457f0df',
  // while testing locally, backref is your own machine:
  backrefBase: 'https://kina-bank.onrender.com/kina/backref',
};

const TEST_GATEWAY_URL = 'https://test-ipg.kinabank.com.pg/cgi-bin/cgi_link';

// ====== HELPERS ======

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// YYYYMMDDHHMMSS in UTC (Kina expects GMT)
function getGmtTimestamp() {
  const d = new Date();
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds())
  );
}

// random hex 16 bytes (32 chars)
function generateNonce() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function lenVal(v) {
  if (v === undefined || v === null || v === '') return '-';
  const s = String(v);
  return `${s.length}${s}`;
}

// Build MAC source string for TRTYPE = 1 (Authorization Request)
function buildMacSourceForAuth(fields) {
  const {
    TERMINAL,
    TRTYPE,
    AMOUNT,
    CURRENCY,
    ORDER,
    MERCHANT,
    EMAIL,
    BACKREF,
    TIMESTAMP,
    MERCH_NAME,
    COUNTRY,
    MERCH_URL,
    MERCH_GMT,
    DESC,
    NONCE,
  } = fields;

  const parts = [
    TERMINAL,
    TRTYPE,
    AMOUNT,
    CURRENCY,
    ORDER,
    MERCHANT,
    EMAIL,
    BACKREF,
    TIMESTAMP,
    MERCH_NAME,
    COUNTRY,
    MERCH_URL,
    MERCH_GMT,
    DESC,
    NONCE,
  ];

  return parts.map(lenVal).join('');
}

function generatePSign(macSource, secretHex) {
  const key = Buffer.from(secretHex, 'hex');
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(macSource, 'utf8');
  return hmac.digest('hex').toUpperCase();
}

// ====== ROUTES ======

// Simple health check
app.get('/', (req, res) => {
  res.send('Kina payments backend is running.');
});

/**
 * /pay – entry point from Wix or from your browser when testing.
 * Example URL:
 *   http://localhost:3000/pay?orderId=TEST123&amount=50.00
 */
app.get('/pay', (req, res) => {
  const orderId = (req.query.orderId || 'TEST123456').toString();
  const amount = (req.query.amount || '5.00').toString();

  const timestamp = getGmtTimestamp();
  const nonce = generateNonce();

  const fields = {
    AMOUNT: amount,
    CURRENCY: CONFIG.currency,
    ORDER: orderId,
    DESC: `Order ${orderId}`,
    MERCH_NAME: CONFIG.merchName,
    MERCH_URL: CONFIG.merchUrl,
    MERCHANT: CONFIG.merchant,
    TERMINAL: CONFIG.terminal,
    EMAIL: CONFIG.email,
    TRTYPE: '1',
    TIMESTAMP: timestamp,
    NONCE: nonce,
    BACKREF: CONFIG.backrefBase,
    COUNTRY: CONFIG.country,
    MERCH_GMT: CONFIG.merchGmt,
  };

  const macSource = buildMacSourceForAuth({
    TERMINAL: fields.TERMINAL,
    TRTYPE: fields.TRTYPE,
    AMOUNT: fields.AMOUNT,
    CURRENCY: fields.CURRENCY,
    ORDER: fields.ORDER,
    MERCHANT: fields.MERCHANT,
    EMAIL: fields.EMAIL,
    BACKREF: fields.BACKREF,
    TIMESTAMP: fields.TIMESTAMP,
    MERCH_NAME: fields.MERCH_NAME,
    COUNTRY: fields.COUNTRY,
    MERCH_URL: fields.MERCH_URL,
    MERCH_GMT: fields.MERCH_GMT,
    DESC: fields.DESC,
    NONCE: fields.NONCE,
  });

  const pSign = generatePSign(macSource, CONFIG.secretHex);

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Redirecting to Kina Bank...</title>
</head>
<body>
  <p>Redirecting to Kina Bank secure payment page...</p>
  <form id="kblPaymentForm" action="${TEST_GATEWAY_URL}" method="POST">
    <input type="hidden" name="AMOUNT" value="${fields.AMOUNT}" />
    <input type="hidden" name="CURRENCY" value="${fields.CURRENCY}" />
    <input type="hidden" name="ORDER" value="${fields.ORDER}" />
    <input type="hidden" name="DESC" value="${fields.DESC}" />
    <input type="hidden" name="MERCH_NAME" value="${fields.MERCH_NAME}" />
    <input type="hidden" name="MERCH_URL" value="${fields.MERCH_URL}" />
    <input type="hidden" name="MERCHANT" value="${fields.MERCHANT}" />
    <input type="hidden" name="TERMINAL" value="${fields.TERMINAL}" />
    <input type="hidden" name="EMAIL" value="${fields.EMAIL}" />
    <input type="hidden" name="TRTYPE" value="${fields.TRTYPE}" />
    <input type="hidden" name="TIMESTAMP" value="${fields.TIMESTAMP}" />
    <input type="hidden" name="NONCE" value="${fields.NONCE}" />
    <input type="hidden" name="BACKREF" value="${fields.BACKREF}" />
    <input type="hidden" name="COUNTRY" value="${fields.COUNTRY}" />
    <input type="hidden" name="MERCH_GMT" value="${fields.MERCH_GMT}" />
    <input type="hidden" name="P_SIGN" value="${pSign}" />
    <noscript>
      <button type="submit">Click here to pay</button>
    </noscript>
  </form>

  <script>
    document.getElementById('kblPaymentForm').submit();
  </script>
</body>
</html>
`;

  res.send(html);
});

// Redirect URLs for Wix pages
const WIX_SUCCESS_URL = 'https://www.colygoweh.com/payment-success';
const WIX_FAILED_URL  = 'https://www.colygoweh.com/payment-failed';

// Unified backref handler for GET & POST, single or double slash
function handleBackref(req, res) {
  const data = Object.keys(req.body).length ? req.body : req.query;
  console.log('BACKREF received from Kina:', data);

  const action = data.ACTION;
  const rc = data.RC;
  const order = data.ORDER || 'UNKNOWN';

  // In TEST environment, RC=00 means approved
  const isSuccess = rc === '00';

  if (isSuccess) {
    res.redirect(`${WIX_SUCCESS_URL}?order=${encodeURIComponent(order)}`);
  } else {
    res.redirect(`${WIX_FAILED_URL}?order=${encodeURIComponent(order)}`);
  }
}

// Accept /kina/backref and //kina/backref, GET + POST
app.all(['/kina/backref', '//kina/backref'], handleBackref);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Kina payments backend listening on port', PORT);
});




