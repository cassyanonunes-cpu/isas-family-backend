import http from 'http';
import app from './app';
import { initSocket } from './sockets/socketManager';

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

initSocket(server);

server.listen(PORT, () => {
  console.log(`Servidor Isas Family rodando na porta ${PORT}`);
});
