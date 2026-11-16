// Cashfree checkout window.
// Loads the Cashfree JS SDK (prod or sandbox, per the backend's mode) and
// opens checkout with the payment_session_id from POST /api/subscriptions/checkout.
// After paying, "Verify" calls GET /api/subscriptions/verify — the webhook
// also activates the subscription server-side, so closing early is safe.
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const psid = q.get('psid') || '';
const mode = (q.get('mode') || 'SANDBOX').toUpperCase();
const orderId = q.get('order_id') || '';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

async function verify() {
  $('ckResult').textContent = 'Verifying payment…';
  try {
    const r = await window.api.apiCall('/api/subscriptions/verify?order_id=' + encodeURIComponent(orderId), {});
    if (r.status === 200 && r.data && r.data.subscription) {
      $('ckResult').textContent = '✅ Payment confirmed — your plan is now ' + (r.data.subscription.plan_slug || 'active') + '. Close this window and enjoy.';
      $('ckStatus').textContent = 'Done.';
    } else {
      $('ckResult').textContent = 'Not confirmed yet (' + (r.data?.status || r.data?.error || ('HTTP ' + r.status)) + '). If you paid, wait a few seconds and tap Verify again — or check Pricing in the main window.';
    }
  } catch (err) {
    $('ckResult').textContent = 'Verify failed: ' + err.message;
  }
}

async function boot() {
  if (!psid) { $('ckStatus').textContent = 'No payment session — close this window and try Subscribe again.'; return; }
  const src = mode === 'PROD'
    ? 'https://sdk.cashfree.com/js/ui/2.0.0/cashfree.prod.js'
    : 'https://sdk.cashfree.com/js/ui/2.0.0/cashfree.sandbox.js';
  try {
    await loadScript(src);
    const cashfree = Cashfree({ mode: mode === 'PROD' ? 'production' : 'sandbox' });
    $('ckStatus').textContent = 'Opening secure payment…';
    await cashfree.checkout({ paymentSessionId: psid, redirectTarget: '_modal' });
    $('ckStatus').textContent = 'Payment window closed. Verifying…';
    await verify();
  } catch (err) {
    $('ckStatus').textContent = 'Checkout could not open automatically: ' + err.message + ' — tap “Verify my plan” after paying, or close and try again.';
  }
}

$('btnVerify').addEventListener('click', verify);
$('btnClose').addEventListener('click', () => window.close());
boot();
