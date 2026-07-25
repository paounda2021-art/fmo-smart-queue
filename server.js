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

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
