import { createServer } from 'http';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { initSocket } from './socket/io.js';
import { logger } from './utils/logger.js';

await connectDatabase();

const app = createApp();
const server = createServer(app);
initSocket(server);

server.listen(env.PORT, () => {
  logger.info('API listening', { port: env.PORT });
});
