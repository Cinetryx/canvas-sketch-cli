#!/usr/bin/env node
const path = require('path');
const budo = require('budo');
const fs = require('fs');
const chalk = require('chalk');
const pify = require('pify');
const mkdirp = pify(require('mkdirp'));
const dateformat = require('dateformat');
const commit = require('./commit');
const filenamify = require('filenamify');
const install = require('./install');
const resolve = require('resolve');

const argv = require('minimist')(process.argv.slice(2), {
  string: ['template'],
  alias: {
    dir: 'd',
    open: 'o',
    install: 'I',
    template: 't',
    new: 'n'
  },
  boolean: [ 'open', 'install' ],
  default: {
    install: true,
    template: 'default'
  }
});

const templateDirectory = 'templates';
const sketchDirectory = 'sketches';

const generateFileName = (suffix = '') => {
  const separator = suffix ? '-' : '';
  suffix = suffix.replace(/\.js$/, '');
  const date = dateformat(Date.now(), 'yyyy.mm.dd-HH.MM.ss');
  const file = `${date}${separator}${suffix}.js`;
  return filenamify(file);
};

const start = async () => {
  const bullet = chalk.bold(chalk.green('\n  → '));
  const cwd = process.cwd();
  const staticDir = argv.dir;

  let entry = argv._[0];
  let entrySrc;
  if (argv.new) {
    const suffix = typeof argv.new === 'string' ? argv.new : undefined;
    const file = generateFileName(suffix);
    await mkdirp(sketchDirectory);

    const filepath = path.join(sketchDirectory, file);
    if (fs.existsSync(filepath)) {
      throw new Error(`The file already exists: ${path.relative(cwd, filepath)}`);
    }
    let template;
    try {
      template = fs.readFileSync(path.resolve(__dirname, templateDirectory, `${argv.template}.js`), 'utf-8');
    } catch (err) {
      throw new Error(`Couldn't find a template by the key ${argv.template}`);
    }

    console.log((`${bullet}Writing file: ${chalk.bold(path.relative(cwd, filepath))}`));
    fs.writeFileSync(filepath, template);
    entry = filepath;
    entrySrc = template;
  }

  if (!entry) {
    const msg = chalk.red(`No entry file specified!`);
    const examples = `Example usage:\n    canvas-sketch src/index.js\n    canvas-sketch --new --template=regl`;
    console.log(`\n  ${msg}\n\n  ${examples}\n`)
    process.exit(1);
  }

  // Read source code
  if (!entrySrc) {
    console.log('resolving', entry);
    let entryFile;
    try {
      const entryPath = /^[.\//]/.test(entry) ? entry : ('./' + entry);
      console.log(entryPath)
      entryFile = resolve.sync(entryPath, { basedir: cwd });
    } catch (err) {
      const msg = chalk.red(`Cannot find file: ${chalk.bold(entry)}`);
      console.log(`\n  ${msg}`);
      process.exit(1);
    }

    try {
      entrySrc = fs.readFileSync(entryFile, 'utf-8');
    } catch (err) {
      const msg = chalk.red(`Cannot read entry file: ${chalk.bold(path.relative(cwd, entryFile))}`);
      console.log(`\n  ${msg}`);
      process.exit(1);
    }
  }

  // Install dependencies from the template if needed
  if (argv.install !== false) {
    await install(entrySrc, { bullet });
  }

  budo(entry, {
    browserify: {
      transform: [ require.resolve('glslify') ]
    },
    open: argv.open,
    serve: 'bundle.js',
    middleware: (req, res, next) => {
      if (req.url === '/canvas-sketch-client/commit-hash') {
        commit().then(result => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        }).catch(err => {
          console.error(err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain');
          res.end(err.message);
        });
      } else {
        next(null);
      }
    },
    live: {
      cache: false,
      debug: true,
      include: require.resolve('./client.js')
    },
    defaultIndex: (opt, req) => {
      return fs.createReadStream(path.resolve(__dirname, 'templates/index.html'));
    },
    dir: staticDir,
    stream: process.stdout
  }).on('connect', ev => {
    ev.webSocketServer.on('connection', client => {
      client.on('message', ev => {
        const data = JSON.parse(ev);
        if (data.event === 'commit') commit();
      });
    });
  });
};

start()
  .catch(err => {
    const msg = err.stack;
    const lines = msg.split('\n');
    let endIdx = lines.findIndex(line => line.trim().startsWith('at '));
    if (endIdx === -1 || endIdx === 0) endIdx = 1;
    const redLines = chalk.red(lines.slice(0, endIdx).join('\n'));
    const otherLines = lines.slice(endIdx).join('\n');
    console.error([ '', redLines, otherLines, '' ].join('\n'));
  });
