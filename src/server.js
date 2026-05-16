const http = require('http');
const app = require('./app');
const { initSocket } = require('./services/socket.service');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fixam Backend running on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});
