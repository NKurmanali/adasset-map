import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  await fs.access('.env.local');
  console.log('Existing .env.local preserved.');
} catch {
  const password = randomBytes(18).toString('base64url') + '!Aa1';
  await fs.writeFile(
    '.env.local',
    `DATA_DIR=.data\nAUTH_PROVIDER=local\nDEMO_SEED=true\nDEMO_PASSWORD=${password}\nAPP_ORIGIN=http://127.0.0.1:3000\nNEXT_TELEMETRY_DISABLED=1\n`,
  );
  await fs.writeFile(
    '.local-access.txt',
    `AdAsset Map — LOCAL ONLY\nURL: http://127.0.0.1:3000\nUser: admin@adasset.local\nPassword: ${password}\nDemo roles: admin, manager, dispatcher, inspector, technician, leader, observer @adasset.local\nAll local demo users use this password. Never commit this file.\n`,
  );
  console.log('Created .env.local and .local-access.txt with a random local demo password.');
}
