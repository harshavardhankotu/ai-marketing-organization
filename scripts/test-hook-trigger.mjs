import { execSync } from 'child_process';

const payload = {
  toolCall: {
    name: 'replace_file_content',
    args: {
      TargetFile: 'packages/backend/src/integrations/razorpay.ts',
      TargetContent: 'foo',
      ReplacementContent: 'bar'
    }
  }
};

const result = execSync('node .agents/scripts/protect-and-sanitize.cjs', {
  input: JSON.stringify(payload),
  encoding: 'utf-8'
});

console.log('HOOK_RAW_OUTPUT:', result.trim());
