'use strict';

/**
 * Ensure that all environment variables are configured.
 */

var dotenv = require('dotenv');
dotenv.config();

[
  'DOMAIN',
  'PORT',
  'REALM',
  'MAIN_PATH'
].forEach(varName => {
  if (!process.env.hasOwnProperty(varName)) {
    throw new Error('Missing environment variable: ' + varName);
  }
});

/**
 * Module dependencies.
 */

var spawn = require('child_process').spawn;
var fs = require('fs');
var http = require('http');
var path = require('path');
var zlib = require('zlib');

var express = require('express');
var gitHttp = require('git-http-backend');
var helmet = require('helmet');

/**
 * Initialize express server.
 */

var app = express();
app.use(helmet());

app.use(function(req, res, next) {
  // Set Content-Type to text/plain
  res.type('.txt');

  // Add res.reply()
  res.reply = function(status, arr) {
    arr = arr.map(function(item) {
      return '!\t' + item;
    });
    res.status(status).send('\n' + arr.join('\n') + '\n');
  }
  next();
});

// Basic Authentication
var unauthorized = function (res) {
  res.header('WWW-Authenticate', `Basic realm="${process.env.REALM}"`);
  res.reply(401, [
    'WARNING:',
    'Do not authenticate with username and password using git.',
    'Run `concerto login` to update your credentials, then retry the git command.',
    'See documentation for details: https://devcenter.heroku.com/articles/git#http-git-authentication'
  ]);
};

var validate = function(username, password) {
  return new Promise(function(resolve, reject) {
    // TODO: Verify username and password using a data store
    if (username === password) {
      resolve(username);
    } else {
      reject('Invalid username or password');
    }
    // TODO: Check user permissions here
  });
}

var auth = function(req, res, next) {
  var authorization = req.headers.authorization;

  // User is already logged in
  if (req.user) {
    return next();
  }

  // Header does not exist
  if (!authorization) {
    return unauthorized(res);
  }

  var parts = authorization.split(' ');

  if (parts.length !== 2) {
    return unauthorized(res);
  }

  var scheme = parts[0];
  var credentials = new Buffer(parts[1], 'base64').toString();
  var index = credentials.indexOf(':');

  if ('Basic' != scheme || index < 0) {
    return unauthorized(res);
  }

  var username = credentials.slice(0, index);
  var password = credentials.slice(index + 1);

  validate(username, password)
  .then(function(username) {
    req.user = req.remoteUser = username;
    next();
  })
  .catch(function(err) {
    unauthorized(res);
  });
};

// Git Server handler
var handleGit = function(req, res) {
  var dir = path.join(process.env.MAIN_PATH, req.params[0], 'git');

  // Check if repo exists
  if (!fs.existsSync(dir)) {
    return res.reply(404, [`No such app as ${req.params[0]}.`]);
  }

  var reqStream = req.headers['content-encoding'] === 'gzip'
                  ? req.pipe(zlib.createGunzip())
                  : req;

  reqStream.pipe(gitHttp(req.url, function(err, service) {
    if (err) {
      console.log('ERR', err);
      return res.status(500).send(http.STATUS_CODES['500']);
    }

    res.header('Content-Type', service.type);

    var ps = spawn(service.cmd, service.args.concat(dir));
    ps.stdout.pipe(service.createStream()).pipe(ps.stdin);
  })).pipe(res);
}

app.get(/\/([a-z0-9\-]+)\.git\/info\/refs$/, auth, function(req, res) {
  if (! req.query.service) {
    return res.reply(403, [
      'Please upgrade your git client.',
      'Concerto does not support git over dumb-http.'
    ]);
  }

  if (! ['git-upload-pack', 'git-receive-pack'].includes(req.query.service)) {
    return res.reply(400, [
      'You can only access Concerto Git repo push and pull commands.'
    ]);
  }

  handleGit(req, res);
});

app.use(/\/([a-z0-9\-]+)\.git\/info\/refs$/, function(req, res) {
  res.header('Allow', 'HEAD, GET');
  res.status(405).send('Method Not Allowed');
});

app.post(/\/([a-z0-9\-]+)\.git\/(git-(?:upload|receive)-pack)$/, auth, function(req, res) {
  handleGit(req, res);
});

app.use(/\/([a-z0-9\-]+)\.git\/(git-(?:upload|receive)-pack)$/, function(req, res) {
  res.header('Allow', 'POST');
  res.status(405).send('Method Not Allowed');
});

/**
 * 404 handler.
 */

app.use(function(req, res, next) {
  res.reply(404, [
    'Invalid path.',
    `Syntax is: ${process.env.DOMAIN}/<app>.git where <app> is your app\'s name.`
  ]);
});

/**
 * Error handler.
 */

app.use(function(err, req, res, next) {
  err.status = err.status || 500;
  console.log('ERR', err);
  res.status(err.status).send(http.STATUS_CODES[err.status]);
});

/**
 * Listen on provided port, on all network interfaces.
 */

var PORT = process.env.PORT || 9000;
app.listen(PORT, function(error) {
  error
  ? console.error(error)
  : console.log(`-----> Git HTTP(S) Server listening on port ${PORT}`);
});
