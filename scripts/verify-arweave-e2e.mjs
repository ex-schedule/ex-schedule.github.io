import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const deployRecordPath = 'C:/Users/user/Documents/Codex/2026-10-31/schedule-share-local-validation/arweave-deployment-result.json';
const deployRecord = JSON.parse(await readFile(deployRecordPath, 'utf8'));

// 1. Verify live Arweave HTML (retry up to 90s while gateway indexes a freshly uploaded manifest)
let htmlRes = null;
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  htmlRes = await fetch(deployRecord.appBaseUrl, { redirect: 'follow' });
  if (htmlRes.status === 200) break;
  await new Promise(r => setTimeout(r, 3000));
}
assert.equal(htmlRes?.status, 200, `Expected HTTP 200 from ${deployRecord.appBaseUrl}, got ${htmlRes?.status}`);
const finalAppUrl = htmlRes.url;
const finalOrigin = new URL(finalAppUrl).origin;
const htmlText = await htmlRes.text();
assert.match(htmlText, /共有スケジュール/);
assert.match(htmlText, /no-referrer/);

const assetBaseUrl = new URL('./assets/', finalAppUrl).href;
const binAsset = deployRecord.uploadedFiles.find(f => f.path.endsWith('.bin'))?.path || 'assets/react-dom-B9cYKTGS.bin';
const binRes = await fetch(new URL('./' + binAsset, finalAppUrl).href);
assert.equal(binRes.status, 200);
const decompressed = await new Response(binRes.body.pipeThrough(new DecompressionStream('gzip'))).text();
const rewritten = decompressed.replaceAll('__ASSET_BASE__', assetBaseUrl);
const unreplaced = [...rewritten.matchAll(/(?:from|import)\s*["']\.\//g)];
assert.equal(unreplaced.length, 0, 'All relative imports in react-dom.bin must be rewritten to __ASSET_BASE__');

// 2. Bundle actual src/storage.ts and src/utils/memberStore.ts and test live CryptPad E2EE sync + member CRUD
const bundleOut = 'C:/Users/user/Documents/Codex/2026-10-31/schedule-share-local-validation/storage-live-bundle.mjs';
const memberStoreOut = 'C:/Users/user/Documents/Codex/2026-10-31/schedule-share-local-validation/member-store-live-bundle.mjs';
await build({
  entryPoints: ['C:/Users/user/orca/projects/my-workspace/products/schedule-share-autonomous/src/storage.ts'],
  outfile: bundleOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
await build({
  entryPoints: ['C:/Users/user/orca/projects/my-workspace/products/schedule-share-autonomous/src/utils/memberStore.ts'],
  outfile: memberStoreOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

const storage = await import(pathToFileURL(bundleOut).href);
const memberStore = await import(pathToFileURL(memberStoreOut).href);
const teamConfig = JSON.parse(
  await readFile('C:/Users/user/orca/projects/my-workspace/products/schedule-share-autonomous/config/team.json', 'utf8')
);

const editUrl = new URL(deployRecord.shareLinks.edit);
const viewUrl = new URL(deployRecord.shareLinks.view);

const editCreds = await storage.parseShareHash(editUrl.hash);
const viewCreds = await storage.parseShareHash(viewUrl.hash);
assert.equal(editCreds.readOnly, false);
assert.equal(viewCreds.readOnly, true);

// Custom WebSocket factory that sends the exact Arweave sandbox Origin header
const wsWithArweaveOrigin = url => new WebSocket(url, { headers: { Origin: finalOrigin } });

// Editor initializes the shared schedule channel on cryptpad.fr
const editorClient = await storage.createCryptPadDocumentClient(editCreds, {
  webSocketFactory: wsWithArweaveOrigin,
});

const now = new Date();
const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const initialSchedule = Object.fromEntries(
  teamConfig.members.map(m => [
    m,
    Array.from({ length: daysInMonth }, () => ({ type: 'rest', detail: '' })),
  ])
);

await storage.setDoc(storage.doc(editorClient, 'months', monthKey), {
  schedule: initialSchedule,
  memos: {},
  dones: {},
  goals: {},
  nextPlan: {},
  teamGoal: '',
  overallMemo: '',
  history: [],
  trainingLabels: teamConfig.trainingLabels || {},
  trainingLocations: teamConfig.trainingLocations || {},
  memberStations: {},
  dailyLocations: {},
  dailyTimes: {},
  clientNames: [],
  projects: [],
  updatedAt: storage.serverTimestamp(),
});

await storage.setDoc(storage.doc(editorClient, 'settings', 'global'), {
  members: teamConfig.members,
  leadMembers: teamConfig.leadMembers,
  memberStations: {},
  dailyLocations: {},
  dailyTimes: {},
  updatedAt: storage.serverTimestamp(),
});

// Verify live member add -> rename -> delete round-trip on cryptpad.fr
const afterAdd = await memberStore.addTeamMember(
  'テスト追加　太郎',
  true,
  teamConfig.members,
  teamConfig.leadMembers,
  editorClient
);
assert.equal(afterAdd.members.includes('テスト追加　太郎'), true);

const afterRename = await memberStore.renameTeamMember(
  'テスト追加　太郎',
  'テスト改名　次郎',
  false,
  afterAdd.members,
  afterAdd.leadMembers,
  [monthKey],
  editorClient
);
assert.equal(afterRename.members.includes('テスト改名　次郎'), true);
assert.equal(afterRename.members.includes('テスト追加　太郎'), false);

const afterDelete = await memberStore.deleteTeamMember(
  'テスト改名　次郎',
  afterRename.members,
  afterRename.leadMembers,
  [monthKey],
  editorClient
);
assert.deepEqual(afterDelete.members, teamConfig.members);

// Close editor completely (0 active peers)
editorClient.close();
await new Promise(r => setTimeout(r, 800));

// Connect fresh Viewer client from zero cache using the view-only link
const viewerClient = await storage.createCryptPadDocumentClient(viewCreds, {
  webSocketFactory: wsWithArweaveOrigin,
});

const restoredSnap = await storage.getDocFromServer(storage.doc(viewerClient, 'months', monthKey));
assert.equal(restoredSnap.exists(), true, 'Viewer must restore schedule after all editors disconnect');
const restoredData = restoredSnap.data();
assert.deepEqual(Object.keys(restoredData.schedule), teamConfig.members);

const restoredSettingsSnap = await storage.getDocFromServer(storage.doc(viewerClient, 'settings', 'global'));
assert.equal(restoredSettingsSnap.exists(), true);
assert.deepEqual(restoredSettingsSnap.data().members, teamConfig.members);

// Verify viewer cannot modify schedule
let viewerWriteBlocked = false;
try {
  await storage.setDoc(storage.doc(viewerClient, 'months', monthKey), { overallMemo: 'unauthorized' });
} catch (err) {
  viewerWriteBlocked = err.code === 'permission-denied';
}
assert.equal(viewerWriteBlocked, true, 'Viewer write must be blocked with permission-denied');
viewerClient.close();

const summary = {
  verifiedAt: new Date().toISOString(),
  arweaveAppUrl: deployRecord.appBaseUrl,
  arweaveResolvedSandboxUrl: finalAppUrl,
  arweaveSandboxOrigin: finalOrigin,
  reactDomDecompressedBytes: decompressed.length,
  unreplacedRelativeImports: unreplaced.length,
  cryptpadChannelId: editCreds.channelId,
  seededMonthKey: monthKey,
  memberCountRestored: Object.keys(restoredData.schedule).length,
  memberCrudLiveVerified: true,
  viewerWriteBlocked,
  editShareLink: deployRecord.shareLinks.edit,
  viewShareLink: deployRecord.shareLinks.view,
  allChecksPassed: true,
};

await writeFile(
  'C:/Users/user/Documents/Codex/2026-10-31/schedule-share-local-validation/arweave-e2e-verification.json',
  JSON.stringify(summary, null, 2),
  'utf8'
);
console.log(JSON.stringify(summary, null, 2));
