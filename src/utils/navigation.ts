export function readScheduleMonth(search: string, now = new Date()): { year: number; month: number } {
  const params = new URLSearchParams(search);
  const y = params.get('year'), m = params.get('month');
  const year = y && /^\d{4}$/.test(y) ? Number(y) : now.getFullYear();
  const month = m && /^(?:[1-9]|1[0-2])$/.test(m) ? Number(m) - 1 : now.getMonth();
  return { year: year >= 1900 && year <= 9999 ? year : now.getFullYear(), month };
}
