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

  // Check file edits
  if (toolName === 'replace_file_content' || toolName === 'write_to_file') {
    const targetFile = (args.TargetFile || '').toLowerCase();
    const protectedKeywords = [
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

    for (const kw of protectedKeywords) {
      if (targetFile.includes(kw)) {
        console.log(JSON.stringify({
          decision: 'deny',
          reason: `SECURITY POLICY VIOLATION: Edits to protected module containing '${kw}' are strictly forbidden.`
        }));
        return;
      }
    }
  }

  // Check shell commands for secret exposure
  if (toolName === 'run_command') {
    const cmd = (args.CommandLine || '').toLowerCase();
    const unsafePatterns = [
      'printenv',
      'env |',
      'env >',
      'echo $env:',
      'dir env:',
      'get-childitem env:',
      'type .env',
      'cat .env'
    ];

    for (const pat of unsafePatterns) {
      if (cmd.includes(pat)) {
        console.log(JSON.stringify({
          decision: 'deny',
          reason: `SECURITY POLICY VIOLATION: Command containing pattern '${pat}' may leak environment secrets and is blocked.`
        }));
        return;
      }
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
}

main();
