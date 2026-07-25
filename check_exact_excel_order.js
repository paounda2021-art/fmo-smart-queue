const XLSX = require('xlsx');
const workbook = XLSX.readFile('fmo_personnel.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

console.log('Total Rows in fmo_personnel.xlsx:', data.length);

const directors = [];
const staff = [];

data.forEach((r, idx) => {
  if (!r.name) return;
  const isDir = (r.role_type || '').toUpperCase().includes('DIR') || (r.emp_code || '').startsWith('DIR');
  
  if (isDir) {
    directors.push({ rowIdx: idx + 1, ...r });
  } else {
    staff.push({ rowIdx: idx + 1, ...r });
  }
});

console.log(`Directors Count in Excel: ${directors.length}`);
directors.forEach(d => console.log(`Row ${d.rowIdx}: [${d.emp_code || ''}] ${d.name} (${d.position || ''})`));

console.log(`\nStaff Count in Excel: ${staff.length}`);
console.log('First 10 Staff in exact Excel row order:');
staff.slice(0, 10).forEach((s, i) => console.log(`Staff #${i+1} (Row ${s.rowIdx}): [${s.emp_code || ''}] ${s.name} (${s.position || ''})`));

console.log('\nLast 10 Staff in exact Excel row order:');
staff.slice(-10).forEach((s, i) => console.log(`Staff #${staff.length - 10 + i + 1} (Row ${s.rowIdx}): [${s.emp_code || ''}] ${s.name} (${s.position || ''})`));
