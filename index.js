'use strict';

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const _ = require('lodash');
const traverse = require('traverse');
const properties = require('properties-parser');

const promisexec = (command) => new Promise((resolve, reject) => {
  exec(command, (error, stdout, stderr) => {
    if (error) reject(new Error(error));
    else if (stderr) reject(new Error(stderr));
    else resolve(stdout.trim());
  });
});

const getGitBranch = (serverless) => {
  if (process.env.GIT_BRANCH) {
    serverless.cli.log(`Using git branch '${process.env.GIT_BRANCH}' from ENV`);
    return Promise.resolve(process.env.GIT_BRANCH);
  } else {
    serverless.cli.log('Using current git branch');
    return promisexec('git rev-parse --abbrev-ref HEAD');
  }
};

const getAllFoldersToSystemRoot = () => {
  const getDirs = (acc, current) => {
    const parent = path.resolve(current, '..');
    if (parent === current) {
      return acc;
    } else {
      acc.push(current);
      return getDirs(acc, parent);
    }
  };

  return getDirs([], process.cwd());
};

const getNdtParameters = (serverless) => {
  return Promise.all([getGitBranch(serverless), getAllFoldersToSystemRoot()])
    .then(([branch, allDirs]) => {

      // If explicit root property file exists, discard all ancestors of that directory
      const explicitRoot = allDirs.find(dir => fs.existsSync(`${dir}/infra-root.properties`));
      const dirs = ((explicitRoot) ? _.dropRightWhile(allDirs, dir => dir !== explicitRoot) : allDirs).reverse();

      const rootParams = (explicitRoot) ? properties.read(`${explicitRoot}/infra-root.properties`) : {};

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

      return Object.assign({}, rootParams, commonParams, branchParams);
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
    return getNdtParameters(serverless)
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
      });
  }
}

module.exports = ServerlessPlugin;
