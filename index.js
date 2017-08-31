'use strict';

const DOMAIN = 'http://localhost:9000';
const REALM = 'Concerto';
const REPOS_PATH = '/Users/imjching/workspace/tempgrack/repo';

var express = require('express');
var gitHttp = require('git-http-backend');
var helmet = require('helmet');
var spawn = require('child_process').spawn;
var path = require('path');
var fs = require('fs');
var zlib = require('zlib');

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
})

// Basic Authentication
var unauthorized = function (res) {
  res.header('WWW-Authenticate', `Basic realm="${REALM}"`);
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
  var dir = path.join(REPOS_PATH, `${req.params[0]}.git`);

  // Check if repo exists
  if (!fs.existsSync(dir)) {
    return res.reply(404, [`No such app as ${req.params[0]}.`]);
  }

  var reqStream = req.headers['content-encoding'] === 'gzip'
                  ? req.pipe(zlib.createGunzip())
                  : req;

  reqStream.pipe(gitHttp(req.url, function(err, service) {
    if (err) {
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

app.post(/\/([a-z0-9\-]+)\.git\/(git-(?:upload|receive)-pack)$/, auth, function(req, res) {
  handleGit(req, res);
});

app.use(/\/([a-z0-9\-]+)\.git\/(git-(?:upload|receive)-pack)$/, function(req, res) {
  res.header('Allow', 'POST');
  res.status(405).send('Method Not Allowed');
});

// not-found handler
app.use(function(req, res, next) {
  res.reply(404, [
    'Invalid path.',
    `Syntax is: ${DOMAIN}/<app>.git where <app> is your app\'s name.`
  ]);
});

// error handler
app.use(function(err, req, res, next) {
  err.status = err.status || 500;
  res.status(err.status).send(http.STATUS_CODES[err.status]);
});

app.listen(9000, function() {
  console.log('-----> Git HTTP(S) Server listening on port 9000');
});
