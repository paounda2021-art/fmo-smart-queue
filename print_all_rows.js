const XLSX = require('xlsx');
const workbook = XLSX.readFile('fmo_personnel.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

console.log('Total Rows:', data.length);
data.forEach((r, idx) => {
  console.log(`${idx + 1}. [${r.emp_code || ''}] ${r.name || ''} | ${r.position || ''} | ${r.department1 || ''} | ${r.role_type || ''}`);
});
