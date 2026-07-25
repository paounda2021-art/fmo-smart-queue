const { dbAll } = require('./db/database');
dbAll(`SELECT emp_code, name, position FROM personnel WHERE emp_code IN ('EMP-062','EMP-043','EMP-102') ORDER BY emp_code`)
  .then(rows => rows.forEach(r => console.log(r.emp_code, '|', r.name, '|', r.position)))
  .catch(console.error);
