/**
 * protect-and-sanitize.cjs
 * Antigravity PreToolUse hook script:
 * 1. Blocks edits to protected modules (Razorpay, SendGrid, WhatsApp, Stripe, Ads, GBP, Brevo, agent registry, UCOS).
 * 2. Blocks commands that echo or dump environment variables / secrets.
 */

const fs = require('fs');

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf-8');
  } catch {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }

  if (!raw || !raw.trim()) {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }

  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const toolName = payload?.toolCall?.name || '';
  const args = payload?.toolCall?.args || {};

  // Check file edits using exact path segments, not loose substrings
  if (toolName === 'replace_file_content' || toolName === 'write_to_file') {
    const targetFile = (args.TargetFile || '').toLowerCase();
    const normalized = targetFile.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const protectedModules = [
      'razorpay',
      'sendgrid',
      'whatsapp',
      'stripe',
      'adwords',
      'ads',
      'gbp',
      'google-business',
      'brevo',
      'agent-registry',
      'ucos'
    ];

    for (const seg of segments) {
      const segNoExt = seg.replace(/\.[a-z0-9]+$/i, '');
      for (const mod of protectedModules) {
        if (seg === mod || segNoExt === mod || seg.split(/[-_.]/).includes(mod)) {
          console.log(JSON.stringify({
            decision: 'deny',
            reason: `SECURITY POLICY VIOLATION: Edits to protected module containing segment '${mod}' are strictly forbidden.`
          }));
          return;
        }
      }
    }
  }

  // Check shell commands for secret exposure
  if (toolName === 'run_command') {
    const cmd = (args.CommandLine || '').trim();
    const lowerCmd = cmd.toLowerCase();

    // 1. printenv
    if (/\bprintenv\b/i.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: "SECURITY POLICY VIOLATION: 'printenv' may leak environment secrets and is blocked."
      }));
      return;
    }

    // 2. PowerShell / CMD environment enumeration
    if (/(get-childitem|dir|gci|ls)\s+env:/i.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: "SECURITY POLICY VIOLATION: Environment drive enumeration (Env:) is blocked."
      }));
      return;
    }

    // 3. 'set' alone (displays all environment variables)
    if (/(^|[;&|])\s*set\s*([;&|]|$)/i.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: "SECURITY POLICY VIOLATION: Running 'set' alone prints all environment variables and is blocked."
      }));
      return;
    }

    // 4. Any command printing or writing $env: values to stdout or file
    if (/(\$env:[a-zA-Z0-9_]+.*(>|>>|out-file|set-content|add-content|tee-object|clip))|(echo|write-host|write-output)\s+.*\$env:/i.test(cmd) ||
        /\$env:.*>\s*\S+/i.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: "SECURITY POLICY VIOLATION: Printing or redirecting $env: values is blocked to prevent secret exfiltration."
      }));
      return;
    }

    // 5. Reading .env files
    if (/(cat|type|get-content|gc|head|tail|more|less|grep|findstr|select-string)\s+[^\n\r;&|]*\.env/i.test(cmd) ||
        /[^\n\r;&|]*\.env\b.*\|\s*(cat|type|head|tail|grep|findstr|select-string)/i.test(cmd) ||
        /<\s*[^\n\r;&|]*\.env\b/i.test(cmd)) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: "SECURITY POLICY VIOLATION: Reading .env files directly is blocked to protect secrets."
      }));
      return;
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
}

main();

