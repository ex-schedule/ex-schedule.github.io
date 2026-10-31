// Stop the server before offline restore. No provider account or cloud credentials.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DocumentStore } from '../server/store.mjs';
const [action, dataDirectory, filename, flag] = process.argv.slice(2);
if (!['export', 'import'].includes(action) || !dataDirectory || !filename) {
  console.error('Usage: node scripts/backup.mjs export|import DATA_DIRECTORY FILE [--replace]');
  process.exit(2);
}
const dataDir = resolve(dataDirectory), store = new DocumentStore(join(dataDir, 'schedule.sqlite'));
try {
  if (action === 'export') writeFileSync(resolve(filename), JSON.stringify(store.exportData(), null, 2), { flag: 'wx', mode: 0o600 });
  else {
    const payload = JSON.parse(readFileSync(resolve(filename), 'utf8'));
    const before = store.exportData();
    if (before.documents.length && flag !== '--replace') throw new Error('既存データがあります。置換には --replace が必要です。');
    if (before.documents.length) {
      mkdirSync(join(dataDir, 'backups'), { recursive: true });
      writeFileSync(join(dataDir, 'backups', 'before-restore-' + Date.now() + '.json'), JSON.stringify(before), { flag: 'wx', mode: 0o600 });
    }
    store.restore(payload, flag === '--replace');
  }
  console.log(action === 'export' ? 'バックアップを保存しました。' : 'データを取り込みました。');
} finally { store.close(); }
