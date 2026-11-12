/**
 * Lightweight zero-dependency Customer Desk Concierge widget rendered on /, /deals, and /tools/site-audit.
 * Connects directly to POST /api/v1/customer-desk/message with localStorage session persistence and
 * instant checkout / affiliate redirect buttons.
 */
export function renderCustomerDeskWidgetHtml(defaultContext: string = ''): string {
  const safeDefaultCtx = defaultContext.replace(/[^a-zA-Z0-9_\-/]/g, '');
  return `
<!-- Customer Desk 24/7 Concierge Widget -->
<div id="aros-desk-root" style="position:fixed;right:18px;bottom:18px;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <button id="aros-desk-toggle" type="button" onclick="window.__arosDeskToggle && window.__arosDeskToggle()" style="background:#0284c7;color:#fff;border:none;border-radius:999px;padding:12px 18px;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 8px 24px rgba(2,132,199,0.35);">
    Ask Concierge &amp; Instant Checkout
  </button>
  <div id="aros-desk-panel" style="display:none;width:340px;max-width:calc(100vw - 32px);background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;margin-top:10px;box-shadow:0 16px 40px rgba(0,0,0,0.45);overflow:hidden;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#1e293b;border-bottom:1px solid #334155;">
      <div>
        <strong style="font-size:14px;color:#f8fafc;">24/7 Verified Buyer Desk</strong>
        <div style="font-size:11px;color:#94a3b8;">Verified catalog pricing &amp; instant checkout</div>
      </div>
      <button type="button" onclick="window.__arosDeskToggle && window.__arosDeskToggle()" style="background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">&times;</button>
    </div>
    <div id="aros-desk-messages" style="height:230px;overflow-y:auto;padding:12px;font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:8px;">
      <div style="background:#1e293b;padding:8px 10px;border-radius:8px;">Ask about any verified product on <code>/deals</code>, SiteFix Core Fix-Pack (&#8377;499), or say <em>"Ready to buy"</em> after selecting an item.</div>
    </div>
    <div id="aros-desk-actions" style="padding:0 12px 8px;display:flex;flex-wrap:wrap;gap:6px;"></div>
    <form id="aros-desk-form" onsubmit="return window.__arosDeskSubmit ? window.__arosDeskSubmit(event) : false" style="display:flex;gap:6px;padding:10px 12px;border-top:1px solid #334155;background:#0b1220;">
      <input id="aros-desk-input" type="text" placeholder="Ask price, compare deals, or buy..." style="flex:1;background:#1e293b;border:1px solid #475569;color:#f8fafc;border-radius:6px;padding:8px 10px;font-size:13px;" />
      <button type="submit" style="background:#10b981;color:#fff;border:none;border-radius:6px;padding:8px 12px;font-weight:600;font-size:13px;cursor:pointer;">Send</button>
    </form>
  </div>
</div>
<script>
(function(){
  var sid = '';
  try { sid = localStorage.getItem('aros_desk_sid') || ''; } catch(e) {}
  if (!sid) {
    sid = 'web_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    try { localStorage.setItem('aros_desk_sid', sid); } catch(e) {}
  }
  var lastCtx = '${safeDefaultCtx}';
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
  }
  function appendMsg(role, text, extraHtml) {
    var box = document.getElementById('aros-desk-messages');
    if (!box) return;
    var el = document.createElement('div');
    el.style.cssText = role === 'user'
      ? 'background:#0369a1;color:#fff;padding:8px 10px;border-radius:8px;align-self:flex-end;max-width:88%;'
      : 'background:#1e293b;color:#e2e8f0;padding:8px 10px;border-radius:8px;align-self:flex-start;max-width:95%;';
    el.innerHTML = esc(text) + (extraHtml || '');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }
  function setActions(btns) {
    var area = document.getElementById('aros-desk-actions');
    if (!area) return;
    area.innerHTML = '';
    (btns || []).forEach(function(b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.style.cssText = 'background:' + (b.bg || '#0284c7') + ';color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;';
      btn.onclick = b.onClick;
      area.appendChild(btn);
    });
  }
  async function sendDesk(msgText, ctxSlug) {
    if (!msgText) return;
    appendMsg('user', msgText);
    setActions([]);
    try {
      var res = await fetch('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgText,
          sessionId: sid,
          productSlugOrContext: ctxSlug || lastCtx || undefined,
          contactChannel: 'WEB_DESK'
        })
      });
      var data = await res.json();
      if (data.sessionId) sid = data.sessionId;
      if (data.resolvedOffer && data.resolvedOffer.idOrSlug) lastCtx = data.resolvedOffer.idOrSlug;
      var extra = '';
      if (data.checkout && data.checkout.checkoutMode === 'OWNED_CHECKOUT_CREATED') {
        extra = '<div style="margin-top:6px;padding:6px;background:#0f172a;border-radius:6px;">' +
          '<div><strong>Order:</strong> <code>' + esc(data.checkout.orderId) + '</code> (&#8377;' + esc(data.checkout.amountINR) + ')</div>' +
          (data.checkout.checkoutUrl ? '<div style="margin-top:4px;"><a href="' + esc(data.checkout.checkoutUrl) + '" style="color:#38bdf8;font-weight:600;">Open Checkout &rarr;</a></div>' : '') +
          '</div>';
      } else if (data.checkout && data.checkout.checkoutMode === 'AFFILIATE_REDIRECT_READY') {
        extra = '<div style="margin-top:6px;"><a href="' + esc(data.checkout.redirectUrl) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#059669;color:#fff;padding:6px 10px;border-radius:6px;text-decoration:none;font-weight:600;">Go to Verified Merchant &rarr;</a></div>';
      }
      appendMsg('bot', data.reply || data.error || 'Response unavailable.', extra);
      var acts = [];
      if (Array.isArray(data.clarificationOptions) && data.clarificationOptions.length > 0) {
        data.clarificationOptions.forEach(function(opt) {
          acts.push({
            label: opt.title.slice(0, 26) + (opt.priceINR ? ' (₹' + opt.priceINR + ')' : ''),
            bg: '#334155',
            onClick: function() { sendDesk('Price and details for ' + opt.title, opt.idOrSlug); }
          });
        });
      } else if (data.resolvedOffer && !data.checkout) {
        acts.push({
          label: 'Buy / Proceed (' + (data.resolvedOffer.priceINR !== null ? '₹' + data.resolvedOffer.priceINR : 'Go') + ')',
          bg: '#059669',
          onClick: function() { sendDesk('I am ready to buy now. Proceed with checkout.', data.resolvedOffer.idOrSlug); }
        });
      }
      setActions(acts);
    } catch (err) {
      appendMsg('bot', 'Desk temporarily unreachable: ' + (err && err.message ? err.message : 'network error'));
    }
  }
  window.__arosDeskToggle = function() {
    var p = document.getElementById('aros-desk-panel');
    if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
  };
  window.__arosDeskSubmit = function(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var inp = document.getElementById('aros-desk-input');
    var v = inp ? inp.value.trim() : '';
    if (!v) return false;
    inp.value = '';
    sendDesk(v, lastCtx);
    return false;
  };
})();
</script>`;
}
