const { dbAll } = require('./db/database');

async function test() {
  const dirs = await dbAll(`SELECT id, emp_code, name, position, department FROM personnel WHERE role_type = 'DIRECTOR' ORDER BY emp_code ASC;`);
  console.log('Total Directors in DB:', dirs.length);
  dirs.forEach(d => console.log(`${d.emp_code}: ${d.name} (${d.position})`));
}

test().catch(console.error);
