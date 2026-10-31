export function validateTeamConfig(team) {
  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  if (!team || !Array.isArray(team.members) || !team.members.length ||
      team.members.some(x => typeof x !== 'string' || !x.trim() || x !== x.trim() || x.length > 80 || reserved.has(x)) ||
      new Set(team.members).size !== team.members.length)
    throw new Error('config/team.json: membersには重複のない名前を1人以上指定してください。');
  if (!Array.isArray(team.leadMembers) || team.leadMembers.some(x => !team.members.includes(x)))
    throw new Error('config/team.json: leadMembersはmembersの中から選んでください。');
  for (const key of ['trainingLabels', 'trainingLocations']) {
    if (!team[key] || typeof team[key] !== 'object' || Array.isArray(team[key]) ||
        Object.entries(team[key]).some(([name, value]) => reserved.has(name) || typeof value !== 'string'))
      throw new Error('config/team.json: '+key+'には文字列の設定を指定してください。');
  }
  return team;
}
