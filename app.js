const express = require('express');
const cors = require('cors');
const historyRoutes = require('./src/routes/history');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.use('/api', historyRoutes);

app.listen(PORT, () => {
    console.log(`
 Server URL: http://localhost:${PORT}`)
});


module.exports = app;