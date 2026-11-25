/**
 * protect-and-sanitize.cjs
 * Antigravity PreToolUse hook script (FAIL-CLOSED):
 * 1. Denies execution on stdin read failure, empty stdin, or malformed JSON.
 * 2. Blocks edits to protected modules and sensitive Razorpay/B2B/auth paths.
 * 3. Blocks commands that echo or dump environment variables / secrets / .env / rzp-key.csv.
 */

const fs = require('fs');

function deny(reason) {
  console.log(JSON.stringify({ decision: 'deny', reason }));
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf-8');
  } catch {
    deny('SECURITY HOOK FAIL-CLOSED: Unable to read hook stdin payload.');
    return;
  }

  if (!raw || !raw.trim()) {
    deny('SECURITY HOOK FAIL-CLOSED: Empty hook stdin payload rejected.');
    return;
  }

  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    deny('SECURITY HOOK FAIL-CLOSED: Malformed JSON hook payload rejected.');
    return;
  }

  const toolName = payload?.toolCall?.name || '';
  const args = payload?.toolCall?.args || {};

  // Check file edits across both legacy and modern file-editing tools
  if (
    toolName === 'replace_file_content' ||
    toolName === 'write_to_file' ||
    toolName === 'edit_file' ||
    toolName === 'write_file'
  ) {
    const targetFile = (args.TargetFile || args.Path || '').toLowerCase();
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
          deny(`SECURITY POLICY VIOLATION: Edits to protected module containing segment '${mod}' are strictly forbidden.`);
          return;
        }
      }
    }

    // Protect sensitive credential, auth, and B2B checkout/route files
    const isProtectedSensitivePath =
      segments.some(seg => seg === 'rzp-key.csv' || seg.startsWith('.env')) ||
      normalized === 'routes/api.ts' ||
      normalized.endsWith('/routes/api.ts') ||
      normalized === 'owner-auth.ts' ||
      normalized.endsWith('/owner-auth.ts') ||
      normalized === 'b2b-pilot-service.ts' ||
      normalized.endsWith('/b2b-pilot-service.ts');

    if (isProtectedSensitivePath) {
      deny(`SECURITY POLICY VIOLATION: Edits to protected sensitive file '${normalized}' are blocked by security hook.`);
      return;
    }

    // Block writing mutation queries to Cloudflare D1 REST API in scratch/ or scripts/
    if (segments.includes('scratch') || segments.includes('scripts')) {
      const content =
        args.CodeContent ||
        args.ReplacementContent ||
        args.Content ||
        args.Replacement ||
        '';
      if (
        /api\.cloudflare\.com.*\/d1\/database.*\/query/i.test(content) &&
        /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table)\b/i.test(content)
      ) {
        deny("SECURITY POLICY VIOLATION: Mutation queries (INSERT/UPDATE/DELETE) against Cloudflare D1 REST API from scratch/ or scripts/ are strictly prohibited.");
        return;
      }
    }
  }

  // Check shell commands for secret exposure
  if (toolName === 'run_command') {
    const cmd = (args.CommandLine || '').trim();

    // 1. printenv
    if (/\bprintenv\b/i.test(cmd)) {
      deny("SECURITY POLICY VIOLATION: 'printenv' may leak environment secrets and is blocked.");
      return;
    }

    // 2. PowerShell / CMD environment enumeration
    if (/(get-childitem|dir|gci|ls)\s+env:/i.test(cmd)) {
      deny("SECURITY POLICY VIOLATION: Environment drive enumeration (Env:) is blocked.");
      return;
    }

    // 3. 'set' alone (displays all environment variables)
    if (/(^|[;&|])\s*set\s*([;&|]|$)/i.test(cmd)) {
      deny("SECURITY POLICY VIOLATION: Running 'set' alone prints all environment variables and is blocked.");
      return;
    }

    // 4. Any command printing or writing $env: values to stdout or file
    if (
      /(\$env:[a-zA-Z0-9_]+.*(>|>>|out-file|set-content|add-content|tee-object|clip))|(echo|write-host|write-output)\s+.*\$env:/i.test(cmd) ||
      /\$env:.*>\s*\S+/i.test(cmd)
    ) {
      deny("SECURITY POLICY VIOLATION: Printing or redirecting $env: values is blocked to prevent secret exfiltration.");
      return;
    }

    // 5. Reading .env or rzp-key.csv files
    if (
      /(cat|type|get-content|gc|head|tail|more|less|grep|findstr|select-string)\s+[^\n\r;&|]*(?:\.env|rzp-key\.csv)/i.test(cmd) ||
      /[^\n\r;&|]*(?:\.env|rzp-key\.csv)\b.*\|\s*(cat|type|head|tail|grep|findstr|select-string)/i.test(cmd) ||
      /<\s*[^\n\r;&|]*(?:\.env|rzp-key\.csv)\b/i.test(cmd)
    ) {
      deny("SECURITY POLICY VIOLATION: Reading .env or rzp-key.csv files directly is blocked to protect secrets.");
      return;
    }

    // 6. Direct D1 REST query mutation
    if (
      /api\.cloudflare\.com.*\/d1\/database.*\/query/i.test(cmd) &&
      /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table)\b/i.test(cmd)
    ) {
      deny("SECURITY POLICY VIOLATION: Mutation queries (INSERT/UPDATE/DELETE) against Cloudflare D1 REST API are strictly prohibited.");
      return;
    }

    // 7. Execution of scratch or script files containing D1 mutations
    const scriptMatch = cmd.match(/\bnode\s+([^\s;&|]+\.m?js)\b/i);
    if (scriptMatch) {
      const scriptPath = scriptMatch[1].replace(/\\/g, '/');
      if ((scriptPath.startsWith('scratch/') || scriptPath.startsWith('scripts/')) && fs.existsSync(scriptMatch[1])) {
        try {
          const scriptContent = fs.readFileSync(scriptMatch[1], 'utf8');
          if (
            /api\.cloudflare\.com.*\/d1\/database.*\/query/i.test(scriptContent) &&
            /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table)\b/i.test(scriptContent)
          ) {
            deny(`SECURITY POLICY VIOLATION: Execution of '${scriptMatch[1]}' blocked. Mutation queries (INSERT/UPDATE/DELETE) against Cloudflare D1 REST API from scratch/ or scripts/ are strictly prohibited.`);
            return;
          }
        } catch {}
      }
    }

    // 8. Blocking agent setting owner facts in Render API calls (Step 5d)
    const ownerFactVars = [
      'ASSOCIATES_APPLICATION_DATE',
      'ASSOCIATES_LISTED_SITE_URL',
      'ASSOCIATES_AGREEMENT_READ',
      'PUBLIC_SITE_NAME',
      'PUBLIC_AUTHOR_NAME',
      'PUBLIC_CONTACT_EMAIL',
      'DIRECT_OFFER_TERMS_SHA256'
    ];
    if (/api\.render\.com.*\/env-vars/i.test(cmd)) {
      for (const ov of ownerFactVars) {
        if (cmd.includes(ov)) {
          deny(`SECURITY POLICY VIOLATION: Agent is strictly forbidden from setting owner-fact variable '${ov}' in Render. Only the owner may supply owner facts.`);
          return;
        }
      }
    }

    // 9. Block curl -X POST (and POST fetch/requests) against the production host
    if (
      /(curl|invoke-webrequest|iwr|irm|invoke-restmethod)\b.*(-x\s+post|--request\s+post|-method\s+post)\b.*ai-marketing-organization\.onrender\.com/i.test(cmd) ||
      /(curl|invoke-webrequest|iwr|irm|invoke-restmethod)\b.*ai-marketing-organization\.onrender\.com.*(-x\s+post|--request\s+post|-method\s+post)/i.test(cmd)
    ) {
      deny("SECURITY POLICY VIOLATION: Calling production write endpoints (POST against ai-marketing-organization.onrender.com) is strictly forbidden. Test on local server and test database only.");
      return;
    }

    // 10. Block agent from running owner-apply.mjs
    if (/\bowner-apply\.m?js\b/i.test(cmd)) {
      deny("SECURITY POLICY VIOLATION: Agent is strictly forbidden from executing scripts/owner-apply.mjs. Only the human owner may run this script.");
      return;
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
}

main();
