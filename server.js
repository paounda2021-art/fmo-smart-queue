const express = require('express');
const cors = require('cors');
const path = require('path');
const { initSchema } = require('./db/database');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', apiRoutes);

// Serve main app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Redirect หน้าแรก (/) ไปที่หน้า login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Serve main app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback for SPA routes
app.get('*', (req, res) => {
  if (req.path.includes('.')) {
    // Let static files be served (they already are from express.static)
    res.status(404).send('Not found');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

// Initialize DB and start server
initSchema().then(() => {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 FMO Smart Queue Server is running on port ${PORT}`);
    console.log(`🌐 Open Web Browser at: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
});
