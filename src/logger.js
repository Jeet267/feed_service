const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : config.logLevel,
  base: { service: 'hyperlocal-feed' },
});

module.exports = logger;
