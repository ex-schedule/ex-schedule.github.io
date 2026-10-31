import { build as viteBuild } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateTeamConfig } from './team-config.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

const team = validateTeamConfig(JSON.parse(await readFile(new URL('config/team.json', root), 'utf8')));
const now = new Date(), year = now.getFullYear(), month = now.getMonth() + 1;
const schedule = Object.fromEntries(
  team.members.map(name => [
    name,
    Array.from({ length: new Date(year, month, 0).getDate() }, () => ({ type: 'rest', detail: '' })),
  ])
);

await mkdir(new URL('server', root), { recursive: true });
await writeFile(
  new URL('server/seed.json', root),
  JSON.stringify(
    {
      format: 'ex-schedule-v1',
      documents: [
        {
          collection: 'months',
          id: year + '-' + month,
          version: 1,
          data: {
            schedule,
            memos: {},
            dones: {},
            goals: {},
            nextPlan: {},
            teamGoal: '',
            overallMemo: '',
            history: [],
            trainingLabels: team.trainingLabels || {},
            trainingLocations: team.trainingLocations || {},
            memberStations: {},
            dailyLocations: {},
            dailyTimes: {},
            clientNames: [],
            projects: [],
          },
        },
        {
          collection: 'settings',
          id: 'global',
          version: 1,
          data: {
            members: team.members,
            leadMembers: team.leadMembers,
            memberStations: {},
            dailyLocations: {},
            dailyTimes: {},
          },
        },
      ],
    },
    null,
    2
  )
);

await viteBuild({ root: rootPath });
