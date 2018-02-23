'use strict';

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const _ = require('lodash');
const traverse = require('traverse');
const properties = require('properties-parser');

const getGitBranch = () => new Promise((resolve, reject) => {
  exec('git rev-parse --abbrev-ref HEAD', (error, stdout, stderr) => {
    if (error) reject(new Error(error));
    else if (stderr) reject(new Error(stderr));
    else resolve(stdout.trim());
  });
});

const getGitRoot = () => new Promise((resolve, reject) => {
  exec('git rev-parse --show-toplevel', (error, stdout, stderr) => {
    if (error) reject(new Error(error));
    else if (stderr) reject(new Error(stderr));
    else resolve(stdout.trim());
  });
});

const getAllFoldersToGitRoot = () => {
  const getDirs = (acc, current) => (root) => {
    acc.push(current);

    if (root == current) {
      return acc;
    }
    else {
      const parent = path.resolve(current, '..');
      return getDirs(acc, parent)(root);
    }
  };

  return getGitRoot().then(getDirs([], process.cwd())).then(a => a.reverse());
};

const getNdtParameters = () => {
  return Promise.all([getGitBranch(), getAllFoldersToGitRoot()])
    .then(([branch, dirs]) => {

      const commonParams = dirs.reduce((acc, dir) => {
        const file = `${dir}/infra.properties`;
        if (fs.existsSync(file)) {
          return Object.assign({}, acc, properties.read(file));
        } else {
          return acc;
        }
      }, {});

      const branchParams = dirs.reduce((acc, dir) => {
        const file = `${dir}/infra-${branch}.properties`;
        if (fs.existsSync(file)) {
          return Object.assign({}, acc, properties.read(file));
        } else {
          return acc;
        }
      }, {});

      return Object.assign({}, commonParams, branchParams);
    });
};

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {};

    this.hooks = {
      'before:package:initialize': this.fillNdtProperties.bind(null, serverless, options)
    };
  }

  fillNdtProperties(serverless, options) {
    return getNdtParameters()
      .then(ndtParams => {
        serverless.cli.log('Resolved NDT params: ' + JSON.stringify(ndtParams));

        const repWithPar = (str) => {
          return Object.keys(ndtParams).reduce((acc, cur) => {
            return acc.replace(new RegExp(`\\(\\(${cur}\\)\\)`, 'g'), ndtParams[cur]);
          }, str);
        };
        traverse(_.omit(serverless.service, ['serverless'])).forEach(function (x) {
          if (typeof x === 'string') this.update(repWithPar(x));
        });

        return getAllFoldersToGitRoot();
      });
  }
}

module.exports = ServerlessPlugin;
