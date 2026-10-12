// logger.js
import log4js from 'log4js';

const COLORS = {
  TRACE: '\x1b[90m',
  DEBUG: '\x1b[36m',
  INFO:  '\x1b[32m',
  WARN:  '\x1b[33m',
  ERROR: '\x1b[31m',
  FATAL: '\x1b[37m\x1b[41m',
};
const RESET = '\x1b[0m';

// shared JSON builder (keeps console/file in sync)
function lineJson(ev) {
  const obj = {
    time: new Date(ev.startTime).toISOString(),
    level: ev.level.levelStr,
    category: ev.categoryName,
    pid: process.pid,
    requestId: ev.context.requestId,
    ip: ev.context.ip,
    msg: ev.data[0],
    args: ev.data.length > 1 ? ev.data.slice(1) : undefined,
  };
  return JSON.stringify(obj);
}

// plain JSON for files / shippers
log4js.addLayout('json', () => (ev) => lineJson(ev));

// colored whole-line JSON for console
log4js.addLayout('jsonConsoleColored', () => (ev) => {
  const json = lineJson(ev);
  if (!process.stdout.isTTY) return json;
  const open = COLORS[ev.level.levelStr] || '';
  return open ? `${open}${json}${RESET}` : json;
});

log4js.configure({
  appenders: {
    // console: { type: 'console' }, // Log to the console
    console: { type: 'stdout', layout: { type: (process.env.snapenv === 'dev') ? 'jsonConsoleColored' : 'json' } },
    file: {
      type: 'dateFile',
      filename: process.env.instance === undefined ? 'logs/app' : 'logs/app2',
      pattern: '.yyyy-MM-dd.log',
      keepFileExt: true,
      layout: { type: 'json' },
    },
  },
  categories: {
    default: { 
      appenders: (process.env.snapenv === 'dev') ? ['console', 'file'] : ['console'],
      level: (process.env.snapenv === 'dev') ? 'trace' : 'debug'
    },
  },
});

export default log4js;
